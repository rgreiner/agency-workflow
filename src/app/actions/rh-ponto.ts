'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string, userId: user.id as string }
}

/** Bate uma marcação (entrada/intervalo_ini/intervalo_fim/saida) do próprio colaborador. */
export async function baterPonto(orgSlug: string, colaboradorId: string, tipo: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_bater_ponto', { p_colaborador_id: colaboradorId, p_tipo: tipo })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/ponto`)
  return { ok: true, resultado: data }
}

/** Abre uma justificativa (falta/atestado/esqueci) → decisão do RH. */
export async function criarJustificativa(
  orgSlug: string, colaboradorId: string,
  j: {
    tipo: string; data_ini: string; data_fim: string; descricao?: string | null; doc_id?: string | null
    // Horário correto (opcional): se informado, a aprovação do RH AJUSTA a marcação.
    hora_entrada?: string | null; hora_intervalo_ini?: string | null
    hora_intervalo_fim?: string | null; hora_saida?: string | null
  },
) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).from('rh_justificativa').insert({
    org_id: c.orgId, colaborador_id: colaboradorId, tipo: j.tipo,
    data_ini: j.data_ini, data_fim: j.data_fim || j.data_ini,
    descricao: j.descricao || null, doc_id: j.doc_id || null, created_by: c.userId,
    hora_entrada: j.hora_entrada || null, hora_intervalo_ini: j.hora_intervalo_ini || null,
    hora_intervalo_fim: j.hora_intervalo_fim || null, hora_saida: j.hora_saida || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/ponto`)
  revalidatePath(`/${orgSlug}/rh/ponto`)
  return { ok: true }
}

/** RH decide a justificativa: aprovado | rejeitado | abonado | falta.
 *  Se `horas` vier (ou já estiver na justificativa), aprovar AJUSTA a marcação do ponto
 *  — preservando a original em rh_ponto.ajuste_de. */
export async function decidirJustificativa(orgSlug: string, id: string, status: string, horas?: {
  hora_entrada?: string | null; hora_intervalo_ini?: string | null
  hora_intervalo_fim?: string | null; hora_saida?: string | null
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  if (!['aprovado', 'rejeitado', 'abonado', 'falta'].includes(status)) return { error: 'Status inválido' }

  // O RH pode corrigir/informar o horário na hora de decidir.
  if (horas && Object.values(horas).some(v => v)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e1 } = await (c.supabase as any).from('rh_justificativa')
      .update({
        hora_entrada: horas.hora_entrada || null, hora_intervalo_ini: horas.hora_intervalo_ini || null,
        hora_intervalo_fim: horas.hora_intervalo_fim || null, hora_saida: horas.hora_saida || null,
      })
      .eq('id', id).eq('org_id', c.orgId)
    if (e1) return { error: e1.message }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_decidir_justificativa', {
    p_id: id, p_status: status,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ponto`)
  revalidatePath(`/${orgSlug}/ponto`)
  return { ok: true, ajustados: (data as { pontos_ajustados: number })?.pontos_ajustados ?? 0 }
}

/** Gestor decide a hora extra do dia: aprovado | rejeitado (opcionalmente aloca em projeto). */
export async function decidirExtra(orgSlug: string, pontoId: string, status: string, projetoId?: string | null) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  if (!['aprovado', 'rejeitado'].includes(status)) return { error: 'Status inválido' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).from('rh_ponto')
    .update({ extra_status: status, extra_por: c.userId, extra_em: new Date().toISOString(), extra_projeto: projetoId || null })
    .eq('id', pontoId).eq('org_id', c.orgId)
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ponto`)
  return { ok: true }
}
