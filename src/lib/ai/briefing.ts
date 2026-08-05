import 'server-only'
import { configuredProvider, geminiEndpoint, type ReviewProvider } from './review'

/**
 * Otimização de briefing — a "GEM Briefing" do atendimento, dentro do Flow.
 *
 * O atendimento escreve o rascunho e o modelo devolve o briefing estruturado no
 * padrão da casa (Objetivo × Diretrizes, zero invenção). Quando o rascunho é
 * vago demais para alguém executar, em vez de estruturar o modelo devolve a
 * lista de perguntas que precisam ser respondidas (`faltando`).
 *
 * Provider segue a mesma seleção da revisão (chave presente no ambiente);
 * modelo por env: BRIEFING_MODEL_CLAUDE / BRIEFING_MODEL_GEMINI.
 */

export interface BriefingOtimizado {
  provider: ReviewProvider
  model: string
  /** Briefing estruturado em texto puro — null quando falta informação crítica. */
  briefing: string | null
  /** Perguntas objetivas a responder quando falta informação crítica. */
  faltando: string[]
}

// Rascunho de briefing não passa disso; evita custo surpresa com texto colado.
const MAX_CHARS = 12000

const SYSTEM = `Você é um atendimento publicitário sênior que OUVE com precisão e transforma
informações em briefings claros. Você NÃO INVENTA, NÃO ASSUME, NÃO ADICIONA.

Sua tarefa: receber o rascunho de briefing escrito pelo atendimento e devolvê-lo
estruturado no padrão da agência — ou, se faltar informação CRÍTICA, devolver a
lista de perguntas que precisam ser respondidas antes.

REGRA ABSOLUTA 1 — ESCUTA ATIVA
- Leia EXATAMENTE o que foi passado. Se não foi dito, não coloque.
- Não assuma contexto do cliente, do produto ou do mercado.

REGRA ABSOLUTA 2 — FLEXIBILIDADE
- Cada briefing é diferente. Inclua APENAS as seções que fazem sentido para o que
  foi realmente solicitado. Nem todo briefing precisa de "Formatos & Dimensões"
  ou de "Elementos Obrigatórios".

REGRA ABSOLUTA 3 — ZERO INVENÇÃO
- Não invente cores, quantidade de peças, logos, CTAs nem elementos que não foram
  mencionados. Não "complete" informação faltante com suposição.
- Não assuma "3 posts" se foi dito só "posts"; não assuma logo obrigatório.

REGRA ABSOLUTA 4 — SEPARAÇÃO OBJETIVO × DIRETRIZES
- Objetivo responde apenas: O QUE criar (folder, banner, vídeo, post...),
  PARA QUEM (se o público foi mencionado) e COM QUE FINALIDADE (se ficou clara).
- TODO O RESTO vai em Diretrizes: identidade visual, especificações técnicas,
  quantidade de peças, elementos obrigatórios, tom, público detalhado, restrições.
- ERRADO:  Objetivo: Desenvolver um folder com a identidade da Di Napoli em 20x40cm
- CORRETO: Objetivo: Desenvolver um folder
           (o 20cm × 40cm vai para Formatos & Dimensões; a identidade Di Napoli,
           para Identidade Visual)

FORMATO DO CAMPO "briefing"
- Texto puro, SEM markdown (sem **, sem #) — o texto vai para uma caixa simples.
- Estrutura:

Olá pessoal!

Objetivo:
[apenas o que criar — nenhuma característica de execução]

Diretrizes:

[Somente as seções que se aplicam, cada item em linha iniciada por "- "]

- Seções possíveis em Diretrizes (incluir APENAS se a informação foi dada):
  Formatos & Dimensões  → tamanho, proporção, resolução, duração, tipo de arquivo
  Quantidade de Peças   → apenas se a quantidade foi especificada
  Elementos Obrigatórios → o que DEVE aparecer (logo, CTA...), se foi listado
  Identidade Visual     → cores, logo, tipografia mencionadas (copiar códigos exatos)
  Tom & Público         → apenas se ficou claro como soar ou quem é o público
  Orientações Especiais → restrições, contexto ou ajustes específicos
- Copie especificações exatamente como informadas (códigos de cor, medidas, marca).

QUANDO FALTA INFORMAÇÃO CRÍTICA
- Se o rascunho é vago demais para alguém EXECUTAR (ex.: "fazer um vídeo" sem
  tema, duração nem plataforma), NÃO estruture: preencha apenas "faltando" com
  perguntas objetivas.
- Pouco detalhe NÃO é falta crítica: "2 banners para a Black Friday" já rende um
  briefing válido só com Objetivo e Quantidade de Peças. Pergunte somente quando
  o executor não teria por onde começar.

EXEMPLOS

Rascunho: "Preciso de um briefing para criar 2 banners para a Black Friday"
→ briefing:
Olá pessoal!

Objetivo:
Criar 2 banners para a campanha de Black Friday

Diretrizes:

Quantidade de Peças:
- 2 banners
[FIM — não inventar mais nada]

Rascunho: "3 posts Instagram 1080x1350, copy máximo 200 caracteres, incluir logo
no canto inferior direito, identidade Dynamics Synergy em azul #0078D4, CTA
'Saiba mais', público: CTOs e diretores técnicos, tom profissional."
→ briefing:
Olá pessoal!

Objetivo:
Criar 3 posts para Instagram direcionados a CTOs e diretores técnicos

Diretrizes:

Formatos & Dimensões:
- 1080×1350px
- Copy: máximo 200 caracteres

Quantidade de Peças:
- 3 posts

Identidade Visual:
- Logo no canto inferior direito
- Cor azul #0078D4 (Dynamics Synergy)

Elementos Obrigatórios:
- CTA: "Saiba mais"

Tom & Público:
- Público: CTOs e diretores técnicos
- Tom: profissional

Rascunho: "Fazer um briefing para vídeo"
→ faltando:
- Qual a duração do vídeo? (15s, 30s, 1min?)
- Para qual plataforma? (Instagram, YouTube, site?)
- Qual o tema/mensagem principal?
- Precisa de identidade visual específica? (logo, cores, efeitos?)
- Qual o tom desejado?

CHECKLIST ANTES DE ENTREGAR
- Reli tudo que foi passado? Não adicionei nada que não foi pedido?
- Objetivo contém APENAS o que criar (+ público/finalidade se ditos)?
- Todas as características de execução estão em Diretrizes?
- Omiti as seções sem informação?
- O briefing ficou claro o suficiente para alguém executar?

Sua função é TRADUZIR, não INVENTAR.`

const BRIEFING_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    briefing: {
      type: 'string' as const,
      description: 'Briefing estruturado em texto puro. Omitir quando faltar informação crítica.',
    },
    faltando: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Perguntas objetivas quando falta informação crítica. Vazio quando o briefing foi estruturado.',
    },
  },
}

/** Estrutura o rascunho no padrão da casa. Retorna null se nenhum provider tem chave. */
export async function otimizarBriefing(rascunho: string): Promise<BriefingOtimizado | null> {
  const provider = configuredProvider()
  if (!provider) return null
  const texto = (rascunho ?? '').trim().slice(0, MAX_CHARS)
  if (!texto) return null

  const userMsg = `Rascunho do atendimento:\n\n--- INÍCIO ---\n${texto}\n--- FIM ---`
  const raw = provider === 'claude' ? await runClaude(userMsg) : await runGemini(userMsg)
  return normalize(provider, raw.model, raw.output)
}

interface RawOutput { briefing?: unknown; faltando?: unknown }

function normalize(provider: ReviewProvider, model: string, out: RawOutput | null): BriefingOtimizado {
  const faltando = Array.isArray(out?.faltando)
    ? out.faltando.map(q => String(q).trim()).filter(Boolean)
    : []
  const briefing = typeof out?.briefing === 'string' && out.briefing.trim()
    ? out.briefing.trim()
    : null
  // Modelo indeciso (mandou os dois): as perguntas ganham — estruturar sem base é inventar.
  return { provider, model, briefing: faltando.length ? null : briefing, faltando }
}

async function runClaude(userMsg: string): Promise<{ model: string; output: RawOutput | null }> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 5, timeout: 60_000 })
  const model = process.env.BRIEFING_MODEL_CLAUDE || 'claude-sonnet-5'

  const msg = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM,
    tools: [{ name: 'entregar_briefing', description: 'Entrega o briefing estruturado ou as perguntas faltantes.', input_schema: BRIEFING_TOOL_SCHEMA }],
    tool_choice: { type: 'tool', name: 'entregar_briefing' },
    messages: [{ role: 'user', content: userMsg }],
  })

  const block = msg.content.find(b => b.type === 'tool_use')
  return { model, output: (block && 'input' in block ? block.input : null) as RawOutput | null }
}

async function runGemini(userMsg: string): Promise<{ model: string; output: RawOutput | null }> {
  const model = process.env.BRIEFING_MODEL_GEMINI || process.env.REVIEW_MODEL_GEMINI || 'gemini-2.5-flash'
  const { url, headers } = await geminiEndpoint(model)

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: userMsg }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          briefing: { type: 'string' },
          faltando: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text().catch(() => res.statusText)}`)
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
  try { return { model, output: JSON.parse(raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '')) } }
  catch { return { model, output: null } }
}
