import 'server-only'

/**
 * Extração ESTRUTURADA de uma guia de recolhimento (PDF texto) por IA — Darf/
 * DCTFweb, FGTS Digital, DAS, GPS, parcelamentos e boletos de tributo em geral.
 * Mesmo padrão da folha (lib/ai/folha.ts): pdftotext -layout + saída estruturada
 * por schema fixo, conservador (só transcreve o que está no documento).
 *
 * ⚠️ Como a folha, só falava Claude até 11/08/2026 — e produção nunca teve a
 * chave, então respondia 503 desde o primeiro dia. Agora usa lib/ai/gemini.ts.
 */

import { geminiConfigured, geminiJson } from './gemini'

export type GuiaTipo = 'darf' | 'fgts' | 'das' | 'gps' | 'parcelamento' | 'outro'

export interface GuiaExtraida {
  tipo: GuiaTipo
  orgao: string | null        // emissor/beneficiário (Receita Federal, FGTS, …)
  numero: string | null       // nº do documento, se houver (curto; não código de barras)
  competencia: string | null  // AAAA-MM (período de apuração)
  valor: number | null        // valor total a pagar
  vencimento: string | null   // AAAA-MM-DD ("pagar até")
  descricao: string | null    // rótulo curto, ex.: "Darf DCTFweb 07/2026"
  palavras_chave: string[]    // termos p/ casar com o lançamento provisionado
}

const SCHEMA = {
  type: 'object',
  properties: {
    tipo: {
      type: 'string', enum: ['darf', 'fgts', 'das', 'gps', 'parcelamento', 'outro'],
      description: 'darf = Darf/DCTFweb (INSS+IRRF); fgts = guia do FGTS (GFD/GRF); das = Simples Nacional; gps = Guia da Previdência Social; parcelamento = parcela de parcelamento (traz "Parcela N"); outro = qualquer outra guia/boleto de tributo.',
    },
    orgao: { type: 'string', description: 'Emissor/beneficiário do pagamento (ex.: Receita Federal, FGTS, Prefeitura).' },
    numero: { type: 'string', description: 'Número do documento, se existir e for curto. NUNCA o código de barras.' },
    competencia: { type: 'string', description: 'Período de apuração/competência no formato AAAA-MM.' },
    valor: { type: 'number', description: 'Valor TOTAL a recolher/pagar, em decimal com ponto: "2.302,66" → 2302.66.' },
    vencimento: { type: 'string', description: 'Data de vencimento ("pagar até") no formato AAAA-MM-DD.' },
    descricao: { type: 'string', description: 'Rótulo curto em pt-BR, ex.: "Darf DCTFweb 07/2026", "FGTS Digital 07/2026", "DAS 07/2026", "Parcelamento INSS parcela 39/44".' },
    palavras_chave: {
      type: 'array', items: { type: 'string' },
      description: '2 a 5 termos do documento úteis pra achar o lançamento correspondente (ex.: ["darf", "dctfweb", "inss"]). Minúsculas, sem pontuação.',
    },
  },
  required: ['tipo', 'valor', 'vencimento'],
} as const

const SYSTEM = `Você extrai dados de uma GUIA DE RECOLHIMENTO brasileira (texto de PDF): Darf/DCTFweb, FGTS Digital (GFD), DAS do Simples Nacional, GPS, parcela de parcelamento ou boleto de tributo. Regras:
- Transcreva SOMENTE o que está no documento; não invente nem calcule.
- Converta valores do formato BR para decimal com ponto: "2.302,66" → 2302.66.
- Datas sempre AAAA-MM-DD; competência/período de apuração AAAA-MM.
- Se houver "Parcela N/M" ou menção a parcelamento, o tipo é "parcelamento".
- Responda no formato JSON pedido.`

/** Extrai a guia estruturada a partir do texto. Retorna null se não há IA configurada. */
export async function extrairGuia(texto: string): Promise<GuiaExtraida | null> {
  if (!geminiConfigured()) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await geminiJson<any>({
    system: SYSTEM,
    parts: [{ kind: 'text', text: `Extraia a guia abaixo.\n\n<guia>\n${texto.slice(0, 60000)}\n</guia>` }],
    schema: SCHEMA,
    model: process.env.GUIA_MODEL_GEMINI || process.env.FOLHA_MODEL_GEMINI,
    maxOutputTokens: 1024,
  })
  if (!data) return null
  const i = data
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const tipo: GuiaTipo = ['darf', 'fgts', 'das', 'gps', 'parcelamento', 'outro'].includes(i?.tipo) ? i.tipo : 'outro'
  const comp = str(i?.competencia)
  const venc = str(i?.vencimento)
  return {
    tipo,
    orgao: str(i?.orgao),
    numero: str(i?.numero),
    competencia: comp && /^\d{4}-\d{2}$/.test(comp) ? comp : null,
    valor: typeof i?.valor === 'number' && i.valor > 0 ? i.valor : null,
    vencimento: venc && /^\d{4}-\d{2}-\d{2}$/.test(venc) ? venc : null,
    descricao: str(i?.descricao),
    palavras_chave: Array.isArray(i?.palavras_chave)
      ? i.palavras_chave.filter((p: unknown): p is string => typeof p === 'string')
          .map((p: string) => p.toLowerCase().replace(/[^a-z0-9à-ú ]/g, '').trim())
          .filter((p: string) => p.length >= 3).slice(0, 5)
      : [],
  }
}
