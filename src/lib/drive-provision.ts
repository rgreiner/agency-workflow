import 'server-only'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createTaskFolders, moveTaskFolder, inspectTaskFolder, completarSubpastas, folderConfigured, resolvePathPrefix, backendForRef, refIncompativel } from '@/lib/task-folders'
import { logSystemError } from '@/lib/system-error'

/**
 * Grava o vínculo assim que a pasta-mãe nasce, antes das subpastas. A provisão em
 * lote só salvava no FIM (pasta + 5 subpastas + caminho): qualquer corte no meio
 * — rede, restart do container, `after()` interrompido — deixava a pasta criada no
 * Drive e a tarefa SEM vínculo. Aí o próximo clique em "Gerar/Re-vincular" criava
 * uma SEGUNDA pasta de mesmo nome, e o time passava a cair na vazia pelo caminho
 * local. A varredura de 20/08/2026 achou 8 pastas órfãs assim em 34 campanhas.
 */
async function gravarVinculoCedo(
  supabase: SupabaseClient<Database>, userId: string, activityId: string, folder: { id: string; link: string },
) {
  await supabase.rpc('set_activity_drive', {
    p_user_id: userId,
    p_activity_id: activityId,
    p_drive_folder_id: folder.id,
    p_drive_path: null,
    p_drive_folder_url: folder.link || null,
    p_redacao_url: null,
    p_finalizacao_url: null,
    p_preview_url: null,
  })
}

function joinLocalPath(prefix: string, drivePath: string): string {
  const p = prefix.replace(/[\\/]+$/, '')   // remove barra final
  return `${p}\\${drivePath}\\`
}

/**
 * Nome da pasta = título com a DATA no começo (YYMMDD). Se o título já começa com
 * 6 dígitos (padrão "260623 - …"), mantém; senão prefixa a data da tarefa. Assim
 * dois trabalhos de mesmo nome mas datas diferentes nunca compartilham pasta.
 */
export function taskFolderName(title: string, isoDate?: string | null): string {
  const t = (title ?? '').trim()
  if (/^\d{6}(\D|$)/.test(t)) return t || 'Tarefa'
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return t || 'Tarefa'
  const d = `${isoDate.slice(2, 4)}${isoDate.slice(5, 7)}${isoDate.slice(8, 10)}`
  return t ? `${d} - ${t}` : d
}

/** Resolve a pasta da campanha + o prefixo de caminho local (ou null se não dá p/ provisionar). */
async function resolve(supabase: SupabaseClient<Database>, campaignId: string): Promise<{ folderId: string; prefix: string } | null> {
  if (!folderConfigured()) return null

  const { data: camp } = await supabase
    .from('campaigns')
    .select('drive_folder_id, workspaces(org_id)')
    .eq('id', campaignId)
    .single()

  const folderId = (camp as { drive_folder_id: string | null } | null)?.drive_folder_id
  if (!folderId) return null

  const orgId = (camp as unknown as { workspaces: { org_id: string } | null } | null)?.workspaces?.org_id
  let orgPrefix: string | null = null
  if (orgId) {
    // org_settings não é tipado (acesso por cast, igual ao resto do app)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: s } = await (supabase as any)
      .from('org_settings').select('drive_path_prefix').eq('org_id', orgId).single()
    orgPrefix = s?.drive_path_prefix ?? null
  }
  // Prefixo pelo backend DESTA campanha (Drive → G:\, S3 → F:\) — na transição as duas coexistem.
  return { folderId, prefix: resolvePathPrefix(orgPrefix, backendForRef(folderId)) }
}

/**
 * Cria, em 2º plano (após a resposta), a pasta da tarefa + subpastas no Drive e
 * salva os links/caminho na atividade. Não lança — falha só vai pro log.
 */
export async function provisionActivitiesDrive(
  supabase: SupabaseClient<Database>,
  params: { campaignId: string; userId: string; items: { activityId: string; title: string; date?: string | null }[]; forceNew?: boolean },
) {
  const cfg = await resolve(supabase, params.campaignId)
  if (!cfg) return

  after(async () => {
    for (const it of params.items) {
      try {
        const r = await createTaskFolders(cfg.folderId, taskFolderName(it.title, it.date), {
          forceNew: params.forceNew ?? true,
          onCreated: f => gravarVinculoCedo(supabase, params.userId, it.activityId, f),
        })
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
        await logSystemError(supabase, { userId: params.userId, context: 'drive:provision', error: e, activityId: it.activityId })
      }
    }
  })
}

/**
 * Gera/re-vincula a pasta de UMA tarefa — SÍNCRONO (pro botão dar feedback na hora).
 * Sempre cria uma pasta NOVA (forceNew) com o nome datado e regrava os links.
 */
export async function regenerateActivityDrive(
  supabase: SupabaseClient<Database>,
  params: { campaignId: string; userId: string; activityId: string; title: string; date?: string | null },
): Promise<{ ok: boolean; error?: string; url?: string }> {
  if (!folderConfigured()) return { ok: false, error: 'Integração de pastas não está configurada.' }
  const cfg = await resolve(supabase, params.campaignId)
  if (!cfg) return { ok: false, error: 'A campanha desta tarefa não tem pasta vinculada.' }
  // A referência da CAMPANHA é que manda aqui — pasta de campanha do backend
  // errado é o que faz a criação da tarefa estourar lá dentro.
  const refCampanha = refIncompativel(cfg.folderId)
  if (refCampanha) return { ok: false, error: refCampanha }
  try {
    const r = await createTaskFolders(cfg.folderId, taskFolderName(params.title, params.date), {
      forceNew: true,
      onCreated: f => gravarVinculoCedo(supabase, params.userId, params.activityId, f),
    })
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
    return { ok: true, url: r.taskFolderLink }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao criar a pasta no Drive' }
  }
}

/**
 * Relê a pasta EXISTENTE da tarefa no Drive e regrava os links das subpastas
 * (Redação/Final/Preview) e o caminho — corrige tarefa com pasta vinculada mas
 * campos sem link (provisão parcial). NÃO cria pasta nova (isso é o
 * regenerateActivityDrive). Síncrono, pro botão de correção dar feedback.
 */
export async function relinkActivityDrive(
  supabase: SupabaseClient<Database>,
  params: { campaignId: string; userId: string; activityId: string; folderId: string },
): Promise<{ ok: boolean; error?: string; faltando?: string[]; criadas?: string[] }> {
  if (!folderConfigured()) return { ok: false, error: 'Integração de pastas não está configurada.' }
  // Re-vincular com uma referência do backend errado é o caminho mais comum pro
  // "Storage S3 não configurado": a pessoa cola o caminho antigo do disco.
  const incompativel = refIncompativel(params.folderId)
  if (incompativel) return { ok: false, error: incompativel }
  const cfg = await resolve(supabase, params.campaignId)
  const prefix = cfg?.prefix ?? resolvePathPrefix(null, backendForRef(params.folderId))
  try {
    // Completa o que faltar ANTES de reler: pasta antiga foi criada à mão quando
    // "Final" era opcional, e sem isso a re-vinculação regravava null pra sempre.
    const { criadas } = await completarSubpastas(params.folderId)
    const r = await inspectTaskFolder(params.folderId)
    await supabase.rpc('set_activity_drive', {
      p_user_id: params.userId,
      p_activity_id: params.activityId,
      p_drive_folder_id: r.taskFolderId,
      p_drive_path: joinLocalPath(prefix, r.drivePath),
      p_drive_folder_url: r.taskFolderLink,
      p_redacao_url: r.sub['Redação']?.link ?? null,
      p_finalizacao_url: r.sub['Final']?.link ?? null,
      p_preview_url: r.sub['Preview']?.link ?? null,
    })
    // A subpasta que não existe no Drive vira link nulo — e o check acusa a mesma
    // tarefa de novo. Devolver o que FALTOU evita o "Corrigido." mentiroso, que
    // fazia a pessoa clicar em loop sem entender por que o item não sumia.
    const faltando = (['Redação', 'Final', 'Preview'] as const).filter(n => !r.sub[n])
    return { ok: true, faltando: [...faltando], criadas }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao reler a pasta no Drive' }
  }
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
        // Drive: reparenta e o ID sobrevive (sublinks seguem válidos; só o caminho muda).
        // S3: o caminho É a identidade — o move devolve newRef e a gente relê a pasta
        // nova pra regravar vínculo + sub-referências atualizados.
        const r = await moveTaskFolder(params.oldFolderId, cfg.folderId)
        const novo = r.newRef ? await inspectTaskFolder(r.newRef) : null
        await supabase.rpc('set_activity_drive', {
          p_user_id: params.userId,
          p_activity_id: params.activityId,
          p_drive_folder_id: novo?.taskFolderId ?? null,
          p_drive_path: joinLocalPath(cfg.prefix, r.drivePath),
          p_drive_folder_url: novo ? novo.taskFolderLink : null,
          p_redacao_url: novo ? (novo.sub['Redação']?.link ?? '') : null,
          p_finalizacao_url: novo ? (novo.sub['Final']?.link ?? '') : null,
          p_preview_url: novo ? (novo.sub['Preview']?.link ?? '') : null,
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
      await logSystemError(supabase, { userId: params.userId, context: 'drive:move', error: e, activityId: params.activityId })
    }
  })
}
