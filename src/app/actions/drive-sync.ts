'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { driveConfigured, listSubfolders, inspectTaskFolder, createTaskFolders, type TaskFoldersResult } from '@/lib/google-drive'
import { logSystemError } from '@/lib/system-error'

const DEFAULT_PREFIX = 'G:\\Drives compartilhados\\'

/** Normaliza nome p/ casamento: sem acento, minúsculas, sem numeração "01 - ", separadores unificados. */
function norm(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/^\d+\s*[-_.)]+\s*/, '')
    .replace(/[\s_-]+/g, ' ')
    .trim()
}

export interface DriveMatch {
  activityId: string; title: string
  folderId: string; folderName: string; folderLink: string
  confidence: 'exato' | 'normalizado'
  alreadyLinked: boolean
}
export interface DriveReconcile {
  matched: DriveMatch[]
  jobsSemPasta: { activityId: string; title: string }[]
  pastasSemJob: { folderId: string; name: string; link: string }[]
}

export async function reconcileCampaignDrive(orgSlug: string, campaignId: string): Promise<{ error: string } | DriveReconcile> {
  if (!driveConfigured()) return { error: 'Integração com o Drive não configurada (GOOGLE_SERVICE_ACCOUNT_KEY).' }
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: camp } = await supabase.from('campaigns').select('drive_folder_id').eq('id', campaignId).single()
  const folderId = (camp as { drive_folder_id: string | null } | null)?.drive_folder_id
  if (!folderId) return { error: 'Esta campanha ainda não tem pasta do Drive vinculada. Edite a campanha e cole o link do Drive.' }

  const { data: acts } = await supabase
    .from('activities').select('id, title, drive_folder_id')
    .eq('campaign_id', campaignId).eq('archived', false)
  const activities = (acts ?? []) as { id: string; title: string; drive_folder_id: string | null }[]

  let folders: { id: string; name: string; link: string }[]
  try { folders = await listSubfolders(folderId) }
  catch (e) { return { error: e instanceof Error ? e.message : 'Falha ao ler a pasta do Drive.' } }

  const usedFolder = new Set<string>()
  const matched: DriveMatch[] = []
  const jobsSemPasta: { activityId: string; title: string }[] = []

  for (const a of activities) {
    const exact = folders.find(f => !usedFolder.has(f.id) && f.name.trim() === a.title.trim())
    const na = norm(a.title)
    const hit = exact ?? (na ? folders.find(f => !usedFolder.has(f.id) && norm(f.name) === na) : undefined)
    if (hit) {
      usedFolder.add(hit.id)
      matched.push({
        activityId: a.id, title: a.title,
        folderId: hit.id, folderName: hit.name, folderLink: hit.link,
        confidence: exact ? 'exato' : 'normalizado',
        alreadyLinked: a.drive_folder_id === hit.id,
      })
    } else {
      jobsSemPasta.push({ activityId: a.id, title: a.title })
    }
  }

  const pastasSemJob = folders
    .filter(f => !usedFolder.has(f.id))
    .map(f => ({ folderId: f.id, name: f.name, link: f.link }))

  return { matched, jobsSemPasta, pastasSemJob }
}

export interface ApplyDecisions {
  link: { activityId: string; folderId: string }[]
  createFolders: { activityId: string; title: string }[]
  novosJobs: { folderId: string; name: string }[]
}

export async function applyCampaignDriveReconcile(
  orgSlug: string, campaignId: string, decisions: ApplyDecisions,
): Promise<{ error: string } | { linked: number; created: number; jobs: number }> {
  if (!driveConfigured()) return { error: 'Integração com o Drive não configurada.' }
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: camp } = await supabase
    .from('campaigns').select('drive_folder_id, workspaces(org_id)').eq('id', campaignId).single()
  const folderId = (camp as { drive_folder_id: string | null } | null)?.drive_folder_id
  if (!folderId) return { error: 'Campanha sem pasta do Drive.' }

  // Prefixo do caminho local (org_settings, igual ao provisioning).
  let prefix = DEFAULT_PREFIX
  const orgId = (camp as unknown as { workspaces: { org_id: string } | null } | null)?.workspaces?.org_id
  if (orgId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: s } = await (supabase as any).from('org_settings').select('drive_path_prefix').eq('org_id', orgId).single()
    if (s?.drive_path_prefix) prefix = s.drive_path_prefix
  }
  const joinLocal = (drivePath: string) => `${prefix.replace(/[\\/]+$/, '')}\\${drivePath}\\`

  const persist = (activityId: string, r: TaskFoldersResult) => supabase.rpc('set_activity_drive', {
    p_user_id: user.id,
    p_activity_id: activityId,
    p_drive_folder_id: r.taskFolderId,
    p_drive_path: joinLocal(r.drivePath),
    p_drive_folder_url: r.taskFolderLink,
    p_redacao_url: r.sub['Redação']?.link ?? null,
    p_finalizacao_url: r.sub['Final']?.link ?? null,
    p_preview_url: r.sub['Preview']?.link ?? null,
  })

  let linked = 0, created = 0, jobs = 0

  // 1. Vincular jobs a pastas já existentes.
  for (const l of decisions.link ?? []) {
    try { await persist(l.activityId, await inspectTaskFolder(l.folderId)); linked++ }
    catch (e) {
      console.error('[drive-sync] link falhou', l.activityId, e)
      await logSystemError(supabase, { userId: user.id, context: 'drive:reconcile:link', error: e, activityId: l.activityId })
    }
  }

  // 2. Criar pastas faltantes para jobs sem pasta (cria a pasta da tarefa + subpastas).
  for (const c of decisions.createFolders ?? []) {
    try { await persist(c.activityId, await createTaskFolders(folderId, c.title)); created++ }
    catch (e) {
      console.error('[drive-sync] criar pasta falhou', c.activityId, e)
      await logSystemError(supabase, { userId: user.id, context: 'drive:reconcile:criar-pasta', error: e, activityId: c.activityId })
    }
  }

  // 3. Criar novos jobs a partir de pastas órfãs (activity + vínculo).
  for (const n of decisions.novosJobs ?? []) {
    try {
      // create_activity tem defaults não refletidos nos tipos gerados — cast como no resto do app.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: actId, error } = await (supabase as any).rpc('create_activity', {
        p_user_id: user.id, p_campaign_id: campaignId, p_title: n.name,
      })
      if (error || !actId) {
        console.error('[drive-sync] criar job falhou', n.name, error)
        await logSystemError(supabase, { userId: user.id, context: 'drive:reconcile:criar-job', error: error ?? new Error(`Sem id ao criar job a partir da pasta "${n.name}"`) })
        continue
      }
      await persist(actId as string, await inspectTaskFolder(n.folderId))
      jobs++
    } catch (e) {
      console.error('[drive-sync] criar job falhou', n.name, e)
      await logSystemError(supabase, { userId: user.id, context: 'drive:reconcile:criar-job', error: e })
    }
  }

  return { linked, created, jobs }
}
