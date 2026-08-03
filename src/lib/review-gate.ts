import 'server-only'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { STATUS_CONFIG } from '@/types'
import { driveConfigured, readRedacaoText, readReviewAssets } from '@/lib/google-drive'
import { backendForRef } from '@/lib/task-folders'
import { readReviewAssetsS3 } from '@/lib/s3-folders'
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
// Ordem do fluxo. Com status configuráveis (migration 168) a ordem é da ORG —
// `ordem` da tabela org_status. A lista fixa fica como fallback, e status que a
// org criou depois do gate entram no fim (indexOf -1 → tratado em `posicao`).
const ORDER = STATUS_CONFIG.map(s => s.value as string)

function posicao(ordem: string[], v: string): number {
  const i = ordem.indexOf(v)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

// Teto de tempo POR TENTATIVA — evita ficar preso em "revisando…".
const REVIEW_TIMEOUT_MS = 150_000
// Sobrecarga do provider (529 "Overloaded", 429, 5xx) costuma passar em segundos.
// O SDK já retenta rápido; esta espera é a de fôlego, entre tentativas cheias.
const RETRY_DELAY_MS = 45_000
const TENTATIVAS = 2

const espera = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Falha que vale retentar: sobrecarga/limite do provider, 5xx e queda de rede.
 * Erro de conteúdo (schema, arquivo ilegível, chave inválida) NÃO entra aqui —
 * repetir só gastaria tempo e daria o mesmo resultado.
 */
function ehTransiente(e: unknown): boolean {
  const status = (e as { status?: number })?.status
  if (typeof status === 'number') return status === 408 || status === 429 || status >= 500
  const msg = String((e as Error)?.message ?? e)
  // O caminho do Gemini não é SDK: o erro chega como texto ("Gemini 503: …"),
  // então o código HTTP no começo da mensagem também vale como sinal.
  return /^\D{0,20}\b(408|429|5\d\d)\b/.test(msg)
    || /overloaded|rate.?limit|too many requests|quota|timeout|tempo esgotado|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(msg)
}

/** Roda a revisão com uma segunda chance quando a falha é transitória. */
async function comTentativas(
  kind: ReviewKind,
  supabase: SupabaseClient<Database>,
  activityId: string,
  userId: string,
  label: string,
): Promise<KindOutcome | null> {
  let ultimo: unknown
  for (let n = 1; n <= TENTATIVAS; n++) {
    try {
      return await withTimeout(runKind(kind, supabase, activityId, userId), REVIEW_TIMEOUT_MS, `revisão de ${label}`)
    } catch (e) {
      ultimo = e
      if (n === TENTATIVAS || !ehTransiente(e)) throw e
      console.warn(`[review:${kind}] tentativa ${n} falhou (transitória), repetindo em ${RETRY_DELAY_MS / 1000}s`, e)
      await espera(RETRY_DELAY_MS)
    }
  }
  throw ultimo
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`tempo esgotado em ${label} (${Math.round(ms / 1000)}s)`)), ms)),
  ])
}

/** Qual revisão disparar ao mudar de status (ou null). Avanço = sair do gate p/ um status posterior. */
export function reviewKindForAdvance(
  from: string | null | undefined,
  to: string,
  ordem: string[] = ORDER,
): ReviewKind | null {
  const ord = ordem.length ? ordem : ORDER
  for (const kind of Object.keys(GATE_STATUS) as ReviewKind[]) {
    const g = GATE_STATUS[kind]
    if (from === g && to !== g && posicao(ord, to) > posicao(ord, g)) return kind
  }
  return null
}

/**
 * Ordem do fluxo da org dona desta tarefa (cadastro de status), com fallback na
 * lista fixa. Uma query só — quem chama em lote resolve pelo primeiro id.
 */
export async function ordemStatusDaAtividade(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, activityId: string | undefined,
): Promise<string[]> {
  if (!activityId) return ORDER
  const { data: act } = await supabase
    .from('activities').select('campaigns(workspaces(org_id))').eq('id', activityId).single()
  const campanha = (act as { campaigns?: { workspaces?: { org_id?: string } } } | null)?.campaigns
  const orgId = campanha?.workspaces?.org_id
  if (!orgId) return ORDER
  const { data } = await supabase
    .from('org_status').select('valor').eq('org_id', orgId).order('ordem') as { data: { valor: string }[] | null }
  return data?.length ? data.map(r => r.valor) : ORDER
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
    // Gate desligado na config da org (Configurações → Revisão IA)? Sai em
    // silêncio, sem tocar na tarefa. Qualquer falha na leitura (linha/coluna
    // ausente) = revisão segue LIGADA (default-on).
    try {
      const { data: act } = await supabase
        .from('activities').select('campaigns(workspaces(org_id))').eq('id', activityId).single()
      const orgId = (act as unknown as { campaigns: { workspaces: { org_id: string } | null } | null } | null)
        ?.campaigns?.workspaces?.org_id
      if (orgId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: s } = await (supabase as any)
          .from('org_settings').select('review_gates').eq('org_id', orgId).single()
        if (s?.review_gates?.[kind] === false) return
      }
    } catch { /* default-on */ }

    const setReview = (status: string, errors: Json | null, target: string | null) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc('set_review', {
        p_user_id: userId, p_activity_id: activityId, p_kind: kind, p_status: status, p_errors: errors, p_target: target,
      })
    const comment = (content: string) =>
      supabase.rpc('add_activity_comment', { p_user_id: userId, p_activity_id: activityId, p_content: content })

    try {
      await setReview('reviewing', null, null)
      const out = await comTentativas(kind, supabase, activityId, userId, label)

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
        // O 529 "Overloaded" da API costuma passar em minutos. O comentário
        // precisa dizer que dá pra tentar de novo num clique — sem isso, quem lê
        // acha que só resta conferir tudo na mão (foi o que aconteceu em 03/08).
        await comment(`⚠️ A revisão de ${label} não pôde ser concluída automaticamente — em geral é sobrecarga momentânea da IA. A tarefa seguiu. Use **Tentar de novo** no aviso da revisão, ou confira manualmente.`)
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
    .from('activities').select('drive_folder_id, redacao_url, preview_url, finalizacao_url').eq('id', activityId).single()

  // Backend da pasta pelo formato da ref. No S3 as peças vêm da subpasta derivada
  // (a ref é o caminho no bucket); no Drive, dos links salvos (fluxo antigo).
  const folderRef = (act?.drive_folder_id ?? '').trim()
  const isS3 = !!folderRef && backendForRef(folderRef) === 's3'

  // Redação — texto. No Drive é um Google Doc; no S3 a redação é um arquivo (.docx)
  // e a revisão de texto entra com o módulo de Redação (não há leitor de Word aqui).
  if (kind === 'redacao') {
    if (isS3) return { clean: true, errors: [], provider: '—', note: 'redação no S3 — revisão de texto virá com o módulo de Redação' }
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
    let assets
    if (isS3) {
      assets = (await readReviewAssetsS3(`${folderRef}/Final`)).assets
    } else {
      const link = act?.finalizacao_url ?? ''
      if (!link || !driveConfigured()) return { clean: true, errors: [], provider: '—', note: 'sem arquivo de Finalização' }
      assets = (await readReviewAssets(link)).assets
    }
    if (!assets.length) return { clean: true, errors: [], provider: '—', note: 'sem peças no Final' }
    const r = await reviewArtwork(assets)
    if (!r) return null
    return { clean: r.clean, errors: r.errors, provider: r.provider }
  }

  // Design — duas frentes: (1) ortografia nas peças do Preview, (2) cruzar com a Redação.
  let assets
  if (isS3) {
    assets = (await readReviewAssetsS3(`${folderRef}/Preview`)).assets
  } else {
    const previewLink = act?.preview_url ?? ''
    if (!previewLink || !driveConfigured()) return { clean: true, errors: [], provider: '—', note: 'sem pasta de Preview' }
    assets = (await readReviewAssets(previewLink)).assets
  }
  if (!assets.length) return { clean: true, errors: [], provider: '—', note: 'sem peças no Preview' }

  const spell = await reviewArtwork(assets)
  if (!spell) return null

  // Cross-check com a Redação só no fluxo Drive (no S3 a redação é .docx; entra com o módulo).
  let crossErrors: ReviewError[] = []
  const redLink = act?.redacao_url ?? ''
  if (!isS3 && redLink) {
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
