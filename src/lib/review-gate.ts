import 'server-only'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { STATUS_CONFIG } from '@/types'
import { driveConfigured, readRedacaoText, readReviewAssets } from '@/lib/google-drive'
import { reviewConfigured, reviewText, reviewArtwork, crossCheckRedacao, type ReviewError } from '@/lib/ai/review'
import { logSystemError } from '@/lib/system-error'

export type ReviewKind = 'redacao' | 'design' | 'finalizacao'

// Gate: status cujo AVANÇO dispara a revisão (e p/ onde a tarefa volta se houver erro).
const GATE_STATUS: Record<ReviewKind, string> = {
  redacao:     'redacao',
  design:      'design',
  finalizacao: 'finalizacao',
}
const KIND_LABEL: Record<ReviewKind, string> = {
  redacao:     'Redação',
  design:      'Design',
  finalizacao: 'Finalização',
}
const ORDER = STATUS_CONFIG.map(s => s.value as string)

// Teto de tempo da revisão em 2º plano — evita ficar preso em "revisando…".
const REVIEW_TIMEOUT_MS = 150_000

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`tempo esgotado em ${label} (${Math.round(ms / 1000)}s)`)), ms)),
  ])
}

/** Qual revisão disparar ao mudar de status (ou null). Avanço = sair do gate p/ um status posterior. */
export function reviewKindForAdvance(from: string | null | undefined, to: string): ReviewKind | null {
  for (const kind of Object.keys(GATE_STATUS) as ReviewKind[]) {
    const g = GATE_STATUS[kind]
    if (from === g && to !== g && ORDER.indexOf(to) > ORDER.indexOf(g)) return kind
  }
  return null
}

interface KindOutcome { clean: boolean; errors: ReviewError[]; provider: string; note?: string }

/**
 * Agenda (em 2º plano) a revisão por IA após um avanço de status. Pressupõe que o
 * status JÁ mudou (modelo "avança e volta se houver erro"). Nunca lança.
 */
export function scheduleReview(params: {
  supabase: SupabaseClient<Database>
  userId: string
  activityId: string
  kind: ReviewKind
  toStatus: string
}) {
  if (!reviewConfigured()) return
  const { supabase, userId, activityId, kind, toStatus } = params
  const label = KIND_LABEL[kind]

  after(async () => {
    const setReview = (status: string, errors: Json | null, target: string | null) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc('set_review', {
        p_user_id: userId, p_activity_id: activityId, p_kind: kind, p_status: status, p_errors: errors, p_target: target,
      })
    const comment = (content: string) =>
      supabase.rpc('add_activity_comment', { p_user_id: userId, p_activity_id: activityId, p_content: content })

    try {
      await setReview('reviewing', null, null)
      const out = await withTimeout(runKind(kind, supabase, activityId, userId), REVIEW_TIMEOUT_MS, `revisão de ${label}`)

      if (!out || out.note) {
        await setReview('clean', null, null)
        await comment(`ℹ️ Revisão de ${label}: ${out?.note ?? 'sem provider de IA configurado'} — nada para revisar.`)
        return
      }
      if (out.clean) {
        await setReview('clean', null, null)
        await comment(`✅ **Revisão de ${label}** (${out.provider}) — nenhum apontamento.`)
        return
      }

      await setReview('errors', out.errors as unknown as Json, toStatus)
      await supabase.rpc('update_activity_status', {
        p_user_id: userId, p_activity_id: activityId, p_new_status: GATE_STATUS[kind], p_comment: '',
      })
      await comment(formatErrorComment(label, out.errors, out.provider))
    } catch (e) {
      // Nunca deixa preso em "revisando…": finaliza como 'failed'. O erro técnico
      // (ex.: quota do provider) vai pro log de sistema (Configurações → Erros), NÃO
      // pro comentário — o usuário vê só um aviso limpo. A tarefa já avançou.
      console.error(`[review:${kind}] falha no gate`, e)
      try {
        await setReview('failed', null, null)
        await logSystemError(supabase, { userId, context: `review:${kind}`, error: e, activityId })
        await comment(`⚠️ A revisão de ${label} não pôde ser concluída automaticamente. A tarefa seguiu — confira manualmente.`)
      } catch (e2) {
        console.error(`[review:${kind}] falha ao registrar o erro da revisão`, e2)
      }
    }
  })
}

// ── Trabalho de cada revisão ────────────────────────────────────────────────

async function runKind(
  kind: ReviewKind,
  supabase: SupabaseClient<Database>,
  activityId: string,
  userId: string,
): Promise<KindOutcome | null> {
  const { data: act } = await supabase
    .from('activities').select('redacao_url, preview_url, finalizacao_url').eq('id', activityId).single()

  // Redação — texto de um Google Doc.
  if (kind === 'redacao') {
    const link = act?.redacao_url ?? ''
    if (!link || !driveConfigured()) return { clean: true, errors: [], provider: '—', note: 'sem link de Redação' }
    let text = ''
    try { text = (await readRedacaoText(link)).text } catch (e) {
      console.error('[review:redacao] leitura falhou', e)
      await logSystemError(supabase, { userId, context: 'review:redacao:leitura', error: e, activityId })
    }
    if (!text.trim()) return { clean: true, errors: [], provider: '—', note: 'sem texto na Redação' }
    const r = await reviewText(text)
    if (!r) return null
    return { clean: r.clean, errors: r.errors, provider: r.provider }
  }

  // Finalização — ortografia do arquivo pronto (imagem/PDF).
  if (kind === 'finalizacao') {
    const link = act?.finalizacao_url ?? ''
    if (!link || !driveConfigured()) return { clean: true, errors: [], provider: '—', note: 'sem arquivo de Finalização' }
    const { assets } = await readReviewAssets(link)
    if (!assets.length) return { clean: true, errors: [], provider: '—', note: 'sem peças no arquivo de Finalização' }
    const r = await reviewArtwork(assets)
    if (!r) return null
    return { clean: r.clean, errors: r.errors, provider: r.provider }
  }

  // Design — duas frentes: (1) ortografia nas peças do Preview, (2) cruzar com a Redação.
  const previewLink = act?.preview_url ?? ''
  if (!previewLink || !driveConfigured()) return { clean: true, errors: [], provider: '—', note: 'sem pasta de Preview' }
  const { assets } = await readReviewAssets(previewLink)
  if (!assets.length) return { clean: true, errors: [], provider: '—', note: 'sem peças no Preview' }

  const spell = await reviewArtwork(assets)
  if (!spell) return null

  let crossErrors: ReviewError[] = []
  const redLink = act?.redacao_url ?? ''
  if (redLink) {
    let text = ''
    try { text = (await readRedacaoText(redLink)).text } catch (e) {
      console.error('[review:design] leitura da Redação falhou', e)
      await logSystemError(supabase, { userId, context: 'review:design:leitura', error: e, activityId })
    }
    if (text.trim()) {
      const cc = await crossCheckRedacao(text, assets)
      if (cc) crossErrors = cc.errors
    }
  }

  const errors = [...spell.errors, ...crossErrors]
  return { clean: errors.length === 0, errors, provider: spell.provider }
}

// ── Comentário de apontamentos ──────────────────────────────────────────────

function formatErrorComment(label: string, errors: ReviewError[], provider: string): string {
  const n = errors.length
  const head = `⚠️ **Revisão de ${label}** encontrou ${n} ${n === 1 ? 'apontamento' : 'apontamentos'} (${provider}). A tarefa voltou para ${label}.`
  const list = errors.map((e, i) => {
    const tipo = e.tipo ? ` _(${e.tipo})_` : ''
    return `**${i + 1}.**${tipo} “${e.trecho}”\n• ${e.problema}\n• Correção: ${e.sugestao}`
  }).join('\n\n')
  const foot = '_Corrija e mova novamente, ou use "Avançar mesmo assim" se for proposital — nesse caso você assume os apontamentos._'
  return `${head}\n\n${list}\n\n${foot}`
}
