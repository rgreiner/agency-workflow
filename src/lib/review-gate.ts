import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { driveConfigured, readRedacaoText, readReviewAssets } from '@/lib/google-drive'
import { backendForRef } from '@/lib/task-folders'
import { readReviewAssetsS3 } from '@/lib/s3-folders'
import { reviewText, reviewArtwork, type ReviewError, type ContextoRevisao } from '@/lib/ai/review'
import type { RevisaoConfig } from '@/lib/ai/revisao-config'
import { etapaRevisavel, ETAPAS, type RevisaoEtapa } from '@/lib/ai/revisao-modelos'
import { iaDaOrg, iaDisponivel } from '@/lib/ai/provedor'
import { stripHtml } from '@/lib/html'
import { STATUS_CONFIG } from '@/types'
import { logSystemError } from '@/lib/system-error'

/**
 * Revisão IA SOB DEMANDA: a pessoa aperta "Revisar" na tarefa ANTES de mover o
 * status e vê o resultado ali mesmo. Para AVANÇAR a etapa é preciso ter revisado
 * desde que a tarefa entrou nela; com apontamentos, a pessoa confirma que segue
 * com eles (decisão dela, registrada). Ver checarAvanco.
 *
 * Substitui a revisão automática depois do avanço (até 09/2026): ela rodava em 2º
 * plano, a resposta chegava minutos depois e a tarefa VOLTAVA de status quando a
 * pessoa já estava em outra coisa.
 */

export type RevisaoOutcome =
  | { ok: true; errors: ReviewError[]; model: string; truncated: boolean }
  | { ok: false; vazio: string }

/** Lê o material da etapa e chama a IA. Lança em falha da IA (quem chama traduz). */
export async function revisarAtividade(
  supabase: SupabaseClient<Database>,
  activityId: string,
  userId: string,
  etapa: RevisaoEtapa,
  cfg: RevisaoConfig,
): Promise<RevisaoOutcome> {
  const { data: act } = await supabase
    .from('activities').select('drive_folder_id, redacao_url, preview_url, finalizacao_url').eq('id', activityId).single()

  // Backend da pasta pelo formato da ref. No S3 as peças vêm da subpasta derivada
  // (a ref é o caminho no bucket); no Drive, dos links salvos.
  const folderRef = (act?.drive_folder_id ?? '').trim()
  const isS3 = !!folderRef && backendForRef(folderRef) === 's3'

  const lerRedacao = async (contexto: string): Promise<string> => {
    const link = act?.redacao_url ?? ''
    if (isS3 || !link || !driveConfigured()) return ''
    try { return (await readRedacaoText(link)).text } catch (e) {
      console.error(`[${contexto}] leitura da Redação falhou`, e)
      await logSystemError(supabase, { userId, context: `${contexto}:leitura`, error: e, activityId })
      return ''
    }
  }

  if (etapa === 'redacao') {
    // No S3 a redação é .docx; o leitor de Word entra com o módulo de Redação.
    if (isS3) return { ok: false, vazio: 'A redação desta tarefa está em arquivo Word — a revisão de texto ainda não lê .docx.' }
    if (!act?.redacao_url) return { ok: false, vazio: 'Sem link de Redação nesta tarefa.' }
    const text = await lerRedacao('review:redacao')
    if (!text.trim()) return { ok: false, vazio: 'O Doc de Redação está vazio.' }
    const r = await reviewText(cfg, text, await contextoDaTarefa(supabase, activityId))
    return { ok: true, ...r }
  }

  const sub = etapa === 'design' ? 'Preview' : 'Final'
  let assets
  if (isS3) {
    assets = (await readReviewAssetsS3(`${folderRef}/${sub}`)).assets
  } else {
    const link = (etapa === 'design' ? act?.preview_url : act?.finalizacao_url) ?? ''
    if (!link || !driveConfigured()) return { ok: false, vazio: `Sem pasta de ${sub} nesta tarefa.` }
    assets = (await readReviewAssets(link)).assets
  }
  if (!assets.length) return { ok: false, vazio: `Nenhuma peça (imagem/PDF) na pasta ${sub}.` }

  // Design confere também contra o texto aprovado da Redação (mesma chamada).
  const aprovado = etapa === 'design' ? await lerRedacao('review:design') : ''
  const r = await reviewArtwork(cfg, assets, aprovado, await contextoDaTarefa(supabase, activityId))
  return { ok: true, ...r }
}

/**
 * Briefing + últimos comentários da tarefa, em texto puro, para o olhar de
 * contexto da revisão (o material atende ao que foi pedido?). 25 comentários
 * cobrem as idas e vindas de uma etapa sem estourar o custo.
 */
async function contextoDaTarefa(supabase: SupabaseClient<Database>, activityId: string): Promise<ContextoRevisao> {
  const [{ data: act }, { data: coms }] = await Promise.all([
    supabase.from('activities').select('description').eq('id', activityId).single(),
    supabase.from('activity_comments').select('content, created_at, profiles(full_name)')
      .eq('activity_id', activityId).order('created_at', { ascending: false }).limit(25),
  ])
  const comentarios = ((coms ?? []) as unknown as { content: string; created_at: string; profiles: { full_name: string | null } | null }[])
    .reverse()
    .map(c => ({
      autor: c.profiles?.full_name ?? 'Equipe',
      data: new Date(c.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      texto: stripHtml(c.content),
    }))
    // Comentários antigos da própria revisão (até 28/09) não são pedido de ninguém.
    .filter(c => c.texto && !/^(Revisão solicitada|✅ \*\*Revisão|⚠️ \*\*Revisão|⚠️ A revisão|ℹ️ Revisão)/.test(c.texto))
  return { briefing: stripHtml((act?.description as string | null) ?? ''), comentarios }
}

type SB = SupabaseClient<Database>

export type VeredictoAvanco =
  | { ok: true; nota?: string }
  | { ok: false; motivo: 'precisa_revisar'; mensagem: string }
  | { ok: false; motivo: 'confirmar'; mensagem: string; erros: ReviewError[]; falhou: boolean }

/**
 * Pode sair da etapa? Regra do Rafael (28/09/2026): antes de AVANÇAR de uma etapa
 * com Revisão ligada, a pessoa revisa; se a revisão apontou erros (ou a IA não
 * respondeu), ela confirma que segue assim — `aceitar` = essa confirmação, que
 * vira 'overridden' e uma nota na movimentação.
 *
 * "Revisou" = revisão desta etapa feita DEPOIS da última entrada na etapa: voltou
 * da validação, revisa de novo. Voltar para trás nunca é barrado. Revisão
 * desligada, etapa desligada ou org sem IA utilizável = não barra.
 */
export async function checarAvanco(
  supabase: SB, userId: string, activityId: string, from: string | null, to: string, aceitar: boolean,
): Promise<VeredictoAvanco> {
  const etapa = from ? etapaRevisavel(from) : null
  if (!etapa || to === from) return { ok: true }

  const { data: act } = await supabase
    .from('activities').select('review_kind, review_status, review_at, review_errors, campaigns(workspaces(org_id))')
    .eq('id', activityId).single()
  const orgId = (act as unknown as { campaigns: { workspaces: { org_id: string } | null } | null } | null)
    ?.campaigns?.workspaces?.org_id
  if (!act || !orgId) return { ok: true }

  if (!(await ehAvanco(supabase, orgId, etapa, to))) return { ok: true }

  const cfg = await iaDaOrg(orgId)
  if (!cfg?.enabled || !cfg.stages[etapa]) return { ok: true }
  // Sem IA que responda (Claude sem chave; Gemini sem chave nem no ambiente) não
  // dá pra exigir revisão — o botão nem funcionaria.
  if (!iaDisponivel(cfg)) return { ok: true }

  const label = ETAPAS.find(e => e.key === etapa)!.label
  const { data: entrada } = await supabase
    .from('activity_history').select('changed_at').eq('activity_id', activityId).eq('to_status', etapa)
    .order('changed_at', { ascending: false }).limit(1).maybeSingle()
  const a = act as unknown as { review_kind: string | null; review_status: string | null; review_at: string | null; review_errors: unknown }
  const valida = a.review_kind === etapa && !!a.review_at
    && (!entrada?.changed_at || new Date(a.review_at) >= new Date(entrada.changed_at as string))
  if (!valida || !a.review_status || a.review_status === 'reviewing') {
    return { ok: false, motivo: 'precisa_revisar', mensagem: `Revise ${label} antes de avançar: use o botão Revisar na tarefa.` }
  }
  if (a.review_status !== 'errors' && a.review_status !== 'failed') return { ok: true }

  const erros = Array.isArray(a.review_errors) ? (a.review_errors as ReviewError[]) : []
  const falhou = a.review_status === 'failed'
  if (!aceitar) {
    return {
      ok: false, motivo: 'confirmar', erros, falhou,
      mensagem: falhou
        ? `A revisão de ${label} não foi concluída. Abra a tarefa para confirmar que segue sem ela.`
        : `A revisão de ${label} tem ${erros.length} ${erros.length === 1 ? 'apontamento' : 'apontamentos'}. Abra a tarefa para confirmar que segue assim.`,
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).rpc('set_review', {
    p_user_id: userId, p_activity_id: activityId, p_kind: etapa, p_status: 'overridden', p_errors: falhou ? null : erros, p_target: to,
  })
  return {
    ok: true,
    nota: falhou
      ? `Seguiu sem a revisão de ${label} (a IA não respondeu).`
      : `Seguiu com ${erros.length} ${erros.length === 1 ? 'apontamento' : 'apontamentos'} da revisão de ${label}.`,
  }
}

/** `to` vem depois de `from` na ordem de status da org (cadastro org_status)? */
async function ehAvanco(supabase: SB, orgId: string, from: string, to: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('org_status').select('valor').eq('org_id', orgId).order('ordem') as { data: { valor: string }[] | null }
  const ordem = data?.length ? data.map(r => r.valor) : STATUS_CONFIG.map(s => s.value as string)
  const pos = (v: string) => { const i = ordem.indexOf(v); return i === -1 ? Number.MAX_SAFE_INTEGER : i }
  return pos(to) > pos(from)
}
