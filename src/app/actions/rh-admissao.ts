'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { sendMail, remetenteDominio, type MailAttachment } from '@/lib/email/send'
import { emailLayout } from '@/lib/email/layout'
import { logSystemError } from '@/lib/system-error'
import { novoToken } from '@/lib/admissao-server'
import { urlProposta, type JornadaProposta, type BeneficiosProposta } from '@/lib/admissao'
import type { FichaAdmissao } from '@/lib/admissao-ficha'
import { nomeLegivel } from '@/lib/nomes'

/** O cliente do PostgREST não é tipado neste módulo; o `as any` é local. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id, name').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string, orgNome: org.name as string, userId: user.id as string }
}

export interface PropostaInput {
  nome: string
  email?: string | null
  telefone?: string | null
  cargo?: string | null
  tipo_vinculo?: string | null
  salario?: string | null
  data_inicio?: string | null
  data_primeiro_pagamento?: string | null
  local_trabalho?: string | null
  jornada?: JornadaProposta
  beneficios?: BeneficiosProposta
  carta?: string | null
  exame_em?: string | null
  exame_local?: string | null
  observacao?: string | null
}

export async function salvarProposta(orgSlug: string, id: string | null, dados: PropostaInput) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_admissao_salvar', {
    p_org: c.orgId, p_id: id, p_dados: dados,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/contratacoes`)
  return { id: data as string }
}

/**
 * Publica o link e, se houver e-mail, manda a carta. O token nasce aqui (no
 * servidor) e só é gravado uma vez: reenviar não troca o link de quem já
 * recebeu.
 */
export async function enviarProposta(orgSlug: string, id: string, opcoes?: { dias?: number; email?: boolean }) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_admissao_enviar', {
    p_id: id, p_token: novoToken(), p_dias: opcoes?.dias ?? 15,
  })
  if (error) return { error: error.message }
  const { token, expira_em } = data as { token: string; expira_em: string }
  const url = urlProposta(token)

  let enviado = false
  if (opcoes?.email !== false) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: a } = await (c.supabase as any)
      .from('rh_admissao').select('nome, email, cargo').eq('id', id).maybeSingle()
    if (a?.email) {
      const dominio = remetenteDominio()
      const primeiro = String(a.nome).split(' ')[0]
      const { error: err } = await sendMail({
        from: dominio ? `${c.orgNome} <flow@${dominio}>` : undefined,
        to: a.email,
        subject: `Proposta de trabalho — ${c.orgNome}`,
        html: emailLayout({
          brand: c.orgNome,
          heading: 'Sua proposta de trabalho',
          bodyHtml: `<p>Olá, ${primeiro}!</p>
<p>A <b>${c.orgNome}</b> preparou uma proposta para a posição de <b>${a.cargo ?? ''}</b>.</p>
<p>No link abaixo você lê todos os termos — jornada, remuneração e benefícios — e responde ali mesmo.</p>`,
          cta: { label: 'Ver a proposta', url },
          footerNote: `Este link é só seu e vale até ${expira_em.split('-').reverse().join('/')}.`,
        }),
      })
      if (err) await logSystemError(c.supabase, { userId: c.userId, context: 'admissão: envio da proposta', error: `${a.email}: ${err}` })
      else enviado = true
    }
  }

  revalidatePath(`/${orgSlug}/rh/contratacoes`)
  return { url, token, expira_em, enviado }
}

export async function cancelarProcesso(orgSlug: string, id: string, motivo?: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_admissao_cancelar', { p_id: id, p_motivo: motivo ?? null })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/contratacoes`)
  return { ok: true }
}

/** LGPD: apaga o conteúdo pessoal e mantém só o registro de que o processo existiu. */
export async function limparDadosProcesso(orgSlug: string, id: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_admissao_limpar_dados', { p_id: id })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/contratacoes`)
  return { ok: true }
}

/** Ficha + anexos de um processo, para a conferência do RH. */
export async function carregarFicha(orgSlug: string, id: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: a, error } = await (c.supabase as any)
    .from('rh_admissao').select('ficha').eq('id', id).eq('org_id', c.orgId).maybeSingle()
  if (error) return { error: error.message }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: docs } = await (c.supabase as any)
    .from('rh_admissao_doc').select('id, tipo, nome').eq('admissao_id', id).order('enviado_em')
  return {
    ficha: (a?.ficha ?? null) as FichaAdmissao | null,
    docs: (docs ?? []) as { id: string; tipo: string; nome: string | null }[],
  }
}

/** O processo vira ficha no RH: colaborador, jornada e anexos (mig. 336). */
export async function efetivarAdmissao(orgSlug: string, id: string, dados?: Record<string, string | null>) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_admissao_efetivar', { p_id: id, p_dados: dados ?? {} })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/contratacoes`)
  revalidatePath(`/${orgSlug}/rh`)
  return data as { colaborador_id: string; documentos: number; data_admissao: string }
}

/**
 * Manda a ficha para a contabilidade: PDF no formato que ela já recebe, mais
 * os anexos do candidato. Mesma lista de e-mails do fechamento do ponto.
 */
export async function enviarContabilidade(orgSlug: string, id: string, corpo?: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const sb = c.supabase as SupabaseLike

  const { data: a } = await sb.from('rh_admissao')
    .select('org_id, nome, cargo, tipo_vinculo, salario, data_inicio, jornada, beneficios, exame_em, ficha, contabil_em')
    .eq('id', id).maybeSingle()
  if (!a) return { error: 'Processo não encontrado' }

  const { data: cfg } = await sb.from('org_settings')
    .select('rh_contabil_emails, logo_url').eq('org_id', c.orgId).maybeSingle()
  const destinatarios = (cfg?.rh_contabil_emails ?? []) as string[]
  if (!destinatarios.length) return { error: 'Nenhum e-mail do RH da contabilidade configurado (Ponto → Fechamento).' }

  const { data: docs } = await sb.from('rh_admissao_doc').select('id, tipo, nome, chave').eq('admissao_id', id)
  const anexosCand = (docs ?? []) as { id: string; tipo: string; nome: string | null; chave: string }[]

  try {
    const { renderToBuffer } = await import('@react-pdf/renderer')
    const { FichaAdmissaoDoc } = await import('@/lib/pdf/FichaAdmissaoDoc')
    const { loadOrgDocs } = await import('@/lib/agency')
    const { lerPrivado } = await import('@/lib/arquivo-privado')
    const { agency } = await loadOrgDocs(sb, c.orgId)
    const nome = nomeLegivel(String(a.nome))

    const pdf = await renderToBuffer(FichaAdmissaoDoc({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      d: { ...(a as any), nome, anexos: anexosCand.map(x => ({ tipo: x.tipo, nome: x.nome })) },
      agencia: agency, logoUrl: cfg?.logo_url ?? null,
    }))

    const anexos: MailAttachment[] = [{ filename: `Ficha de admissão — ${nome}.pdf`, content: Buffer.from(pdf) }]
    // Os documentos do candidato vão junto, até caber: e-mail com 40MB volta.
    let orcamento = 12 * 1024 * 1024
    const foraDoEmail: string[] = []
    for (const d of anexosCand) {
      const buf = await lerPrivado(d.chave)
      if (!buf) continue
      if (buf.length > orcamento) { foraDoEmail.push(d.nome ?? d.tipo); continue }
      orcamento -= buf.length
      anexos.push({ filename: `${d.tipo} — ${d.nome ?? 'anexo'}`, content: buf })
    }

    const reenvio = !!a.contabil_em
    const texto = (corpo ?? '').trim()
    const html = `
      ${reenvio ? '<p><strong>Versão corrigida</strong> — substitui a ficha enviada antes.</p>' : ''}
      ${texto ? texto.split(/\n+/).map(l => `<p>${escapeHtml(l)}</p>`).join('\n') : ''}
      <p>Segue a ficha de admissão de <b>${escapeHtml(nome)}</b>${a.cargo ? ` — ${escapeHtml(String(a.cargo))}` : ''}${a.data_inicio ? `, com admissão em ${String(a.data_inicio).split('-').reverse().join('/')}` : ''}.</p>
      ${foraDoEmail.length ? `<p style="color:#b45309">Anexos grandes ficaram fora do e-mail: ${foraDoEmail.map(escapeHtml).join(', ')}. Peça que a agência envie à parte.</p>` : ''}
      <p style="color:#888;font-size:12px">Enviado pelo Flow — ficha em PDF e documentos anexos.</p>`

    const { error: mailErr } = await sendMail({
      to: destinatarios,
      subject: `${reenvio ? '[Corrigida] ' : ''}Ficha de admissão — ${nome}`,
      html, attachments: anexos,
    })
    if (mailErr) {
      await logSystemError(c.supabase, { userId: c.userId, context: 'admissão: envio à contabilidade', error: mailErr })
      return { error: `Não foi possível enviar: ${mailErr}` }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: markErr } = await (c.supabase as any)
      .rpc('rh_admissao_marcar_contabil', { p_id: id, p_para: destinatarios })
    if (markErr) return { error: `E-mail enviado, mas o registro falhou: ${markErr.message}` }

    revalidatePath(`/${orgSlug}/rh/contratacoes`)
    return { ok: true, destinatarios, foraDoEmail }
  } catch (e) {
    await logSystemError(c.supabase, { userId: c.userId, context: 'admissão: envio à contabilidade', error: String(e) })
    return { error: 'Falha ao montar o pacote da contabilidade.' }
  }
}
