import 'server-only'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createTaskFolders, moveTaskFolder, driveConfigured } from '@/lib/google-drive'

const DEFAULT_PREFIX = 'G:\\Drives compartilhados\\'

function joinLocalPath(prefix: string, drivePath: string): string {
  const p = prefix.replace(/[\\/]+$/, '')   // remove barra final
  return `${p}\\${drivePath}\\`
}

/** Resolve a pasta da campanha + o prefixo de caminho local (ou null se não dá p/ provisionar). */
async function resolve(supabase: SupabaseClient<Database>, campaignId: string): Promise<{ folderId: string; prefix: string } | null> {
  if (!driveConfigured()) return null

  const { data: camp } = await supabase
    .from('campaigns')
    .select('drive_folder_id, workspaces(org_id)')
    .eq('id', campaignId)
    .single()

  const folderId = (camp as { drive_folder_id: string | null } | null)?.drive_folder_id
  if (!folderId) return null

  let prefix = DEFAULT_PREFIX
  const orgId = (camp as unknown as { workspaces: { org_id: string } | null } | null)?.workspaces?.org_id
  if (orgId) {
    // org_settings não é tipado (acesso por cast, igual ao resto do app)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: s } = await (supabase as any)
      .from('org_settings').select('drive_path_prefix').eq('org_id', orgId).single()
    if (s?.drive_path_prefix) prefix = s.drive_path_prefix
  }
  return { folderId, prefix }
}

/**
 * Cria, em 2º plano (após a resposta), a pasta da tarefa + subpastas no Drive e
 * salva os links/caminho na atividade. Não lança — falha só vai pro log.
 */
export async function provisionActivitiesDrive(
  supabase: SupabaseClient<Database>,
  params: { campaignId: string; userId: string; items: { activityId: string; title: string }[] },
) {
  const cfg = await resolve(supabase, params.campaignId)
  if (!cfg) return

  after(async () => {
    for (const it of params.items) {
      try {
        const r = await createTaskFolders(cfg.folderId, it.title)
        await supabase.rpc('set_activity_drive', {
          p_user_id: params.userId,
          p_activity_id: it.activityId,
          p_drive_folder_id: r.taskFolderId,
          p_drive_path: joinLocalPath(cfg.prefix, r.drivePath),
          p_drive_folder_url: r.taskFolderLink,
          p_redacao_url: r.sub['Redação']?.link ?? null,
          p_finalizacao_url: r.sub['Final']?.link ?? null,
          p_preview_url: r.sub['Preview']?.link ?? null,
        })
      } catch (e) {
        console.error('[drive] provision falhou para', it.activityId, e)
      }
    }
  })
}

/**
 * Ao mover a tarefa de projeto: leva a pasta do Drive junto (em 2º plano).
 * - Se a tarefa já tem pasta → reparenta pro projeto destino (todo o conteúdo e
 *   os links vão junto; só o caminho local muda).
 * - Se ainda não tem pasta → provisiona uma nova no projeto destino.
 * Se o projeto destino não tiver pasta vinculada, não mexe no Drive (move só no banco).
 */
export async function moveActivityDrive(
  supabase: SupabaseClient<Database>,
  params: { activityId: string; title: string; userId: string; oldFolderId: string | null; newCampaignId: string },
) {
  const cfg = await resolve(supabase, params.newCampaignId)
  if (!cfg) return

  after(async () => {
    try {
      if (params.oldFolderId) {
        // reparenta a pasta existente — só o caminho local muda (sublinks seguem válidos)
        const r = await moveTaskFolder(params.oldFolderId, cfg.folderId)
        await supabase.rpc('set_activity_drive', {
          p_user_id: params.userId,
          p_activity_id: params.activityId,
          p_drive_folder_id: null,
          p_drive_path: joinLocalPath(cfg.prefix, r.drivePath),
          p_drive_folder_url: null,
          p_redacao_url: null,
          p_finalizacao_url: null,
          p_preview_url: null,
        })
      } else {
        // tarefa sem pasta ainda → provisiona no destino
        const r = await createTaskFolders(cfg.folderId, params.title)
        await supabase.rpc('set_activity_drive', {
          p_user_id: params.userId,
          p_activity_id: params.activityId,
          p_drive_folder_id: r.taskFolderId,
          p_drive_path: joinLocalPath(cfg.prefix, r.drivePath),
          p_drive_folder_url: r.taskFolderLink,
          p_redacao_url: r.sub['Redação']?.link ?? null,
          p_finalizacao_url: r.sub['Final']?.link ?? null,
          p_preview_url: r.sub['Preview']?.link ?? null,
        })
      }
    } catch (e) {
      console.error('[drive] move falhou para', params.activityId, e)
    }
  })
}
