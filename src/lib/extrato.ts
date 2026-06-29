// Mapeamento do extrato da Conta Azul (export "Extrato Financeiro") para as linhas
// que o RPC import_extrato espera. Funções puras — a leitura do arquivo (XLS/CSV)
// é feita no client com SheetJS e entrega uma matriz (array de arrays).

export interface ExtratoRow {
  import_ref: string
  data_mov: string | null
  contato: string | null
  descricao: string | null
  tipo: string | null // 'receita' | 'despesa'
  origem: string | null
  conta: string | null
  forma_pgto: string | null
  valor: number | null
  saldo_conta: number | null
  situacao: string | null
  valor_original: number | null
  juros: number
  multa: number
  desconto: number
  taxas: number
  competencia: string | null
  venc_original: string | null
  data_prevista: string | null
  observacao: string | null
  nota_fiscal: string | null
  categoria: string | null
  centro_custo: string | null
  recorrencia: string | null
  qtd_recorrencia: string | null
}

// O mapeamento lê cada coluna pelo rótulo do cabeçalho do export (ver mapSheetToRows),
// pegando sempre a primeira ocorrência — o export repete "Centro de Custo 1" no fim.
const norm = (s: unknown) => String(s ?? '').trim()

/** 'dd/mm/yyyy' (ou Date do SheetJS) → 'yyyy-mm-dd'; vazio → null. */
export function parseDateBR(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  const s = norm(v)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  return null
}

/** '40592.38' | '1.234,56' | number → number; vazio/'-' → null. */
export function parseNum(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  let s = norm(v)
  if (!s || s === '-') return null
  // formato BR "1.234,56" → "1234.56"; formato "1234.56" fica intacto
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s.replace(/[^\d.-]/g, ''))
  return isFinite(n) ? n : null
}

function tipoFrom(raw: string): string | null {
  const t = raw.toLowerCase()
  if (t.startsWith('receita')) return 'receita'
  if (t.startsWith('despesa')) return 'despesa'
  return null
}

/** Acha a linha de cabeçalho (a que contém "Data movimento") e mapeia col→índice. */
function headerIndex(matrix: unknown[][]): { headerRow: number; idx: Record<string, number> } | null {
  for (let r = 0; r < Math.min(matrix.length, 20); r++) {
    const row = matrix[r] ?? []
    if (row.some(c => norm(c) === 'Data movimento')) {
      const idx: Record<string, number> = {}
      row.forEach((c, i) => {
        const label = norm(c)
        if (label && !(label in idx)) idx[label] = i
      })
      return { headerRow: r, idx }
    }
  }
  return null
}

export interface MapResult {
  rows: ExtratoRow[]
  skipped: number
  error?: string
}

/** Matriz (array de arrays) do SheetJS → linhas tipadas para o import. */
export function mapSheetToRows(matrix: unknown[][]): MapResult {
  const head = headerIndex(matrix)
  if (!head) {
    return { rows: [], skipped: 0, error: 'Cabeçalho não encontrado — confira se é o export "Extrato Financeiro" da Conta Azul.' }
  }
  const { headerRow, idx } = head
  const get = (row: unknown[], label: string) => {
    const i = idx[label]
    return i == null ? undefined : row[i]
  }

  const rows: ExtratoRow[] = []
  let skipped = 0
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? []
    const dataMov = parseDateBR(get(row, 'Data movimento'))
    const valor = parseNum(get(row, 'Valor (R$)'))
    const situacao = norm(get(row, 'Situação')) || null
    // linha vazia: sem data e sem valor
    if (dataMov == null && valor == null && !situacao) { skipped++; continue }

    const tipo = tipoFrom(norm(get(row, 'Tipo')))
    const saldo = parseNum(get(row, 'Saldo conta (R$)'))
    const descricao = norm(get(row, 'Descrição')) || null
    const competencia = parseDateBR(get(row, 'Data de competência'))
    const contato = norm(get(row, 'Nome do fornecedor/cliente')) || null
    const conta = norm(get(row, 'Conta bancária')) || null

    // chave de dedup estável (não depende da ordem das linhas, pra reimport não duplicar):
    // data|competência|valor|saldo|situação|descrição|contato|conta
    const import_ref = [
      dataMov ?? '', competencia ?? '', valor ?? '', saldo ?? '', situacao ?? '',
      descricao ?? '', contato ?? '', conta ?? '',
    ].join('|')

    rows.push({
      import_ref,
      data_mov: dataMov,
      contato,
      descricao,
      tipo,
      origem: norm(get(row, 'Origem do lançamento')) || null,
      conta,
      forma_pgto: norm(get(row, 'Forma de pgto/recbto')) || null,
      valor,
      saldo_conta: saldo,
      situacao,
      valor_original: parseNum(get(row, 'Valor original (R$)')),
      juros: parseNum(get(row, 'Juros (R$)')) ?? 0,
      multa: parseNum(get(row, 'Multa (R$)')) ?? 0,
      desconto: parseNum(get(row, 'Desconto (R$)')) ?? 0,
      taxas: parseNum(get(row, 'Taxas (R$)')) ?? 0,
      competencia,
      venc_original: parseDateBR(get(row, 'Data original de vencimento')),
      data_prevista: parseDateBR(get(row, 'Data prevista')),
      observacao: norm(get(row, 'Observações')) || null,
      nota_fiscal: norm(get(row, 'Nota fiscal')) || null,
      categoria: norm(get(row, 'Categoria 1')) || null,
      centro_custo: norm(get(row, 'Centro de Custo 1')) || null,
      recorrencia: norm(get(row, 'Recorrência')) || null,
      qtd_recorrencia: norm(get(row, 'Quantidade de recorrência')) || null,
    })
  }
  return { rows, skipped }
}

// ── Classificação p/ as views de fluxo de caixa ──────────────
// Realizado = Conciliado/Quitado/Transferido (entrou/saiu de fato).
// Previsto  = Em aberto/Atrasado (a receber/pagar).
// Ignorar   = Perdido/Desconsiderado.
export const isRealizado = (s: string | null) =>
  s === 'Conciliado' || s === 'Quitado' || s === 'Transferido'
export const isPrevisto = (s: string | null) =>
  s === 'Em aberto' || s === 'Atrasado'
export const isIgnorado = (s: string | null) =>
  s === 'Perdido/Desconsiderado' || s == null
// Transferência entre contas: não é receita nem despesa (zero-soma).
export const isTransferencia = (origem: string | null, categoria: string | null) =>
  origem === 'Transferência' || (categoria?.startsWith('Transferência') ?? false)

/** Resumo p/ o preview do import. */
export function summarize(rows: ExtratoRow[]) {
  let recebido = 0, pago = 0, aReceber = 0, aPagar = 0
  let minD: string | null = null, maxD: string | null = null
  for (const r of rows) {
    const d = r.data_mov ?? r.data_prevista
    if (d) { if (!minD || d < minD) minD = d; if (!maxD || d > maxD) maxD = d }
    if (isTransferencia(r.origem, r.categoria)) continue
    const v = Math.abs(r.valor ?? 0)
    if (isRealizado(r.situacao)) {
      if (r.tipo === 'receita') recebido += v
      else if (r.tipo === 'despesa') pago += v
    } else if (isPrevisto(r.situacao)) {
      if (r.tipo === 'receita') aReceber += v
      else if (r.tipo === 'despesa') aPagar += v
    }
  }
  return { total: rows.length, recebido, pago, aReceber, aPagar, periodo: { de: minD, ate: maxD } }
}
