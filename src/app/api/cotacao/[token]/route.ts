/**
 * Ações do FORNECEDOR no link da cotação (sem sessão; o token é a credencial):
 *
 *  • abrir     — marca "abriu" (chamado pelo browser ao montar a página, e não na
 *                renderização: o preview de link do WhatsApp/e-mail busca a URL e
 *                marcaria "abriu" sem ninguém ter aberto).
 *  • responder — grava a proposta, aplica no orçamento como opções, atualiza o
 *                cadastro do fornecedor com o que ele informou e avisa quem pediu.
 *  • recusar   — "não vamos cotar desta vez".
 *
 * Reenviar é permitido até o prazo: substitui a proposta anterior (e as opções
 * dela no orçamento), nunca duplica.
 */
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { aplicarResposta, type ArquivoRef, type ItemOrcBase, type Resposta } from '@/lib/cotacao'
import { convitePorToken, cotacaoFechada, MAX_ARQUIVOS, type DadosFornecedor } from '@/lib/cotacao-server'
import { somenteDigitos } from '@/lib/telefone'

export const runtime = 'nodejs'

const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number.NaN
  return Number.isFinite(n) && n > 0 && n < 1e10 ? Math.round(n * 10000) / 10000 : null
}

type Corpo = { acao?: string; resposta?: Partial<Resposta>; anexos?: ArquivoRef[]; dados?: Partial<DadosFornecedor>; motivo?: string }

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const cv = await convitePorToken(token)
  if (!cv) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })

  let body: Corpo
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 }) }

  if (body.acao === 'abrir') {
    await sql`update public.cotacao_convites set aberto_em = coalesce(aberto_em, now()) where id = ${cv.id}`
    return NextResponse.json({ ok: true })
  }

  if (cotacaoFechada(cv)) return NextResponse.json({ error: 'Esta cotação já foi encerrada — fale com a agência.' }, { status: 409 })

  if (body.acao === 'recusar') {
    const motivo = txt(body.motivo, 500)
    await sql`update public.cotacao_convites
                 set recusado_em = now(), aberto_em = coalesce(aberto_em, now()),
                     resposta = case when respondido_em is null then ${sql.json({ recusa: motivo })} else resposta end
               where id = ${cv.id} and respondido_em is null`
    await notificar(cv, true)
    return NextResponse.json({ ok: true })
  }

  if (body.acao !== 'responder') return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })

  // ── Proposta: só itens e faixas que foram pedidos; números saneados. ──
  const r = body.resposta ?? {}
  const itensIn = Array.isArray(r.itens) ? r.itens : []
  const itens = cv.itens.map(pedido => {
    const vin = itensIn.find(x => x && x.idx === pedido.idx)
    const naoFornece = !!vin?.nao_fornece
    const precos = pedido.faixas.map(quant => {
      const p = Array.isArray(vin?.precos) ? vin.precos.find(x => x && x.quant === quant) : undefined
      return { quant, unit: naoFornece ? null : num(p?.unit), total: naoFornece ? null : num(p?.total) }
    })
    return { idx: pedido.idx, nao_fornece: naoFornece, precos, obs: txt(vin?.obs, 1000) }
  })
  const temPreco = itens.some(i => !i.nao_fornece && i.precos.some(p => p.unit || p.total))
  const anexosIn = (Array.isArray(body.anexos) ? body.anexos : []).slice(0, MAX_ARQUIVOS)
  const pasta = `cotacao-privado/${cv.org_id}/${cv.cotacao_id}/${cv.id}/`
  const anexos = anexosIn
    .filter(a => a && typeof a.chave === 'string' && a.chave.startsWith(pasta) && !a.chave.includes('..'))
    .map(a => ({ chave: a.chave, nome: txt(a.nome, 160) || 'arquivo' }))
  if (!temPreco && !anexos.length) {
    return NextResponse.json({ error: 'Informe o valor de pelo menos um item ou envie o arquivo da proposta.' }, { status: 400 })
  }
  const resposta: Resposta = {
    itens,
    prazo_producao: txt(r.prazo_producao, 200),
    validade: txt(r.validade, 200),
    pgto: txt(r.pgto, 200),
    n_orc: txt(r.n_orc, 60),
    observacao: txt(r.observacao, 3000),
  }
  const d = body.dados ?? {}
  const dados: DadosFornecedor = {
    contato: txt(d.contato, 120), cnpj: txt(d.cnpj, 30), email: txt(d.email, 200).toLowerCase(), whatsapp: txt(d.whatsapp, 30),
  }

  await sql.begin(async tx => {
    await tx`update public.cotacao_convites
                set resposta = ${tx.json(JSON.parse(JSON.stringify(resposta)))},
                    resposta_anexos = ${tx.json(anexos)},
                    dados_fornecedor = ${tx.json({ ...dados })},
                    respondido_em = now(), recusado_em = null,
                    aberto_em = coalesce(aberto_em, now())
              where id = ${cv.id}`

    // Orçamento: a proposta vira opção(ões) no item. Lock na linha para não
    // perder a resposta de outro fornecedor chegando ao mesmo tempo.
    const [p] = await tx<{ detalhe: { itens?: ItemOrcBase[] } | null }[]>`
      select detalhe from public.producao where id = ${cv.producao_id} for update`
    const det = p?.detalhe ?? {}
    if (Array.isArray(det.itens)) {
      const novos = aplicarResposta(det.itens, cv.id, cv.fornecedor_id, cv.itens, resposta)
      await tx`update public.producao set detalhe = ${tx.json(JSON.parse(JSON.stringify({ ...det, itens: novos })))}, updated_at = now()
                where id = ${cv.producao_id}`
    }

    // Cadastro do fornecedor: o que ele informou ENTRA (e-mail e WhatsApp somam,
    // nunca apagam o que a agência já tinha; CNPJ válido substitui).
    const [f] = await tx<{ emails: { tipo?: string; email: string }[]; telefones: { tipo?: string; numero: string }[]; tax_id: string | null }[]>`
      select emails, telefones, tax_id from public.fornecedores where id = ${cv.fornecedor_id} for update`
    if (f) {
      const emails = Array.isArray(f.emails) ? [...f.emails] : []
      const telefones = Array.isArray(f.telefones) ? [...f.telefones] : []
      let mudou = false
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email) && !emails.some(e => (e.email ?? '').trim().toLowerCase() === dados.email)) {
        emails.push({ tipo: dados.contato || 'Cotação', email: dados.email }); mudou = true
      }
      const zap = somenteDigitos(dados.whatsapp)
      const fim = (s: string) => somenteDigitos(s).slice(-8)
      if (zap.length >= 10 && !telefones.some(t => fim(t.numero ?? '') === zap.slice(-8))) {
        telefones.push({ tipo: 'WhatsApp', numero: dados.whatsapp }); mudou = true
      }
      const doc = somenteDigitos(dados.cnpj)
      const taxId = (doc.length === 14 || doc.length === 11) && doc !== somenteDigitos(f.tax_id ?? '') ? dados.cnpj : null
      if (mudou || taxId) {
        await tx`update public.fornecedores
                    set emails = ${tx.json(emails)}, telefones = ${tx.json(telefones)},
                        tax_id = coalesce(${taxId}, tax_id), updated_at = now()
                  where id = ${cv.fornecedor_id}`
      }
    }
  })

  await notificar(cv, false)
  return NextResponse.json({ ok: true })
}

/** Caixa de entrada de quem pediu (responsável do orçamento + quem enviou a cotação). */
async function notificar(cv: NonNullable<Awaited<ReturnType<typeof convitePorToken>>>, recusou: boolean) {
  try {
    const [o] = await sql<{ slug: string }[]>`select slug from public.organizations where id = ${cv.org_id}`
    const data = {
      fornecedor: cv.fornecedor.nome, orcamento: cv.titulo, recusou,
      href: o ? `/${o.slug}/producao/orcamento/${cv.producao_id}` : null,
    }
    await sql`
      insert into public.notifications (user_id, org_id, type, data)
      select distinct u, ${cv.org_id}::uuid, 'cotacao_resposta', ${sql.json(data)}
        from public.cotacoes c
        join public.producao p on p.id = c.producao_id
        cross join lateral unnest(array[p.responsavel_id, c.created_by]) as u
       where c.id = ${cv.cotacao_id} and u is not null
         and exists (select 1 from public.organization_members m where m.org_id = c.org_id and m.user_id = u)`
  } catch (e) {
    // Sem sessão de membro (fluxo do fornecedor): o log fica no stdout do container.
    console.error('[cotacao] falha ao notificar', e)
  }
}
