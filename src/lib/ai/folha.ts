import 'server-only'

/**
 * Extração ESTRUTURADA da folha de pagamento (PDF texto) por IA. O PDF vira texto
 * com `pdftotext -layout` (poppler, já instalado no servidor p/ o inventário) e o
 * Claude devolve os trabalhadores num schema fixo (tool use). Conservador: só
 * transcreve o que está no documento, converte moeda BR (1.234,56 → 1234.56).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const exec = promisify(execFile)

export interface FolhaLinha {
  matricula?: string; nome?: string; cpf?: string; cargo?: string; categoria?: string
  data_admissao?: string
  salario_base?: number; vencimentos?: number; descontos?: number
  inss?: number; irrf?: number; fgts?: number; vale_refeicao?: number; faltas?: number; liquido?: number
}
export interface FolhaExtraida { competencia: string | null; linhas: FolhaLinha[] }

const TOOL_SCHEMA = {
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
- Reporte tudo pela ferramenta reportar_folha.`

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
  if (!process.env.ANTHROPIC_API_KEY) return null
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const model = process.env.FOLHA_MODEL_CLAUDE || process.env.REVIEW_MODEL_CLAUDE || 'claude-sonnet-4-6'

  const msg = await client.messages.create({
    model, max_tokens: 8192, temperature: 0, system: SYSTEM,
    messages: [{ role: 'user', content: `Extraia a folha abaixo.\n\n<folha>\n${texto.slice(0, 120000)}\n</folha>` }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ name: 'reportar_folha', description: 'Reporta os trabalhadores da folha.', input_schema: TOOL_SCHEMA as any }],
    tool_choice: { type: 'tool', name: 'reportar_folha' },
  })
  const block = msg.content.find(b => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input = block.input as any
  const comp: string | null = typeof input?.competencia === 'string' ? input.competencia : null
  const linhas: FolhaLinha[] = Array.isArray(input?.trabalhadores) ? input.trabalhadores : []
  return { competencia: comp && /^\d{4}-\d{2}$/.test(comp) ? comp : null, linhas }
}
