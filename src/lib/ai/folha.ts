import 'server-only'

/**
 * Extração ESTRUTURADA da folha de pagamento (PDF texto) por IA. O PDF vira texto
 * com `pdftotext -layout` (poppler, já instalado no servidor p/ o inventário) e o
 * modelo devolve os trabalhadores num schema fixo. Conservador: só transcreve o
 * que está no documento, converte moeda BR (1.234,56 → 1234.56).
 *
 * ⚠️ Até 11/08/2026 esta extração só falava Claude — e como produção nunca teve
 * ANTHROPIC_API_KEY, ela respondia 503 "IA não configurada" desde que nasceu.
 * Agora usa o mesmo Gemini do resto (lib/ai/gemini.ts).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { geminiConfigured, geminiJson } from './gemini'

const exec = promisify(execFile)

export interface FolhaLinha {
  matricula?: string; nome?: string; cpf?: string; cargo?: string; categoria?: string
  data_admissao?: string
  salario_base?: number; vencimentos?: number; descontos?: number
  inss?: number; irrf?: number; fgts?: number; vale_refeicao?: number; faltas?: number; liquido?: number
}
export interface FolhaExtraida { competencia: string | null; linhas: FolhaLinha[] }

const SCHEMA = {
  type: 'object',
  properties: {
    competencia: { type: 'string', description: 'Competência da folha no formato AAAA-MM (ex.: 2026-06). Do cabeçalho "GERAL DE MM/AAAA".' },
    trabalhadores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          matricula: { type: 'string', description: 'Código entre parênteses após "Trab:"' },
          nome: { type: 'string' },
          cpf: { type: 'string' },
          cargo: { type: 'string' },
          categoria: { type: 'string', description: 'Ex.: "101 - Empregado" ou "722 - Contribuinte individual"' },
          data_admissao: { type: 'string', description: 'AAAA-MM-DD (campo Adm)' },
          salario_base: { type: 'number', description: 'Campo Salário do cabeçalho do trabalhador' },
          vencimentos: { type: 'number', description: 'Total Vencimentos' },
          descontos: { type: 'number', description: 'Total Descontos' },
          inss: { type: 'number', description: 'Desconto 93 INSS (0 se não houver)' },
          irrf: { type: 'number', description: 'Desconto 95 IRRF (0 se não houver)' },
          fgts: { type: 'number', description: 'Vlr FGTS' },
          vale_refeicao: { type: 'number', description: 'Desconto 205 VALE REFEIÇÃO (0 se não houver)' },
          faltas: { type: 'number', description: 'Desconto 61 FALTAS em R$ (0 se não houver)' },
          liquido: { type: 'number', description: 'Valor Líquido' },
        },
        required: ['nome', 'liquido'],
      },
    },
  },
  required: ['trabalhadores'],
} as const

const SYSTEM = `Você extrai dados de uma FOLHA DE PAGAMENTO brasileira (texto de PDF). Regras:
- Transcreva SOMENTE o que está no documento; não invente nem calcule além do que está escrito.
- Um item por TRABALHADOR (linhas que começam com "Trab:"). Ignore o bloco "TOTAL GERAL".
- Converta valores do formato BR para número decimal com ponto: "4.291,46" → 4291.46; "1.621,00" → 1621.
- Descontos que não existirem para o trabalhador = 0.
- Responda no formato JSON pedido.`

/** pdftotext -layout do PDF (bytes) → texto. */
export async function pdfToText(bytes: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'folha-'))
  const pdf = path.join(dir, 'in.pdf')
  try {
    await writeFile(pdf, bytes)
    const { stdout } = await exec('pdftotext', ['-layout', pdf, '-'], { maxBuffer: 32 * 1024 * 1024 })
    return stdout
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Extrai a folha estruturada a partir do texto. Retorna null se não há IA configurada. */
export async function extrairFolha(texto: string): Promise<FolhaExtraida | null> {
  if (!geminiConfigured()) return null

  const { data } = await geminiJson<{ competencia?: unknown; trabalhadores?: unknown }>({
    system: SYSTEM,
    parts: [{ kind: 'text', text: `Extraia a folha abaixo.\n\n<folha>\n${texto.slice(0, 120000)}\n</folha>` }],
    schema: SCHEMA,
    model: process.env.FOLHA_MODEL_GEMINI,
    // Uma folha de 30 pessoas × 14 campos já passa de 8k só de JSON, e o raciocínio
    // divide o mesmo orçamento. Teto do modelo: 65.536.
    maxOutputTokens: 32768,
  })
  if (!data) return null

  const comp = typeof data.competencia === 'string' ? data.competencia : null
  const linhas: FolhaLinha[] = Array.isArray(data.trabalhadores) ? data.trabalhadores as FolhaLinha[] : []
  return { competencia: comp && /^\d{4}-\d{2}$/.test(comp) ? comp : null, linhas }
}
