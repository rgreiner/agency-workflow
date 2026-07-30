'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

/**
 * Cadastro de status da organização (migration 168) — Configurações → Aparência.
 * Toda a regra vive no banco (owner/admin, papel de sistema, tarefas órfãs);
 * aqui é só o transporte.
 */

/** Cria (valor null) ou edita um status. Renomear não muda o valor gravado. */
export async function salvarStatus(
  orgSlug: string, orgId: string, valor: string | null,
  data: { label: string; grupo?: string; bg?: string; txt?: string },
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: novo, error } = await (supabase as any).rpc('org_status_salvar', {
    p_org: orgId, p_valor: valor, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}`, 'layout')
  return { ok: true, valor: novo as string }
}

/** Exclui. Com tarefas no status, `moverPara` é obrigatório (o banco cobra). */
export async function excluirStatus(orgSlug: string, orgId: string, valor: string, moverPara?: string | null) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('org_status_excluir', {
    p_org: orgId, p_valor: valor, p_mover_para: moverPara || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}`, 'layout')
  return { ok: true, movidas: (data as { movidas?: number })?.movidas ?? 0 }
}

/** Reordena o fluxo (a ordem do array vira a ordem das etapas). */
export async function reordenarStatus(orgSlug: string, orgId: string, valores: string[]) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('org_status_reordenar', {
    p_org: orgId, p_valores: valores,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}`, 'layout')
  return { ok: true }
}

/** Quantas tarefas estão em cada status (para avisar antes de excluir). */
export async function contarTarefasPorStatus(orgId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('activities')
    .select('status, campaigns!inner(workspaces!inner(org_id))')
    .eq('campaigns.workspaces.org_id', orgId)
  const out: Record<string, number> = {}
  for (const r of (data ?? []) as { status: string }[]) out[r.status] = (out[r.status] ?? 0) + 1
  return out
}
