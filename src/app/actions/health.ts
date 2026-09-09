'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { regenerarPastaDrive, renomearPastaDrive } from '@/app/actions/activity'
import { relinkActivityDrive } from '@/lib/drive-provision'
import { runDriveFolderChecks, type HealthCheck, type HealthFix } from '@/lib/health/checks'

/**
 * Aplica a correção de um item de verificação. Ponto único de despacho: a UI só
 * conhece o `HealthFix`; aqui mapeamos cada `kind` pra ação real. Novos checks
 * com correção entram adicionando um `case`.
 */
export async function applyHealthFix(orgSlug: string, fix: HealthFix): Promise<{ error?: string; ok?: boolean; aviso?: string }> {
  const path = `/${orgSlug}/settings/saude`
  switch (fix.kind) {
    case 'provision-drive': {
      const res = await regenerarPastaDrive(orgSlug, path, fix.activityId)
      if (res?.error) return { error: res.error }
      return { ok: true }
    }
    case 'relink-drive': {
      const supabase = await createClient()
      const user = await getUsuario()
      if (!user) return { error: 'Não autenticado' }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: act } = await (supabase as any)
        .from('activities').select('campaign_id, drive_folder_id').eq('id', fix.activityId).single()
      if (!act?.drive_folder_id) return { error: 'Tarefa sem pasta de Drive vinculada.' }
      const res = await relinkActivityDrive(supabase, {
        campaignId: act.campaign_id, userId: user.id, activityId: fix.activityId, folderId: act.drive_folder_id,
      })
      if (!res.ok) return { error: res.error }
      if (res.faltando?.length) {
        return { ok: true, aviso: `A pasta no Drive segue sem ${res.faltando.join(', ')} — confira as permissões da pasta.` }
      }
      if (res.criadas?.length) {
        return { ok: true, aviso: `Criei a subpasta ${res.criadas.join(', ')} no Drive e vinculei.` }
      }
      return { ok: true }
    }
    case 'rename-drive': {
      // Daqui o clique É a validação (só admin chega aqui): renomeia mesmo com arquivo.
      const res = await renomearPastaDrive(orgSlug, path, fix.activityId, true)
      if ('error' in res && res.error) return { error: res.error }
      return { ok: true }
    }
    default:
      return { error: 'Correção desconhecida.' }
  }
}

/**
 * Confere as pastas das tarefas ativas no Drive — sob demanda (1 chamada por
 * tarefa, ~3–4 s), por isso não roda junto com os checks baratos da página.
 */
export async function verificarPastasDrive(orgSlug: string): Promise<{ error: string } | { checks: HealthCheck[] }> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any)
    .from('organization_members').select('role').eq('org_id', org.id).eq('user_id', user.id).single() as { data: { role: string } | null }
  if (!m || !['owner', 'admin'].includes(m.role)) return { error: 'Só administradores podem rodar esta verificação.' }
  try {
    return { checks: await runDriveFolderChecks(supabase, org.id, orgSlug) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao consultar o Drive' }
  }
}
