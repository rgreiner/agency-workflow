import 'server-only'
import type { DriveAsset } from '@/lib/google-drive'
import type { IAPart } from './gemini'
import { iaDisponivel, iaJson } from './provedor'
import type { RevisaoConfig } from './revisao-config'

/**
 * Motor da Revisão IA, multimodal (texto + imagens/PDF). Roda sob demanda, pelo
 * botão "Revisar" da tarefa, com o provedor/modelo/chave que a org cadastrou em
 * Configurações → Revisão IA. A saída é só a lista de apontamentos — trecho +
 * correção curta —, sem explicação: quem decide o que corrigir é a pessoa.
 */

export interface ReviewError {
  /** Trecho exato do material (erro) ou resumo do pedido (pendência). */
  trecho: string
  /** Correção curta ("Casa com s e não z.") ou o que está no material. */
  correcao: string
  /** 'pendencia' = pedido do briefing/comentários não atendido; ausente = erro de língua. */
  tipo?: 'pendencia'
}

export interface ReviewResult {
  model: string
  errors: ReviewError[]
  /** Entrada foi cortada por exceder o limite enviado ao modelo. */
  truncated: boolean
}

/** O que a tarefa pediu: briefing + comentários recentes (texto puro). */
export interface ContextoRevisao {
  briefing: string
  comentarios: { autor: string; data: string; texto: string }[]
}

// Limite de caracteres de texto enviados ao modelo (controla custo/latência). ~12-16 páginas.
const MAX_CHARS = 40000

// ── Prompt ──────────────────────────────────────────────────────────────────

const REGRAS = `Aponte APENAS o que for erro CLARO:
- ortografia e acentuação
- gramática: concordância, regência, crase
- pontuação que cause erro real
- incoerência objetiva: a mesma informação diferente em dois lugares (data, preço, nome,
  medida, teor, volume), palavra trocada ou faltando que deixa a frase sem sentido.

NÃO aponte: estilo, tom, vírgula opcional, gíria, informalidade, neologismo publicitário,
nome de marca, hashtag, CTA, maiúsculas de título, quebra de linha, diagramação.
Na dúvida entre erro e escolha de quem escreveu, NÃO aponte.

Formato de cada item de "erros":
- "trecho": o trecho exato, curto, copiado como está no material.
- "correcao": a correção em UMA frase curta (até 12 palavras), sem explicar a regra.
  Exemplo: trecho "A sua caza é bonita" → correcao "Casa com s e não z."
Um apontamento por erro; não repita o mesmo trecho. Sem nenhum erro claro, lista vazia.`

// Olhar de contexto (28/09/2026, pedido do Rafael): o material atende ao que a
// tarefa pediu? Conservador como o resto — só pedido claro e verificável.
const REGRAS_CONTEXTO = `
Você também recebe o BRIEFING da tarefa e os COMENTÁRIOS recentes da equipe (do mais antigo
ao mais novo). Em "pendencias", aponte SÓ quando o material claramente NÃO atende:
- um pedido de ajuste objetivo feito nos comentários (ex.: "trocar X por Y" e X continua);
- um item obrigatório do briefing que ficou de fora (texto, dado, data, preço, peça pedida);
- uma informação do material que contradiz o briefing (data, preço, nome, medida).

NÃO aponte: sugestão vaga, opinião, elogio, conversa, pergunta; pedido já atendido; pedido
que um comentário POSTERIOR cancelou ou mudou (o mais recente vale); o que não dá para
verificar no material que você recebeu (ex.: cor ou layout quando o material é só texto;
arquivo mandado "no WhatsApp"); pedido sobre outra etapa ou outra peça. Na dúvida, NÃO aponte.

Formato de cada item de "pendencias":
- "pedido": o pedido, resumido em até 10 palavras, fiel ao que foi escrito.
- "situacao": o que está no material, em até 12 palavras.
  Exemplo: pedido "Trocar 'Garanta já' por 'Peça o seu'" → situacao "Continua 'Garanta já' no título."
Sem nenhuma pendência clara, lista vazia.`

const SYSTEM_TEXTO = `Você revisa textos publicitários em português do Brasil.\n\n${REGRAS}\n${REGRAS_CONTEXTO}`

const SYSTEM_PECAS = `Você revisa o texto VISÍVEL em peças publicitárias (imagens/PDF) em português do Brasil.\n\n${REGRAS}\n${REGRAS_CONTEXTO}`

const SYSTEM_PECAS_COM_TEXTO = `${SYSTEM_PECAS}

Você também recebe o TEXTO APROVADO pela Redação. Além dos erros de língua, aponte em "erros"
quando a peça DIVERGE do texto aprovado de forma relevante: trecho faltando, trocado ou com
informação diferente (ex.: dado de um produto usado no rótulo de outro), ou página/peça
prevista que não veio. Nesses casos "trecho" é o que está na peça (ou o nome da peça
faltante) e "correcao" é o que deveria estar, em poucas palavras.`

const ITEM = (a: string, b: string) => ({
  type: 'object',
  properties: { [a]: { type: 'string' }, [b]: { type: 'string' } },
  required: [a, b],
})

const SCHEMA = {
  type: 'object',
  properties: {
    erros: { type: 'array', items: ITEM('trecho', 'correcao') },
    pendencias: { type: 'array', items: ITEM('pedido', 'situacao') },
  },
  required: ['erros', 'pendencias'],
}

// ── Entradas ────────────────────────────────────────────────────────────────

function cortar(txt: string): { texto: string; truncated: boolean } {
  const t = (txt ?? '').trim()
  return t.length > MAX_CHARS ? { texto: t.slice(0, MAX_CHARS), truncated: true } : { texto: t, truncated: false }
}

/** Bloco de texto com briefing + comentários, antes do material. */
function blocoContexto(ctx?: ContextoRevisao | null): IAPart[] {
  if (!ctx) return []
  const briefing = ctx.briefing.trim().slice(0, 8000) || '(sem briefing)'
  const coms = ctx.comentarios.length
    ? ctx.comentarios.map(c => `[${c.data} · ${c.autor}] ${c.texto.slice(0, 1200)}`).join('\n')
    : '(sem comentários)'
  return [{ kind: 'text', text: `BRIEFING DA TAREFA:\n--- INÍCIO ---\n${briefing}\n--- FIM ---\n\nCOMENTÁRIOS RECENTES (antigo → novo):\n--- INÍCIO ---\n${coms}\n--- FIM ---` }]
}

/** Revisão de um texto puro (Redação). */
export async function reviewText(cfg: RevisaoConfig, text: string, ctx?: ContextoRevisao | null): Promise<ReviewResult> {
  const { texto, truncated } = cortar(text)
  const { model, list } = await run(cfg, SYSTEM_TEXTO, [
    ...blocoContexto(ctx),
    { kind: 'text', text: `MATERIAL A REVISAR:\n--- INÍCIO DO TEXTO ---\n${texto}\n--- FIM DO TEXTO ---` },
  ])
  return { model, errors: list, truncated }
}

// ── Revisão só do que mudou (Redação) ──────────────────────────────────────

const SYSTEM_ALTERADO = `Você revisa textos publicitários em português do Brasil. O texto JÁ FOI
revisado antes; você recebe só os TRECHOS ALTERADOS desde então.

1. Em "erros", aponte erro CLARO de língua APENAS nos trechos alterados:
${REGRAS}

2. Você também recebe as PENDÊNCIAS da revisão anterior (pedidos do briefing/comentários que o
texto não atendia). Em "pendencias", repita SÓ as que os trechos alterados NÃO resolveram, com o
mesmo "pedido" e a "situacao" atualizada. Se um trecho alterado resolveu a pendência, não repita.
Não crie pendência nova. Sem pendências anteriores, lista vazia.`

/** Linhas do texto, sem espaço sobrando e sem vazias. */
function linhas(t: string): string[] {
  return t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/**
 * Revisão da Redação que já tinha sido revisada: manda à IA só as linhas novas ou
 * alteradas. Erros de linhas que não mudaram continuam valendo (se ainda não foram
 * aceitos); pendências anteriores voltam para a IA dizer se a alteração resolveu.
 * Mudou mais da metade do texto = revisão completa (o recorte deixaria de ajudar).
 */
export async function reviewTextAlteracoes(
  cfg: RevisaoConfig,
  textoNovo: string,
  anterior: { texto: string; apontamentos: ReviewError[]; aceitos: boolean },
  ctx?: ContextoRevisao | null,
): Promise<ReviewResult & { parcial: boolean }> {
  const antes = new Set(linhas(anterior.texto))
  const novas = linhas(textoNovo)
  const alteradas = novas.filter(l => !antes.has(l))
  if (novas.length && alteradas.length / novas.length > 0.5) {
    return { ...(await reviewText(cfg, textoNovo, ctx)), parcial: false }
  }

  // Erros antigos cujo trecho segue igual no texto — ninguém mexeu, continuam.
  // Se a pessoa já tinha aceitado seguir com eles, não voltam a cobrar.
  const velhosErros = anterior.aceitos ? [] : anterior.apontamentos
    .filter(e => e.tipo !== 'pendencia' && textoNovo.includes(e.trecho))
  const velhasPend = anterior.aceitos ? [] : anterior.apontamentos.filter(e => e.tipo === 'pendencia')

  if (!alteradas.length && !velhasPend.length) return { model: '—', errors: velhosErros, truncated: false, parcial: true }

  const pend = velhasPend.length
    ? velhasPend.map(p => `- pedido: ${p.trecho} | situação anterior: ${p.correcao}`).join('\n')
    : '(nenhuma)'
  const { texto, truncated } = cortar(alteradas.join('\n'))
  const { model, list } = await run(cfg, SYSTEM_ALTERADO, [
    { kind: 'text', text: `PENDÊNCIAS DA REVISÃO ANTERIOR:\n${pend}` },
    { kind: 'text', text: `TRECHOS ALTERADOS:\n--- INÍCIO ---\n${texto || '(só remoções)'}\n--- FIM ---` },
  ])
  // Um erro "novo" pode repetir um velho (mesmo trecho): fica um só.
  const chaves = new Set(velhosErros.map(e => e.trecho.toLowerCase()))
  const errors = [...velhosErros, ...list.filter(e => e.tipo === 'pendencia' || !chaves.has(e.trecho.toLowerCase()))]
  return { model, errors, truncated, parcial: true }
}

/**
 * Revisão das peças (Design/Finalização). Com o texto aprovado da Redação, a
 * mesma chamada também confere se a peça usou o texto certo.
 */
export async function reviewArtwork(cfg: RevisaoConfig, assets: DriveAsset[], textoAprovado?: string, ctx?: ContextoRevisao | null): Promise<ReviewResult> {
  const { texto, truncated } = cortar(textoAprovado ?? '')
  const parts: IAPart[] = [...blocoContexto(ctx)]
  if (texto) parts.push({ kind: 'text', text: `TEXTO APROVADO PELA REDAÇÃO:\n--- INÍCIO ---\n${texto}\n--- FIM ---` })
  parts.push({ kind: 'text', text: 'MATERIAL A REVISAR (peças):' })
  for (const a of assets) parts.push({ kind: 'media', mimeType: a.mimeType, base64: a.base64 })
  const { model, list } = await run(cfg, texto ? SYSTEM_PECAS_COM_TEXTO : SYSTEM_PECAS, parts)
  return { model, errors: list, truncated }
}

// ── Execução ────────────────────────────────────────────────────────────────

async function run(cfg: RevisaoConfig, system: string, parts: IAPart[]): Promise<{ model: string; list: ReviewError[] }> {
  // Claude exige chave cadastrada; Gemini sem chave usa a do ambiente, se houver.
  if (!iaDisponivel(cfg)) throw new Error('SEM_CHAVE')
  const { model, data } = await iaJson<{ erros?: unknown; pendencias?: unknown }>(cfg, {
    system, parts, schema: SCHEMA, maxOutputTokens: 16384, timeoutMs: 120_000,
  })
  return { model, list: [...normalizar(data?.erros), ...normalizar(data?.pendencias, 'pendencia')] }
}

function normalizar(value: unknown, tipo?: 'pendencia'): ReviewError[] {
  if (!Array.isArray(value)) return []
  const vistos = new Set<string>()
  const out: ReviewError[] = []
  for (const e of value) {
    const o = (e ?? {}) as Record<string, unknown>
    const trecho = String(o.trecho ?? o.pedido ?? '').trim().slice(0, 300)
    const correcao = String(o.correcao ?? o.situacao ?? o.sugestao ?? '').trim().slice(0, 200)
    if (!trecho || !correcao) continue
    // O modelo às vezes repete o mesmo apontamento (medido em 26/09: 5× o mesmo).
    const chave = `${trecho.toLowerCase()}|${correcao.toLowerCase()}`
    if (vistos.has(chave)) continue
    // "Correção" igual ao trecho não é apontamento.
    if (correcao.toLowerCase() === trecho.toLowerCase()) continue
    vistos.add(chave)
    out.push(tipo ? { trecho, correcao, tipo } : { trecho, correcao })
  }
  return out
}

/**
 * Motivo da falha em pt-BR, apontando para onde se resolve. Vale para toda IA
 * que usa a chave da org (revisão, briefing, folha, guia) — `fallback` é o
 * recado quando o motivo não é reconhecido.
 */
export function mensagemErroRevisao(
  e: unknown,
  provider: RevisaoConfig['provider'],
  fallback = 'A revisão não pôde ser concluída. O erro foi registrado para o administrador.',
): string {
  const bruto = (e instanceof Error ? e.message : String(e ?? '')).toLowerCase()
  const status = typeof (e as { status?: unknown } | null)?.status === 'number' ? (e as { status: number }).status : null
  const conta = provider === 'anthropic' ? 'na conta da Anthropic (console.anthropic.com → Billing)' : 'no Google AI Studio (Billing)'
  if (bruto === 'sem_chave') return 'Nenhuma chave de IA cadastrada. Um administrador cadastra em Configurações → Revisão IA.'
  if (/credit|billing|prepay|depleted|quota|exceeded/.test(bruto)) return `A IA está sem créditos ou sem cota. Um administrador precisa conferir ${conta}.`
  // Só erro de CHAVE aqui. Até 28/09 qualquer "invalid" caía nesta frase — e um
  // 400 de formato do pedido virou "chave recusada" com a chave certa.
  if (status === 401 || status === 403 || /api key not valid|api_key_invalid|x-api-key|authentication_error|permission_denied|denied access/.test(bruto)) {
    return 'A chave da IA foi recusada. Um administrador precisa conferir em Configurações → Revisão IA.'
  }
  if (status === 404 || /not_found|not found|no longer available/.test(bruto)) return 'O modelo escolhido não está disponível. Troque o modelo em Configurações → Revisão IA.'
  if (status === 429 || status === 529 || (status ?? 0) >= 500 || /overloaded|high demand|unavailable|rate limit/.test(bruto)) {
    return 'A IA está sobrecarregada agora. Tente de novo em instantes.'
  }
  if (/timeout|tempo esgotado|timed out/.test(bruto)) return 'A IA demorou demais para responder. Tente de novo em instantes.'
  return fallback
}
