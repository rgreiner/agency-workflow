'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { sendMail, remetenteDominio } from '@/lib/email/send'
import { emailLayout } from '@/lib/email/layout'
import { logSystemError } from '@/lib/system-error'
import { novoToken } from '@/lib/admissao-server'
import { urlProposta, type JornadaProposta, type BeneficiosProposta } from '@/lib/admissao'
import type { FichaAdmissao } from '@/lib/admissao-ficha'

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
