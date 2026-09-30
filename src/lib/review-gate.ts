import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { driveConfigured, readRedacaoText, readReviewAssets, versoesRedacao, versoesPecas, type VersaoArquivo } from '@/lib/google-drive'
import { backendForRef } from '@/lib/task-folders'
import { readReviewAssetsS3, versoesPecasS3 } from '@/lib/s3-folders'
import { reviewText, reviewTextAlteracoes, reviewArtwork, type ReviewError, type ContextoRevisao } from '@/lib/ai/review'
import type { RevisaoConfig } from '@/lib/ai/revisao-config'
import { etapaRevisavel, ETAPAS, type RevisaoEtapa } from '@/lib/ai/revisao-modelos'
import { iaDaOrg, iaDisponivel } from '@/lib/ai/provedor'
import { stripHtml } from '@/lib/html'
import { STATUS_CONFIG } from '@/types'
import { logSystemError } from '@/lib/system-error'
import { createHash } from 'crypto'

/**
 * Revisão IA SOB DEMANDA: a pessoa aperta "Revisar" na tarefa ANTES de mover o
 * status e vê o resultado ali mesmo. Para AVANÇAR a etapa é preciso ter revisado
 * desde que a tarefa entrou nela; com apontamentos, a pessoa confirma que segue
 * com eles (decisão dela, registrada). Ver checarAvanco.
 *
 * Substitui a revisão automática depois do avanço (até 09/2026): ela rodava em 2º
 * plano, a resposta chegava minutos depois e a tarefa VOLTAVA de status quando a
 * pessoa já estava em outra coisa.
 *
 * Cada revisão guarda a "impressão digital" do material (activity_revisao.fonte,
 * mig. 312). Mexeram no material depois — mesmo com a tarefa já em outra etapa —,
 * a revisão deixa de valer e o avanço pede revisar de novo (só o que mudou).
 */

type SB = SupabaseClient<Database>

/** Impressão digital do material revisado: versões dos arquivos + hash do texto. */
export interface FonteRevisao { arquivos: VersaoArquivo[]; hash?: string }

/** Revisão vigente de uma etapa (tabela activity_revisao). */
export interface RevisaoSalva {
  etapa: RevisaoEtapa
  status: string
  apontamentos: ReviewError[]
  fonte: FonteRevisao | null
  texto: string | null
  revisado_em: string
}

export type RevisaoOutcome =
  | { ok: true; errors: ReviewError[]; model: string; truncated: boolean; fonte: FonteRevisao | null; texto: string | null; parcial: boolean }
  | { ok: false; vazio: string; fonte: FonteRevisao | null }

const hashTexto = (t: string) => createHash('sha256').update(t.replace(/\s+/g, ' ').trim()).digest('hex')

interface Material { drive_folder_id: string | null; redacao_url: string | null; preview_url: string | null; finalizacao_url: string | null }

async function material(supabase: SB, activityId: string): Promise<Material | null> {
  const { data } = await supabase
    .from('activities').select('drive_folder_id, redacao_url, preview_url, finalizacao_url').eq('id', activityId).single()
  return (data as Material | null) ?? null
}

const ehS3 = (m: Material | null) => { const ref = (m?.drive_folder_id ?? '').trim(); return !!ref && backendForRef(ref) === 's3' }
const subpasta = (etapa: RevisaoEtapa) => etapa === 'design' ? 'Preview' : 'Final'

/** Versões atuais dos arquivos que a revisão da etapa lê (sem baixar). null = sem como saber. */
async function versoesAtuais(m: Material, etapa: RevisaoEtapa): Promise<VersaoArquivo[] | null> {
  const s3 = ehS3(m)
  if (etapa === 'redacao') {
    if (s3 || !m.redacao_url || !driveConfigured()) return null
    return versoesRedacao(m.redacao_url)
  }
  if (s3) return versoesPecasS3(`${(m.drive_folder_id ?? '').trim()}/${subpasta(etapa)}`)
  const link = etapa === 'design' ? m.preview_url : m.finalizacao_url
  if (!link || !driveConfigured()) return null
  return versoesPecas(link)
}

const mesmasVersoes = (a: VersaoArquivo[], b: VersaoArquivo[]) => {
  if (a.length !== b.length) return false
  const mapa = new Map(a.map(x => [x.id, x.v]))
  return b.every(x => mapa.get(x.id) === x.v)
}

/**
 * O material mudou desde a revisão? Versões iguais = não. Na Redação, versão
 * diferente ainda confere o TEXTO: o Doc ganha versão nova com um comentário ou
 * uma mudança de formatação, e isso não justifica revisar de novo. Falha ao
 * consultar o Drive/S3 = "não mudou" (não prende a tarefa por instabilidade).
 */
export async function materialMudou(m: Material, rev: RevisaoSalva): Promise<boolean> {
  if (!rev.fonte?.arquivos) return false
  try {
    const atuais = await versoesAtuais(m, rev.etapa)
    if (!atuais || mesmasVersoes(rev.fonte.arquivos, atuais)) return false
    if (rev.etapa !== 'redacao' || !rev.fonte.hash) return true
    const texto = (await readRedacaoText(m.redacao_url!)).text
    return hashTexto(texto) !== rev.fonte.hash
  } catch (e) {
    console.error('[revisao] conferir material falhou', e)
    return false
  }
}

/** Lê o material da etapa e chama a IA. Lança em falha da IA (quem chama traduz). */
export async function revisarAtividade(
  supabase: SB,
  activityId: string,
  userId: string,
  etapa: RevisaoEtapa,
  cfg: RevisaoConfig,
  anterior: RevisaoSalva | null,
): Promise<RevisaoOutcome> {
  const act = await material(supabase, activityId)
  const isS3 = ehS3(act)

  const lerRedacao = async (contexto: string): Promise<string> => {
    const link = act?.redacao_url ?? ''
    if (isS3 || !link || !driveConfigured()) return ''
    try { return (await readRedacaoText(link)).text } catch (e) {
      console.error(`[${contexto}] leitura da Redação falhou`, e)
      await logSystemError(supabase, { userId, context: `${contexto}:leitura`, error: e, activityId })
      return ''
    }
  }
  // Versões ANTES de ler: se alguém editar durante a revisão, a próxima checagem pega.
  const versoes = act ? await versoesAtuais(act, etapa).catch(() => null) : null

  if (etapa === 'redacao') {
    // No S3 a redação é .docx; o leitor de Word entra com o módulo de Redação.
    if (isS3) return { ok: false, vazio: 'A redação desta tarefa está em arquivo Word — a revisão de texto ainda não lê .docx.', fonte: null }
    if (!act?.redacao_url) return { ok: false, vazio: 'Sem link de Redação nesta tarefa.', fonte: null }
    const text = await lerRedacao('review:redacao')
    const fonte = versoes ? { arquivos: versoes, hash: hashTexto(text) } : null
    if (!text.trim()) return { ok: false, vazio: 'O Doc de Redação está vazio.', fonte }
    const ctx = await contextoDaTarefa(supabase, activityId)
    // Já revisada antes (com o texto guardado): olha só o que mudou.
    if (anterior?.texto && anterior.status !== 'failed') {
      const r = await reviewTextAlteracoes(cfg, text, {
        texto: anterior.texto, apontamentos: anterior.apontamentos, aceitos: anterior.status === 'overridden',
      }, ctx)
      return { ok: true, ...r, fonte, texto: text.slice(0, 40000) }
    }
    const r = await reviewText(cfg, text, ctx)
    return { ok: true, ...r, fonte, texto: text.slice(0, 40000), parcial: false }
  }

  const sub = subpasta(etapa)
  let assets
  if (isS3) {
    assets = (await readReviewAssetsS3(`${(act?.drive_folder_id ?? '').trim()}/${sub}`)).assets
  } else {
    const link = (etapa === 'design' ? act?.preview_url : act?.finalizacao_url) ?? ''
    if (!link || !driveConfigured()) return { ok: false, vazio: `Sem pasta de ${sub} nesta tarefa.`, fonte: null }
    assets = (await readReviewAssets(link)).assets
  }
  const fonte = versoes ? { arquivos: versoes } : null
  if (!assets.length) return { ok: false, vazio: `Nenhuma peça (imagem/PDF) na pasta ${sub}.`, fonte }

  // Design confere também contra o texto aprovado da Redação (mesma chamada).
  const aprovado = etapa === 'design' ? await lerRedacao('review:design') : ''
  const r = await reviewArtwork(cfg, assets, aprovado, await contextoDaTarefa(supabase, activityId))
  return { ok: true, ...r, fonte, texto: null, parcial: false }
}

/** Revisões vigentes da tarefa, por etapa. */
export async function revisoesDaTarefa(supabase: SB, activityId: string): Promise<Map<RevisaoEtapa, RevisaoSalva>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('activity_revisao')
    .select('etapa, status, apontamentos, fonte, texto, revisado_em').eq('activity_id', activityId) as { data: RevisaoSalva[] | null }
  return new Map((data ?? []).map(r => [r.etapa, { ...r, apontamentos: Array.isArray(r.apontamentos) ? r.apontamentos : [] }]))
}

/** Grava a revisão da etapa (substitui a anterior). */
export async function salvarRevisao(supabase: SB, activityId: string, userId: string, etapa: RevisaoEtapa, dados: {
  status: string; apontamentos: ReviewError[] | null; fonte?: FonteRevisao | null; texto?: string | null
}): Promise<void> {
  const row: Record<string, unknown> = {
    activity_id: activityId, etapa, status: dados.status, apontamentos: dados.apontamentos,
    revisado_em: new Date().toISOString(), revisado_por: userId,
  }
  if (dados.fonte !== undefined) row.fonte = dados.fonte
  if (dados.texto !== undefined) row.texto = dados.texto
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('activity_revisao').upsert(row, { onConflict: 'activity_id,etapa' })
  if (error) throw new Error(`activity_revisao: ${error.message}`)
}

/** Etapas cujo material mudou depois da revisão (para o aviso na tarefa). */
export async function etapasComMudanca(supabase: SB, activityId: string, etapas: RevisaoEtapa[]): Promise<RevisaoEtapa[]> {
  const [m, revs] = await Promise.all([material(supabase, activityId), revisoesDaTarefa(supabase, activityId)])
  if (!m) return []
  const out: RevisaoEtapa[] = []
  for (const e of etapas) {
    const rev = revs.get(e)
    if (rev && await materialMudou(m, rev)) out.push(e)
  }
  return out
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

export type VeredictoAvanco =
  | { ok: true; nota?: string }
  | { ok: false; motivo: 'precisa_revisar'; mensagem: string }
  | { ok: false; motivo: 'confirmar'; mensagem: string; erros: ReviewError[]; falhou: boolean }

/** Como a tarefa se refere ao material de cada etapa nos avisos. */
export const MATERIAL: Record<RevisaoEtapa, string> = {
  redacao: 'O texto da Redação', design: 'As peças do Preview', finalizacao: 'O arquivo Final',
}

/**
 * Pode avançar? Regras do Rafael (28–30/09/2026):
 *  1. Sair PARA FRENTE de uma etapa com Revisão ligada exige revisão feita depois
 *     da última entrada nela (voltou da validação, revisa de novo).
 *  2. Revisão de qualquer etapa já passada (ou da atual) deixa de valer se o
 *     material MUDOU depois dela — texto da Redação editado com a tarefa em
 *     Design, peça trocada no Preview… A pessoa revisa de novo (só o que mudou).
 *  3. Revisão com apontamentos (ou IA sem resposta) pede confirmação — `aceitar` =
 *     "Concordo, seguir": vira 'overridden' e uma nota na movimentação.
 * Voltar para trás nunca é barrado. Revisão/etapa desligada ou sem IA = não barra.
 * Etapa passada SEM revisão registrada (tarefa antiga, etapa pulada) não barra.
 */
export async function checarAvanco(
  supabase: SB, userId: string, activityId: string, from: string | null, to: string, aceitar: boolean,
): Promise<VeredictoAvanco> {
  if (!from || to === from) return { ok: true }

  const { data: act } = await supabase
    .from('activities').select('campaigns(workspaces(org_id))').eq('id', activityId).single()
  const orgId = (act as unknown as { campaigns: { workspaces: { org_id: string } | null } | null } | null)
    ?.campaigns?.workspaces?.org_id
  if (!orgId) return { ok: true }

  const pos = await posicaoNaOrg(supabase, orgId)
  if (pos(to) <= pos(from)) return { ok: true }

  const cfg = await iaDaOrg(orgId)
  // Sem IA que responda não dá pra exigir revisão — o botão nem funcionaria.
  if (!cfg?.enabled || !iaDisponivel(cfg)) return { ok: true }

  const etapaAtual = etapaRevisavel(from)
  const emJogo = ETAPAS.map(e => e.key).filter(e => cfg.stages[e] && pos(e) <= pos(from))
  if (!emJogo.length) return { ok: true }

  const [revs, m] = await Promise.all([revisoesDaTarefa(supabase, activityId), material(supabase, activityId)])
  const precisa: string[] = []
  const confirmar: { etapa: RevisaoEtapa; rev: RevisaoSalva }[] = []

  for (const e of emJogo) {
    const rev = revs.get(e)
    const label = ETAPAS.find(x => x.key === e)!.label
    if (e === etapaAtual) {
      const { data: entrada } = await supabase
        .from('activity_history').select('changed_at').eq('activity_id', activityId).eq('to_status', e)
        .order('changed_at', { ascending: false }).limit(1).maybeSingle()
      if (!rev || (entrada?.changed_at && new Date(rev.revisado_em) < new Date(entrada.changed_at as string))) {
        precisa.push(`Revise ${label} antes de avançar: use o botão Revisar na tarefa.`)
        continue
      }
    } else if (!rev) continue
    if (m && await materialMudou(m, rev)) {
      precisa.push(`${MATERIAL[e]} mudou depois da revisão de ${label}: revise de novo na tarefa.`)
      continue
    }
    if (rev.status === 'errors' || rev.status === 'failed') confirmar.push({ etapa: e, rev })
  }

  if (precisa.length) return { ok: false, motivo: 'precisa_revisar', mensagem: precisa.join(' ') }
  if (!confirmar.length) return { ok: true }

  const erros = confirmar.flatMap(c => c.rev.status === 'failed' ? [] : c.rev.apontamentos)
  const falhou = confirmar.every(c => c.rev.status === 'failed')
  const labels = confirmar.map(c => ETAPAS.find(x => x.key === c.etapa)!.label).join(' e ')
  if (!aceitar) {
    return {
      ok: false, motivo: 'confirmar', erros, falhou,
      mensagem: falhou
        ? `A revisão de ${labels} não foi concluída. Abra a tarefa para confirmar que segue sem ela.`
        : `A revisão de ${labels} tem ${erros.length} ${erros.length === 1 ? 'apontamento' : 'apontamentos'}. Abra a tarefa para confirmar que segue assim.`,
    }
  }
  for (const c of confirmar) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('activity_revisao').update({ status: 'overridden' })
      .eq('activity_id', activityId).eq('etapa', c.etapa)
  }
  return {
    ok: true,
    nota: falhou
      ? `Seguiu sem a revisão de ${labels} (a IA não respondeu).`
      : `Seguiu com ${erros.length} ${erros.length === 1 ? 'apontamento' : 'apontamentos'} da revisão de ${labels}.`,
  }
}

/** Posição de cada status na ordem da org (cadastro org_status). Desconhecido = fim. */
export async function posicaoNaOrg(supabase: SB, orgId: string): Promise<(v: string) => number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('org_status').select('valor').eq('org_id', orgId).order('ordem') as { data: { valor: string }[] | null }
  const ordem = data?.length ? data.map(r => r.valor) : STATUS_CONFIG.map(s => s.value as string)
  return (v: string) => { const i = ordem.indexOf(v); return i === -1 ? Number.MAX_SAFE_INTEGER : i }
}
