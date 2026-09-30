'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { sendMail, remetenteDominio } from '@/lib/email/send'
import { emailLayout } from '@/lib/email/layout'
import { logSystemError } from '@/lib/system-error'
import { novoToken, urlCotacao } from '@/lib/cotacao-server'
import { MAX_FAIXAS, type ArquivoRef, type CotacaoItem } from '@/lib/cotacao'

/**
 * Pedido de cotação (mig. 310), lado da agência. Quem pode: manager+ — a RLS das
 * tabelas é a mesma régua de quem edita o orçamento; aqui só montamos o pedido,
 * geramos os links e mandamos os e-mails.
 */

type Sb = Awaited<ReturnType<typeof createClient>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (s: Sb) => s as any

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const dataBR = (d: string | null) => (d ? d.split('-').reverse().join('/') : '')
const primeiroEmail = (emails: unknown): string | null => {
  const lista = Array.isArray(emails) ? emails as { email?: string }[] : []
  return lista.map(e => (e.email ?? '').trim()).find(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) ?? null
}

export interface NovaCotacao {
  itens: CotacaoItem[]
  mensagem: string
  prazo: string
  anexos: ArquivoRef[]
  fornecedorIds: string[]
  /** Grava esta tag nos fornecedores escolhidos (ex.: "caneta") — o próximo filtro já acha. */
  tag: string
}

async function contexto(orgSlug: string) {
  const user = await getUsuario()
  if (!user) return null
  const supabase = await createClient()
  const { data: org } = await supabase.from('organizations').select('id, name').eq('slug', orgSlug).single()
  if (!org) return null
  return { user, supabase, org }
}

/** Cria a cotação do orçamento, um convite por fornecedor e dispara os e-mails. */
export async function criarCotacao(orgSlug: string, producaoId: string, input: NovaCotacao): Promise<{ error?: string; enviados?: number; semEmail?: number }> {
  const ctx = await contexto(orgSlug)
  if (!ctx) return { error: 'Não autenticado' }
  const { user, supabase, org } = ctx

  const itens = input.itens
    .map(it => ({
      idx: it.idx, nome: it.nome.trim().slice(0, 200), descricao: (it.descricao ?? '').trim().slice(0, 3000),
      faixas: [...new Set(it.faixas.filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).slice(0, MAX_FAIXAS),
      temImagem: !!it.temImagem,
    }))
    .filter(it => it.nome)
    .map(it => ({ ...it, faixas: it.faixas.length ? it.faixas : [1] }))
  if (!itens.length) return { error: 'Nenhum item para cotar — dê nome aos itens do orçamento.' }
  const ids = [...new Set(input.fornecedorIds)]
  if (!ids.length) return { error: 'Escolha ao menos um fornecedor.' }
  const anexos = input.anexos.filter(a => a.chave.startsWith(`cotacao-privado/agencia/${org.id}/`) && !a.chave.includes('..')).slice(0, 6)

  const { data: prod } = await db(supabase).from('producao').select('id, titulo, tipo').eq('id', producaoId).eq('org_id', org.id).single()
  if (!prod || prod.tipo !== 'orcamento') return { error: 'Orçamento não encontrado' }

  const { data: cot, error: e1 } = await db(supabase).from('cotacoes').insert({
    org_id: org.id, producao_id: producaoId, itens, mensagem: input.mensagem.trim().slice(0, 3000) || null,
    prazo_resposta: input.prazo || null, anexos, created_by: user.id,
  }).select('id').single()
  if (e1 || !cot) return { error: e1?.code === '42501' ? 'Só gerente ou admin pode pedir cotação.' : 'Não foi possível criar a cotação.' }

  const r = await convidar(ctx, cot.id, ids, prod.titulo, itens, input.prazo || null)
  if (r.error) return r

  const tag = input.tag.trim().slice(0, 60)
  if (tag) await gravarTag(supabase, ids, tag)

  revalidatePath(`/${orgSlug}/producao/orcamento/${producaoId}`)
  revalidatePath(`/${orgSlug}/producao/orcamento`)
  return r
}

/** Convida mais fornecedores para uma cotação que já saiu. */
export async function adicionarFornecedores(orgSlug: string, cotacaoId: string, fornecedorIds: string[]): Promise<{ error?: string; enviados?: number; semEmail?: number }> {
  const ctx = await contexto(orgSlug)
  if (!ctx) return { error: 'Não autenticado' }
  const { data: cot } = await db(ctx.supabase).from('cotacoes')
    .select('id, itens, prazo_resposta, producao_id, producao:producao_id(titulo)').eq('id', cotacaoId).single()
  if (!cot) return { error: 'Cotação não encontrada' }
  const { data: ja } = await db(ctx.supabase).from('cotacao_convites').select('fornecedor_id').eq('cotacao_id', cotacaoId)
  const existentes = new Set(((ja ?? []) as { fornecedor_id: string }[]).map(x => x.fornecedor_id))
  const novos = [...new Set(fornecedorIds)].filter(id => !existentes.has(id))
  if (!novos.length) return { error: 'Esses fornecedores já foram convidados.' }
  const r = await convidar(ctx, cotacaoId, novos, cot.producao?.titulo ?? 'Orçamento', cot.itens, cot.prazo_resposta)
  revalidatePath(`/${orgSlug}/producao/orcamento/${cot.producao_id}`)
  return r
}

async function convidar(
  ctx: NonNullable<Awaited<ReturnType<typeof contexto>>>, cotacaoId: string, ids: string[],
  titulo: string, itens: CotacaoItem[], prazo: string | null,
): Promise<{ error?: string; enviados?: number; semEmail?: number }> {
  const { supabase, org, user } = ctx
  const { data: forns } = await db(supabase).from('fornecedores').select('id, name, emails').eq('org_id', org.id).in('id', ids)
  const lista = (forns ?? []) as { id: string; name: string; emails: unknown }[]
  const linhas = lista.map(f => ({
    org_id: org.id, cotacao_id: cotacaoId, fornecedor_id: f.id, token: novoToken(), email_para: primeiroEmail(f.emails),
  }))
  const { data: convites, error } = await db(supabase).from('cotacao_convites').insert(linhas).select('id, token, email_para, fornecedor_id')
  if (error || !convites) return { error: 'Não foi possível registrar os convites.' }

  let enviados = 0
  const nomes = new Map(lista.map(f => [f.id, f.name]))
  for (const c of convites as { id: string; token: string; email_para: string | null; fornecedor_id: string }[]) {
    if (!c.email_para) continue
    const ok = await enviarEmail(supabase, user.id, { para: c.email_para, fornecedor: nomes.get(c.fornecedor_id) ?? '', agencia: org.name, titulo, itens, prazo, token: c.token })
    if (ok) {
      enviados++
      await db(supabase).from('cotacao_convites').update({ email_enviado_em: new Date().toISOString() }).eq('id', c.id)
    }
  }
  return { enviados, semEmail: convites.filter((c: { email_para: string | null }) => !c.email_para).length }
}

async function enviarEmail(
  supabase: Sb, userId: string,
  o: { para: string; fornecedor: string; agencia: string; titulo: string; itens: CotacaoItem[]; prazo: string | null; token: string },
): Promise<boolean> {
  const dominio = remetenteDominio()
  const lista = o.itens.map(it =>
    `<li style="margin-bottom:6px"><b>${esc(it.nome)}</b>${it.faixas.length && !(it.faixas.length === 1 && it.faixas[0] === 1)
      ? ` — ${it.faixas.map(n => n.toLocaleString('pt-BR')).join(' / ')} un.` : ''}</li>`).join('')
  const { error } = await sendMail({
    from: dominio ? `${o.agencia} <flow@${dominio}>` : undefined,
    to: o.para,
    subject: `Pedido de cotação — ${o.titulo}`,
    html: emailLayout({
      brand: o.agencia,
      heading: 'Pedido de cotação',
      bodyHtml: `<p>Olá${o.fornecedor ? `, ${esc(o.fornecedor)}` : ''}!</p>
<p>A <b>${esc(o.agencia)}</b> está cotando <b>${esc(o.titulo)}</b> e gostaria da sua proposta${o.prazo ? ` até <b>${dataBR(o.prazo)}</b>` : ''}.</p>
<ul style="padding-left:18px;margin:16px 0">${lista}</ul>
<p>No link abaixo você vê os detalhes e os anexos e preenche os valores — por unidade ou total. Se preferir, anexe o seu orçamento em PDF.</p>`,
      cta: { label: 'Enviar minha proposta', url: urlCotacao(o.token) },
      footerNote: 'Este link é exclusivo da sua empresa. Dá para corrigir a proposta pelo mesmo link até o prazo.',
    }),
  })
  if (error) {
    await logSystemError(supabase, { userId, context: 'cotacao: envio de e-mail', error: `${o.para}: ${error}` })
    return false
  }
  return true
}

/** Reenvia o e-mail de um convite (ou manda pela primeira vez, se o e-mail foi cadastrado depois). */
export async function reenviarConvite(orgSlug: string, conviteId: string): Promise<{ error?: string }> {
  const ctx = await contexto(orgSlug)
  if (!ctx) return { error: 'Não autenticado' }
  const { supabase, org, user } = ctx
  const { data: cv } = await db(supabase).from('cotacao_convites')
    .select('id, token, fornecedor:fornecedor_id(name, emails), cotacao:cotacao_id(itens, prazo_resposta, producao_id, producao:producao_id(titulo))')
    .eq('id', conviteId).single()
  if (!cv) return { error: 'Convite não encontrado' }
  const para = primeiroEmail(cv.fornecedor?.emails)
  if (!para) return { error: 'Fornecedor sem e-mail no cadastro.' }
  const ok = await enviarEmail(supabase, user.id, {
    para, fornecedor: cv.fornecedor?.name ?? '', agencia: org.name, titulo: cv.cotacao?.producao?.titulo ?? 'Orçamento',
    itens: cv.cotacao?.itens ?? [], prazo: cv.cotacao?.prazo_resposta ?? null, token: cv.token,
  })
  if (!ok) return { error: 'O e-mail não saiu — o erro ficou registrado em Configurações → Erros.' }
  const { error } = await db(supabase).from('cotacao_convites').update({ email_para: para, email_enviado_em: new Date().toISOString() }).eq('id', conviteId)
  if (error) return { error: 'Só gerente ou admin pode reenviar.' }
  revalidatePath(`/${orgSlug}/producao/orcamento/${cv.cotacao?.producao_id}`)
  return {}
}

/** Registra que o link foi mandado por WhatsApp (o envio em si é o wa.me no navegador de quem clicou). */
export async function marcarWhatsapp(conviteId: string): Promise<void> {
  const supabase = await createClient()
  await db(supabase).from('cotacao_convites').update({ whatsapp_em: new Date().toISOString() }).eq('id', conviteId)
}

/** Encerra (o link para de aceitar proposta) ou reabre a cotação. */
export async function encerrarCotacao(orgSlug: string, cotacaoId: string, encerrada: boolean): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data, error } = await db(supabase).from('cotacoes').update({ encerrada }).eq('id', cotacaoId).select('producao_id').single()
  if (error || !data) return { error: 'Só gerente ou admin pode encerrar a cotação.' }
  revalidatePath(`/${orgSlug}/producao/orcamento/${data.producao_id}`)
  return {}
}

/** Soma a tag aos fornecedores (sem duplicar, comparando sem acento/caixa). */
async function gravarTag(supabase: Sb, ids: string[], tag: string) {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
  const { data } = await db(supabase).from('fornecedores').select('id, tags').in('id', ids)
  for (const f of (data ?? []) as { id: string; tags: string[] | null }[]) {
    const tags = f.tags ?? []
    if (tags.some(t => norm(t) === norm(tag))) continue
    await db(supabase).from('fornecedores').update({ tags: [...tags, tag] }).eq('id', f.id)
  }
}
