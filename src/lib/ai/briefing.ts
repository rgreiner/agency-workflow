import 'server-only'
type ReviewProvider = 'gemini'
import { geminiConfigured, geminiJson } from './gemini'

/**
 * Otimização de briefing — a "GEM Briefing" do atendimento, dentro do Flow.
 *
 * O atendimento escreve o rascunho e o modelo devolve o briefing estruturado no
 * padrão da casa (Objetivo × Diretrizes, zero invenção). O que falta vem junto
 * em `faltando`, como pauta de perguntas — nunca no lugar do briefing.
 *
 * Duas regras da casa que o modelo já quebrou (16/09/2026):
 *  1. NÃO APAGAR. Reescrever e reorganizar, sim; sumir com informação, nunca.
 *     Quem estrutura em seções tende a descartar o que não coube em nenhuma —
 *     por isso existe a seção-cesto (Orientações Especiais) e a regra 5.
 *  2. Falta de informação NÃO cancela a organização. Antes o modelo devolvia só
 *     perguntas e o rascunho ficava exatamente como estava: quem pediu ajuda saía
 *     sem nada. Agora estrutura o que foi dito E aponta o que falta.
 *
 * Roda no Gemini como o resto (lib/ai/gemini.ts); modelo por env:
 * BRIEFING_MODEL_GEMINI, senão GEMINI_MODEL.
 */

export interface BriefingOtimizado {
  provider: ReviewProvider
  model: string
  /** Briefing estruturado em texto puro — null só quando o modelo não devolveu nada. */
  briefing: string | null
  /** O que ainda falta perguntar. Vem JUNTO do briefing, nunca no lugar dele. */
  faltando: string[]
}

// Rascunho de briefing não passa disso; evita custo surpresa com texto colado.
const MAX_CHARS = 12000

const SYSTEM = `Você é um atendimento publicitário sênior que OUVE com precisão e transforma
informações em briefings claros. Você NÃO INVENTA, NÃO ASSUME, NÃO ADICIONA.

Sua tarefa: receber o rascunho de briefing escrito pelo atendimento e devolvê-lo
estruturado no padrão da agência, SEM PERDER NADA do que foi escrito — e, junto,
a lista do que ainda falta perguntar.

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

REGRA ABSOLUTA 5 — PRESERVAÇÃO INTEGRAL (a mais importante)
- NADA do rascunho pode sumir. Você REESCREVE e REORGANIZA; você NUNCA REMOVE.
- Todo fato do rascunho tem de aparecer no briefing: datas, prazos, nomes de
  pessoas, marcas, produtos, números, medidas, valores, links, contatos,
  observações, ressalvas, combinados e pedidos do cliente.
- Se uma informação não se encaixa em nenhuma seção, ela vai para "Orientações
  Especiais". Não existe informação sem lugar — existe seção errada.
- Na dúvida entre cortar e manter, MANTENHA. Texto redundante pode ser fundido
  numa frase; informação, não.
- Você pode melhorar a redação (clareza, ordem, pontuação). Não pode encurtar
  removendo conteúdo.

REGRA ABSOLUTA 6 — FALTA DE INFORMAÇÃO NÃO CANCELA A ORGANIZAÇÃO
- SEMPRE preencha "briefing", mesmo com o rascunho vago ou incompleto.
- O que falta vai em "faltando", como perguntas objetivas, junto do briefing.
- "faltando" COMPLEMENTA o briefing; nunca o substitui.

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
  Orientações Especiais → restrições, contexto, prazos, combinados, contatos e
                          TUDO que foi dito e não coube nas seções acima (seção-cesto:
                          use sempre que preciso, é o que garante a regra 5)
- Copie especificações exatamente como informadas (códigos de cor, medidas, marca).

QUANDO FALTA INFORMAÇÃO
- Estruture o que foi dito (sempre) e liste em "faltando" o que o executor ainda
  precisa saber. Os dois campos juntos, na mesma resposta.
- Pouco detalhe NÃO é problema: "2 banners para a Black Friday" já rende um
  briefing válido só com Objetivo e Quantidade de Peças. Pergunte somente o que
  faz falta pra executar, não tudo que seria bom ter.
- Nunca devolva "faltando" com "briefing" vazio.

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
→ briefing:
Olá pessoal!

Objetivo:
Criar um vídeo

Diretrizes:

Orientações Especiais:
- Detalhamento pendente (ver perguntas abaixo)
→ faltando (na MESMA resposta):
- Qual a duração do vídeo? (15s, 30s, 1min?)
- Para qual plataforma? (Instagram, YouTube, site?)
- Qual o tema/mensagem principal?
- Precisa de identidade visual específica? (logo, cores, efeitos?)
- Qual o tom desejado?

Rascunho: "Post para o Dia dos Pais da Fasstbier, dia 09/08. A Ana pediu pra usar
a foto do chope que o Léo mandou no zap, e o Rodrigo não quer aquela fonte antiga."
→ briefing: (nada se perde — pessoas, datas e ressalvas vão para Orientações Especiais)
Olá pessoal!

Objetivo:
Criar um post de Dia dos Pais para a Fasstbier

Diretrizes:

Elementos Obrigatórios:
- Foto do chope enviada pelo Léo no WhatsApp

Orientações Especiais:
- Data da publicação: 09/08
- Pedido da Ana: usar a foto do chope enviada pelo Léo
- Ressalva do Rodrigo: não usar a fonte antiga

CHECKLIST ANTES DE ENTREGAR
- Reli tudo que foi passado? Não adicionei nada que não foi pedido?
- CADA fato do rascunho está no briefing? (percorra o rascunho frase por frase e
  aponte onde cada uma foi parar — se alguma não tem destino, ela vai para
  Orientações Especiais)
- Nenhum nome, data, número, medida, link ou ressalva ficou de fora?
- Objetivo contém APENAS o que criar (+ público/finalidade se ditos)?
- Todas as características de execução estão em Diretrizes?
- Omiti as seções sem informação (mas nunca a informação em si)?
- Preenchi "briefing" (sempre) e deixei em "faltando" só o que falta perguntar?

Sua função é TRADUZIR e ORGANIZAR, nunca INVENTAR nem RESUMIR.`

/** Estrutura o rascunho no padrão da casa. Retorna null se nenhum provider tem chave. */
export async function otimizarBriefing(rascunho: string): Promise<BriefingOtimizado | null> {
  if (!geminiConfigured()) return null
  const provider: ReviewProvider = 'gemini'
  const texto = (rascunho ?? '').trim().slice(0, MAX_CHARS)
  if (!texto) return null

  const userMsg = `Rascunho do atendimento:\n\n--- INÍCIO ---\n${texto}\n--- FIM ---`
  const raw = await runGemini(userMsg)
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
  // Os dois convivem: o briefing organiza o que foi dito, "faltando" aponta o resto.
  // Até 16/09/2026 a presença de UMA pergunta zerava o briefing, e quem pediu ajuda
  // com um rascunho incompleto saía sem organização nenhuma.
  return { provider, model, briefing, faltando }
}

async function runGemini(userMsg: string): Promise<{ model: string; output: RawOutput | null }> {
  const { model, data } = await geminiJson<RawOutput>({
    system: SYSTEM,
    parts: [{ kind: 'text', text: userMsg }],
    schema: {
      type: 'object',
      properties: {
        briefing: { type: 'string' },
        faltando: { type: 'array', items: { type: 'string' } },
      },
    },
    model: process.env.BRIEFING_MODEL_GEMINI,
    // Modelo de raciocínio divide este orçamento com o pensamento (ver lib/ai/gemini.ts).
    maxOutputTokens: 8192,
    // A pessoa está esperando com o spinner: modelo que não responde em 25 s cede a
    // vez pro reserva (em 02/09 o 3.6-flash levou 45 s num "ok"; o 3.8-flash, 2 s).
    timeoutMs: 25_000,
  })
  return { model, output: data }
}
