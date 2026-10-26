import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { driveConfigured, readRedacaoText, listarPecasRevisao, versoesRedacao, versoesPecas, type VersaoArquivo } from '@/lib/google-drive'
import { backendForRef } from '@/lib/task-folders'
import { listarPecasRevisaoS3, versoesPecasS3 } from '@/lib/s3-folders'
import { reviewText, reviewTextAlteracoes, reviewArtwork, type ReviewError, type ContextoRevisao } from '@/lib/ai/review'
import type { RevisaoConfig } from '@/lib/ai/revisao-config'
import { etapaRevisavel, ETAPAS, STATUS_REVISAO_COMPLETA, type RevisaoEtapa } from '@/lib/ai/revisao-modelos'
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
export interface FonteRevisao {
  arquivos: VersaoArquivo[]
  /** Hash do texto da Redação lido. */
  hash?: string
  /** Hash do briefing + comentários usados (comentário novo = revisar de verdade). */
  ctx?: string
  /** Design: hash do texto aprovado da Redação conferido junto. */
  aprovado?: string
}

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
  | { ok: true; errors: ReviewError[]; model: string; truncated: boolean; fonte: FonteRevisao | null; texto: string | null; parcial: boolean; naoLidas?: string[]; partes?: number; reaproveitada?: boolean }
  /** naoLido = havia arquivos, mas nada pôde ser lido (pede confirmação para avançar). */
  | { ok: false; vazio: string; fonte: FonteRevisao | null; naoLido?: boolean }

/** Estados cuja lista de apontamentos pode ser reaproveitada se nada mudou. */
const REAPROVEITAVEL = new Set(['clean', 'errors', 'overridden'])

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

/**
 * O material atual é o mesmo que foi revisado? Vale se TODA peça atual estava na
 * revisão com a mesma versão. Arquivo que sumiu (apagado, ou Mockup que deixou de
 * ser lido em 02/10) não pede revisão nova — não há texto novo para conferir.
 * Antes a contagem tinha de bater: em 05/10 a Carta criança acusou "peças mudaram"
 * só porque a revisão de 02/10 tinha contado o Mockup.
 */
const mesmasVersoes = (revisadas: VersaoArquivo[], atuais: VersaoArquivo[]) => {
  const mapa = new Map(revisadas.map(x => [x.id, x.v]))
  return atuais.every(x => mapa.get(x.id) === x.v)
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
  const ctx = await contextoDaTarefa(supabase, activityId)
  const ctxHash = hashTexto(JSON.stringify(ctx))
  // Nada mudou desde a última revisão (material, briefing, comentários)? Devolve o
  // mesmo resultado sem chamar a IA — 12/10: 40% das tarefas eram revisadas 3 a 9
  // vezes, às vezes em segundos, e o resultado oscilava entre cliques.
  const reaproveitar = (fonte: FonteRevisao | null): RevisaoOutcome | null =>
    anterior && fonte && REAPROVEITAVEL.has(anterior.status) && anterior.fonte?.ctx === ctxHash
      ? { ok: true, errors: anterior.apontamentos, model: 'reaproveitada', truncated: false, fonte, texto: anterior.texto, parcial: false, reaproveitada: true }
      : null

  if (etapa === 'redacao') {
    // No S3 a redação é .docx; o leitor de Word entra com o módulo de Redação.
    if (isS3) return { ok: false, vazio: 'A redação desta tarefa está em arquivo Word — a revisão de texto ainda não lê .docx.', fonte: null }
    if (!act?.redacao_url) return { ok: false, vazio: 'Sem link de Redação nesta tarefa.', fonte: null }
    const text = await lerRedacao('review:redacao')
    const fonte = versoes ? { arquivos: versoes, hash: hashTexto(text), ctx: ctxHash } : null
    if (!text.trim()) return { ok: false, vazio: 'O Doc de Redação está vazio.', fonte }
    if (fonte && anterior?.fonte?.hash === fonte.hash) { const r = reaproveitar(fonte); if (r) return r }
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
  let pecasLidas
  if (isS3) {
    pecasLidas = await listarPecasRevisaoS3(`${(act?.drive_folder_id ?? '').trim()}/${sub}`)
  } else {
    const link = (etapa === 'design' ? act?.preview_url : act?.finalizacao_url) ?? ''
    if (!link || !driveConfigured()) return { ok: false, vazio: `Sem pasta de ${sub} nesta tarefa.`, fonte: null }
    pecasLidas = await listarPecasRevisao(link)
  }
  // Design confere também contra o texto aprovado da Redação (em cada parte).
  const aprovado = etapa === 'design' ? await lerRedacao('review:design') : ''
  const fonte: FonteRevisao | null = versoes ? { arquivos: versoes, ctx: ctxHash, aprovado: hashTexto(aprovado) } : null

  // Havia arquivos, mas nada que a IA leia (só subpastas, Mockups, formato não lido,
  // grande demais): NÃO conta como revisado — 12/10: Livro Zezé (PDF de 33 MB) e Long
  // neck (peças em subpastas) passaram "revisados" sem a IA ver nada.
  const nadaLido = (motivos: string[]) => ({
    ok: false as const, naoLido: true, fonte,
    vazio: `Nada pôde ser revisado na pasta ${sub}${motivos.length ? `: ${motivos.join('; ')}` : ''}. Subpastas e Mockups ficam fora da revisão.`,
  })
  if (!pecasLidas.pecas.length) {
    if (pecasLidas.naoLidas.length || pecasLidas.outros) return nadaLido(pecasLidas.naoLidas)
    return { ok: false, vazio: `Nenhuma peça (imagem/PDF) na pasta ${sub}.`, fonte }
  }
  const mesmoMaterial = fonte && anterior?.fonte?.arquivos
    && anterior.fonte.arquivos.length === fonte.arquivos.length && mesmasVersoes(anterior.fonte.arquivos, fonte.arquivos)
    && anterior.fonte.aprovado === fonte.aprovado
  if (mesmoMaterial) { const r = reaproveitar(fonte); if (r) return r }

  const r = await reviewArtwork(cfg, pecasLidas, aprovado, ctx)
  if (!r.lidas) return nadaLido(r.naoLidas ?? [])
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

/**
 * Histórico (activity_revisao_log, mig. 327): cada revisão e cada "seguiu com
 * apontamentos" vira uma linha que nunca é apagada. activity_revisao guarda só a
 * vigente; sem o histórico, revisar de novo apagava o que a IA tinha apontado e a
 * comparação com a Revisão Interna ficava cega. Falha aqui não derruba a revisão.
 */
export async function registrarHistorico(supabase: SB, activityId: string, userId: string, etapa: RevisaoEtapa, dados: {
  evento: 'revisao' | 'seguiu'
  status: string
  apontamentos?: ReviewError[] | null
  modelo?: string | null
  parcial?: boolean
  partes?: number | null
  naoLidas?: string[] | null
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('activity_revisao_log').insert({
    activity_id: activityId, etapa, evento: dados.evento, status: dados.status,
    apontamentos: dados.apontamentos?.length ? dados.apontamentos : null,
    modelo: dados.modelo ?? null, parcial: dados.parcial ?? false, partes: dados.partes ?? null,
    nao_lidas: dados.naoLidas?.length ? dados.naoLidas : null, por: userId,
  })
  if (error) console.error('[revisao] histórico falhou', error.message)
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
  | { ok: false; motivo: 'confirmar'; mensagem: string; erros: ReviewError[]; falhou: boolean; semLeitura?: boolean; aviso?: string }

/** Como a tarefa se refere ao material de cada etapa nos avisos. */
export const MATERIAL: Record<RevisaoEtapa, string> = {
  redacao: 'O texto da Redação mudou', design: 'As peças do Preview mudaram', finalizacao: 'O arquivo Final mudou',
}

/**
 * Pode avançar? Regras do Rafael (28–30/09/2026):
 *  1. Sair PARA FRENTE de uma etapa com Revisão ligada exige revisão feita depois
 *     da última entrada nela (voltou da validação, revisa de novo).
 *  2. A revisão da etapa deixa de valer se o material MUDOU depois dela (peça
 *     trocada no Preview, texto editado no Doc): revisa de novo (só o que mudou).
 *     Só TRAVA quem sai da própria etapa (05/10/2026: "atendimento e mídia não têm
 *     ação sobre o design"). Mudança em etapa já passada vira aviso na tarefa.
 *  3. Revisão com apontamentos (ou IA sem resposta) pede confirmação — `aceitar` =
 *     "Concordo, seguir": vira 'overridden' e uma nota na movimentação.
 * Voltar para trás nunca é barrado. Revisão/etapa desligada ou sem IA = não barra.
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

  if (from === STATUS_REVISAO_COMPLETA && cfg.stages.validacao !== false) {
    return checarRevisaoCompleta(supabase, userId, activityId, aceitar)
  }

  const etapaAtual = etapaRevisavel(from)
  if (!etapaAtual || !cfg.stages[etapaAtual]) return { ok: true }
  const e = etapaAtual
  const label = ETAPAS.find(x => x.key === e)!.label

  const [revs, m] = await Promise.all([revisoesDaTarefa(supabase, activityId), material(supabase, activityId)])
  const rev = revs.get(e)
  const { data: entrada } = await supabase
    .from('activity_history').select('changed_at').eq('activity_id', activityId).eq('to_status', e)
    .order('changed_at', { ascending: false }).limit(1).maybeSingle()
  if (!rev || (entrada?.changed_at && new Date(rev.revisado_em) < new Date(entrada.changed_at as string))) {
    return { ok: false, motivo: 'precisa_revisar', mensagem: `Revise ${label} antes de avançar: use o botão Revisar na tarefa.` }
  }
  if (m && await materialMudou(m, rev)) {
    return { ok: false, motivo: 'precisa_revisar', mensagem: `${MATERIAL[e]} depois da revisão de ${label}: revise de novo na tarefa.` }
  }
  if (rev.status !== 'errors' && rev.status !== 'failed' && rev.status !== 'nao_lido') return { ok: true }
  const confirmar: { etapa: RevisaoEtapa; rev: RevisaoSalva }[] = [{ etapa: e, rev }]

  const semLeitura = rev.status === 'nao_lido'
  const falhou = rev.status === 'failed' || semLeitura
  const erros = falhou ? [] : rev.apontamentos
  const labels = label
  if (!aceitar) {
    return {
      ok: false, motivo: 'confirmar', erros, falhou, semLeitura,
      mensagem: semLeitura
        ? `Nada de ${labels} pôde ser revisado pela IA. Abra a tarefa para confirmar que segue sem revisão.`
        : falhou
          ? `A revisão de ${labels} não foi concluída. Abra a tarefa para confirmar que segue sem ela.`
          : `A revisão de ${labels} tem ${erros.length} ${erros.length === 1 ? 'apontamento' : 'apontamentos'}. Abra a tarefa para confirmar que segue assim.`,
    }
  }
  for (const c of confirmar) {
    // Seguir sem revisão (falha/nada lido) NÃO vira 'overridden': esse estado é
    // reaproveitado como resultado, e aqui não houve resultado nenhum.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('activity_revisao').update({ status: falhou ? 'seguiu_sem_revisao' : 'overridden' })
      .eq('activity_id', activityId).eq('etapa', c.etapa)
    await registrarHistorico(supabase, activityId, userId, c.etapa, {
      evento: 'seguiu', status: c.rev.status, apontamentos: falhou ? null : c.rev.apontamentos,
    })
  }
  return {
    ok: true,
    nota: semLeitura
      ? `Seguiu sem a revisão de ${labels} (nada pôde ser lido pela IA).`
      : falhou
      ? `Seguiu sem a revisão de ${labels} (a IA não respondeu).`
      : `Seguiu com ${erros.length} ${erros.length === 1 ? 'apontamento' : 'apontamentos'} da revisão de ${labels}.`,
  }
}

/**
 * Sair da Validação de Criação exige "Revisar tudo" (26/10/2026: a Revisão
 * Interna saiu; a revisão é 100% IA). Vale a mesma régua das etapas: cada uma
 * das três (Redação, Preview, Final) revisada DEPOIS da entrada na Validação e
 * com o material igual ao revisado; apontamentos, falha ou nada lido pedem
 * "Concordo, seguir". Pasta vazia passa (não há o que revisar).
 */
async function checarRevisaoCompleta(
  supabase: SB, userId: string, activityId: string, aceitar: boolean,
): Promise<VeredictoAvanco> {
  const etapas: RevisaoEtapa[] = ['redacao', 'design', 'finalizacao']
  const [revs, m, { data: entrada }] = await Promise.all([
    revisoesDaTarefa(supabase, activityId),
    material(supabase, activityId),
    supabase.from('activity_history').select('changed_at').eq('activity_id', activityId).eq('to_status', STATUS_REVISAO_COMPLETA)
      .order('changed_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const desde = (entrada as { changed_at?: string } | null)?.changed_at
  const faltam: string[] = []
  for (const e of etapas) {
    const rev = revs.get(e)
    if (!rev || (desde && new Date(rev.revisado_em) < new Date(desde)) || (m && await materialMudou(m, rev))) {
      faltam.push(ETAPAS.find(x => x.key === e)!.label)
    }
  }
  if (faltam.length) {
    return { ok: false, motivo: 'precisa_revisar', mensagem: `Use "Revisar tudo" na tarefa antes de avançar (falta: ${faltam.join(', ')}).` }
  }

  const pendentes = etapas.map(e => ({ e, rev: revs.get(e)! }))
    .filter(x => x.rev.status === 'errors' || x.rev.status === 'failed' || x.rev.status === 'nao_lido')
  if (!pendentes.length) return { ok: true }

  const nome = (e: RevisaoEtapa) => ETAPAS.find(x => x.key === e)!.label
  const erros = pendentes.filter(x => x.rev.status === 'errors').flatMap(x => x.rev.apontamentos)
  const semRevisao = pendentes.filter(x => x.rev.status !== 'errors')
  const aviso = semRevisao.length
    ? `Sem revisão da IA: ${semRevisao.map(x => `${nome(x.e)} (${x.rev.status === 'nao_lido' ? 'nada pôde ser lido' : 'a IA não respondeu'})`).join(', ')}.`
    : undefined
  const falhou = !erros.length
  const semLeitura = falhou && semRevisao.every(x => x.rev.status === 'nao_lido')
  if (!aceitar) {
    return {
      ok: false, motivo: 'confirmar', erros, falhou, semLeitura, aviso,
      mensagem: erros.length
        ? `A revisão completa tem ${erros.length} ${erros.length === 1 ? 'apontamento' : 'apontamentos'}. Abra a tarefa para confirmar que segue assim.`
        : `Parte do material não foi revisada pela IA. Abra a tarefa para confirmar que segue assim.`,
    }
  }
  for (const x of pendentes) {
    const semRev = x.rev.status !== 'errors'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('activity_revisao').update({ status: semRev ? 'seguiu_sem_revisao' : 'overridden' })
      .eq('activity_id', activityId).eq('etapa', x.e)
    await registrarHistorico(supabase, activityId, userId, x.e, {
      evento: 'seguiu', status: x.rev.status, apontamentos: semRev ? null : x.rev.apontamentos,
    })
  }
  const partes: string[] = []
  if (erros.length) partes.push(`${erros.length} ${erros.length === 1 ? 'apontamento' : 'apontamentos'} da revisão completa`)
  if (semRevisao.length) partes.push(`sem revisão de ${semRevisao.map(x => nome(x.e)).join(' e ')}`)
  return { ok: true, nota: `Seguiu com ${partes.join(' e ')}.` }
}

/** Posição de cada status na ordem da org (cadastro org_status). Desconhecido = fim. */
export async function posicaoNaOrg(supabase: SB, orgId: string): Promise<(v: string) => number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('org_status').select('valor').eq('org_id', orgId).order('ordem') as { data: { valor: string }[] | null }
  const ordem = data?.length ? data.map(r => r.valor) : STATUS_CONFIG.map(s => s.value as string)
  return (v: string) => { const i = ordem.indexOf(v); return i === -1 ? Number.MAX_SAFE_INTEGER : i }
}
