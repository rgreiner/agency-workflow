import 'server-only'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { STATUS_CONFIG } from '@/types'
import { driveConfigured, readRedacaoText } from '@/lib/google-drive'
import { reviewRedacaoText, reviewConfigured, type ReviewError } from '@/lib/ai/redacao-review'

const REDACAO = 'redacao'
const ORDER = STATUS_CONFIG.map(s => s.value as string)

/** É um avanço a partir de Redação? (sair de 'redacao' para um status posterior na ordem) */
export function isRedacaoAdvance(from: string | null | undefined, to: string): boolean {
  if (from !== REDACAO || to === REDACAO) return false
  return ORDER.indexOf(to) > ORDER.indexOf(REDACAO)
}

function formatErrorComment(errors: ReviewError[], provider: string): string {
  const n = errors.length
  const head = `⚠️ **Revisão de Redação** encontrou ${n} ${n === 1 ? 'apontamento' : 'apontamentos'} (${provider}). A tarefa voltou para Redação.`
  const list = errors.map((e, i) => {
    const tipo = e.tipo ? ` _(${e.tipo})_` : ''
    return `**${i + 1}.**${tipo} “${e.trecho}”\n• ${e.problema}\n• Correção: ${e.sugestao}`
  }).join('\n\n')
  const foot = '_Corrija e mova novamente, ou use “Avançar mesmo assim” se os apontamentos forem propositais._'
  return `${head}\n\n${list}\n\n${foot}`
}

/**
 * Agenda (em 2º plano) a revisão de Redação após um avanço de status. Pressupõe
 * que o status JÁ foi alterado para `toStatus` (modelo "avança e volta se houver
 * erro"). Nunca lança — qualquer falha vai só pro log.
 */
export function scheduleRedacaoReview(params: {
  supabase: SupabaseClient<Database>
  userId: string
  activityId: string
  toStatus: string
}) {
  if (!reviewConfigured() || !driveConfigured()) return
  const { supabase, userId, activityId, toStatus } = params

  after(async () => {
    const setReview = (status: string, errors: Json | null, target: string | null) =>
      supabase.rpc('set_redacao_review', {
        p_user_id: userId, p_activity_id: activityId, p_status: status, p_errors: errors, p_target: target,
      })
    const comment = (content: string) =>
      supabase.rpc('add_activity_comment', { p_user_id: userId, p_activity_id: activityId, p_content: content })

    try {
      await setReview('reviewing', null, null)

      const { data: act } = await supabase
        .from('activities').select('redacao_url').eq('id', activityId).single()
      const link = act?.redacao_url ?? ''

      let text = ''
      if (link) {
        try { text = (await readRedacaoText(link)).text }
        catch (e) { console.error('[redacao-review] leitura do Drive falhou', e) }
      }

      if (!text.trim()) {
        await setReview('clean', null, null)
        await comment('ℹ️ Revisão de Redação: não encontrei texto para revisar no link de Redação.')
        return
      }

      const result = await reviewRedacaoText(text)
      if (!result) return   // sem provider configurado

      if (result.clean) {
        await setReview('clean', null, null)
        await comment(`✅ **Textos revisados** — nenhum erro de português encontrado (${result.provider}).`)
        return
      }

      // Erros → grava o resultado, volta o status para Redação e comenta os apontamentos.
      await setReview('errors', result.errors as unknown as Json, toStatus)
      await supabase.rpc('update_activity_status', {
        p_user_id: userId, p_activity_id: activityId, p_new_status: REDACAO, p_comment: '',
      })
      await comment(formatErrorComment(result.errors, result.provider))
    } catch (e) {
      console.error('[redacao-review] falha no gate', e)
    }
  })
}
