import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { driveConfigured, readRedacaoText, readReviewAssets } from '@/lib/google-drive'
import { backendForRef } from '@/lib/task-folders'
import { readReviewAssetsS3 } from '@/lib/s3-folders'
import { reviewText, reviewArtwork, type ReviewError } from '@/lib/ai/review'
import type { RevisaoConfig } from '@/lib/ai/revisao-config'
import type { RevisaoEtapa } from '@/lib/ai/revisao-modelos'
import { logSystemError } from '@/lib/system-error'

/**
 * Revisão IA SOB DEMANDA: a pessoa aperta "Revisar" na tarefa ANTES de mover o
 * status, espera o resultado ali mesmo e decide. Nada trava a tarefa.
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
    const r = await reviewText(cfg, text)
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
  const r = await reviewArtwork(cfg, assets, aprovado)
  return { ok: true, ...r }
}

/** Texto do comentário no formato combinado: "Erro "trecho" - correção". */
export function comentarioRevisao(errors: ReviewError[]): string {
  if (!errors.length) return 'Revisão solicitada: nenhum erro encontrado.'
  return ['Revisão solicitada:', ...errors.map(e => `Erro "${e.trecho}" - ${e.correcao}`)].join('\n')
}
