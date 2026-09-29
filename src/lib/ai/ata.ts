import 'server-only'
import { iaDisponivel, iaJson } from './provedor'
import type { RevisaoConfig } from './revisao-config'

/**
 * Ata de reunião (29/09/2026): das notas coladas (Granola ou outra fonte) e da
 * transcrição, a IA devolve
 *  - `resumo`: o texto que o CLIENTE lê no portal quando a ata é publicada;
 *  - `passos`: os próximos passos, cada um com quem responde (agência × cliente)
 *    e, nos da agência, o RASCUNHO do briefing — que o form da Nova atividade
 *    organiza depois com o prompt da casa (lib/ai/briefing.ts).
 *
 * Mesmas regras do briefing: não inventar e não perder fato. O rascunho de cada
 * passo junta TUDO o que a reunião disse sobre ele; quem poda é a pessoa.
 */

export interface PassoAta {
  texto: string
  responsavel: 'agencia' | 'cliente'
  rascunho: string
}

export interface AtaOrganizada {
  titulo: string | null
  resumo: string
  passos: PassoAta[]
}

// Uma hora de reunião transcrita fica em ~60 mil caracteres; o teto cobre ~2 h.
const MAX_NOTAS = 30_000
const MAX_TRANSCRICAO = 150_000

const SYSTEM = `Você é o atendimento sênior de uma agência de publicidade. Recebe as notas
e, às vezes, a transcrição de uma reunião com um cliente e devolve a ATA.

REGRAS ABSOLUTAS
1. ZERO INVENÇÃO: só entra o que foi dito ou está nas notas. Não suponha prazo,
   quantidade, responsável nem decisão que não apareceu.
2. NADA SE PERDE: datas, nomes, números, valores, medidas, marcas, links, vetos e
   combinados que aparecem têm de estar no resumo ou no rascunho de algum passo.
3. Na dúvida entre o que as notas dizem e o que a transcrição diz, siga a
   transcrição e registre a divergência no resumo.

"titulo": curto (até 60 caracteres), o assunto da reunião, sem data.
  Ex.: "Planejamento da campanha de verão". Vazio se não der pra saber.

"resumo": o cliente vai ler este texto. Escreva em português claro, tom
  profissional e cordial, texto puro (sem markdown, sem **, sem #). Estrutura:
  - um parágrafo curto de contexto (o que foi tratado);
  - "Decisões:" seguido de linhas iniciadas por "- " (só se houve decisão);
  - "Pontos em aberto:" seguido de linhas "- " (só se houver).
  NÃO inclua no resumo: comentários internos da agência sobre o cliente, margem,
  custo interno, avaliação de pessoas, desabafos, piadas. NÃO repita os próximos
  passos aqui (eles vão em "passos").

"passos": cada ação combinada, uma por item.
  - "texto": a ação, curta e começando por verbo (até 90 caracteres).
    Ex.: "Criar 3 posts do lançamento do produto X".
  - "responsavel": "agencia" se quem executa é a agência; "cliente" se o cliente
    ficou de enviar, aprovar ou decidir algo.
  - "rascunho": só para passos da agência — TUDO que a reunião disse sobre esse
    trabalho, em texto corrido e fiel: formato, quantidade, público, mensagem,
    referências citadas, prazos, datas, pessoas, vetos, verba. É matéria-prima
    de briefing, não o briefing pronto. Para passos do cliente, "".
  - Não crie passo que ninguém combinou. Sem próximos passos, devolva [].`

interface RawAta { titulo?: unknown; resumo?: unknown; passos?: unknown }

export async function organizarAta(
  notas: string, transcricao: string, cfg: RevisaoConfig | null,
): Promise<AtaOrganizada | null> {
  if (!iaDisponivel(cfg)) return null
  const n = (notas ?? '').trim().slice(0, MAX_NOTAS)
  const t = (transcricao ?? '').trim().slice(0, MAX_TRANSCRICAO)
  if (!n && !t) return null

  const partes: string[] = []
  if (n) partes.push(`NOTAS DA REUNIÃO:\n--- INÍCIO ---\n${n}\n--- FIM ---`)
  if (t) partes.push(`TRANSCRIÇÃO:\n--- INÍCIO ---\n${t}\n--- FIM ---`)

  const { data } = await iaJson<RawAta>(cfg, {
    system: SYSTEM,
    parts: [{ kind: 'text', text: partes.join('\n\n') }],
    schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        resumo: { type: 'string' },
        passos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              texto: { type: 'string' },
              responsavel: { type: 'string', enum: ['agencia', 'cliente'] },
              rascunho: { type: 'string' },
            },
            required: ['texto', 'responsavel', 'rascunho'],
          },
        },
      },
      required: ['titulo', 'resumo', 'passos'],
    },
    modeloAmbiente: process.env.BRIEFING_MODEL_GEMINI,
    maxOutputTokens: 16384,
    // Transcrição longa leva tempo; a pessoa espera com o spinner.
    timeoutMs: 90_000,
  })
  return normalizar(data)
}

function normalizar(out: RawAta | null): AtaOrganizada {
  const titulo = typeof out?.titulo === 'string' && out.titulo.trim() ? out.titulo.trim().slice(0, 120) : null
  const resumo = typeof out?.resumo === 'string' ? out.resumo.trim() : ''
  const passos: PassoAta[] = Array.isArray(out?.passos)
    ? out.passos.flatMap(p => {
        const o = (p ?? {}) as Record<string, unknown>
        const texto = typeof o.texto === 'string' ? o.texto.trim() : ''
        if (!texto) return []
        const responsavel = o.responsavel === 'cliente' ? 'cliente' : 'agencia'
        const rascunho = responsavel === 'agencia' && typeof o.rascunho === 'string' ? o.rascunho.trim() : ''
        return [{ texto, responsavel, rascunho }]
      })
    : []
  return { titulo, resumo, passos }
}
