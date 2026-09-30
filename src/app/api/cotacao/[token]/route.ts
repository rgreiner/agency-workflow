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
    await sql`select cotacao_marcar_aberto(${token})`
    return NextResponse.json({ ok: true })
  }

  if (cotacaoFechada(cv)) return NextResponse.json({ error: 'Esta cotação já foi encerrada — fale com a agência.' }, { status: 409 })

  if (body.acao === 'recusar') {
    const motivo = txt(body.motivo, 500)
    await sql`select cotacao_recusar(${token}, ${motivo})`
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

  // Mesma transação: a função trava a linha do orçamento, a proposta é aplicada
  // nos itens como estão AGORA e a gravação acontece antes de soltar o lock — duas
  // respostas chegando juntas não se atropelam.
  await sql.begin(async tx => {
    const atual = await convitePorToken(token, true, tx as unknown as typeof sql)
    if (!atual) throw new Error('Convite sumiu')
    const itensOrc = Array.isArray(atual.detalhe_itens)
      ? aplicarResposta(atual.detalhe_itens as unknown as ItemOrcBase[], atual.id, atual.fornecedor_id, atual.itens, resposta)
      : null

    // Cadastro do fornecedor: o que ele informou ENTRA (e-mail e WhatsApp somam,
    // nunca apagam o que a agência já tinha; CNPJ válido substitui).
    const f = atual.fornecedor
    const emails: { tipo?: string; email: string }[] = Array.isArray(f.emails) ? [...f.emails] : []
    const telefones: { tipo?: string; numero: string }[] = Array.isArray(f.telefones) ? [...f.telefones] : []
    let mudouEmail = false, mudouTel = false
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email) && !emails.some(e => (e.email ?? '').trim().toLowerCase() === dados.email)) {
      emails.push({ tipo: dados.contato || 'Cotação', email: dados.email }); mudouEmail = true
    }
    const zap = somenteDigitos(dados.whatsapp)
    const fim = (s: string) => somenteDigitos(s).slice(-8)
    if (zap.length >= 10 && !telefones.some(t => fim(t.numero ?? '') === zap.slice(-8))) {
      telefones.push({ tipo: 'WhatsApp', numero: dados.whatsapp }); mudouTel = true
    }
    const doc = somenteDigitos(dados.cnpj)
    const taxId = (doc.length === 14 || doc.length === 11) && doc !== somenteDigitos(f.tax_id ?? '') ? dados.cnpj : null

    const j = (v: unknown) => tx.json(JSON.parse(JSON.stringify(v)))
    await tx`select cotacao_gravar_resposta(
      ${token}, ${j(resposta)}, ${j(anexos)}, ${j(dados)},
      ${itensOrc ? j(itensOrc) : null}, ${mudouEmail ? j(emails) : null}, ${mudouTel ? j(telefones) : null}, ${taxId})`
  })

  return NextResponse.json({ ok: true })
}
