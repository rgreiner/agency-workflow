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

    // O import SUBSTITUI tudo (apaga + recarrega o extrato completo), então a chave só
    // precisa ser única DENTRO do arquivo. Prefixo de sequência garante isso e evita
    // fundir duas linhas parecidas — o export da Conta Azul não traz ID de transação.
    const fingerprint = [
      dataMov ?? '', competencia ?? '', valor ?? '', saldo ?? '', situacao ?? '',
      descricao ?? '', contato ?? '', conta ?? '',
    ].join('|')
    const import_ref = `${rows.length}|${fingerprint}`

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

// ── Seed da config do Financeiro a partir do extrato ─────────
export interface SeedConta { nome: string; tipo: string; saldo_inicial: number; cor: string }
export interface SeedCentro { nome: string; cor: string }
export interface SeedCategoria { nome: string; tipo: string; cor: string }
export interface SeedData { contas: SeedConta[]; centros: SeedCentro[]; categorias: SeedCategoria[] }

const PALETA = ['#f97316', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#eab308', '#14b8a6', '#ef4444', '#6366f1', '#06b6d4']
const corPara = (i: number) => PALETA[i % PALETA.length]

function tipoConta(nome: string): string {
  const n = nome.toLowerCase()
  if (n.includes('fundo') || n.includes('reserva') || n.includes('aplica') || n.includes('crédito') || n.includes('credito')) return 'aplicacao'
  if (n.includes('caixa') || n.includes('ajuste')) return 'caixa'
  return 'banco'
}

// Categorias técnicas do extrato que não viram categoria de lançamento.
const CAT_SISTEMA = new Set(['Saldo Inicial', 'Transferência de Entrada', 'Transferência de Saída'])

/** Deriva contas (com saldo atual), centros de custo e categorias do extrato. */
export function seedFromRows(rows: ExtratoRow[]): SeedData {
  // saldo atual por conta = soma assinada dos realizados
  const saldo = new Map<string, number>()
  for (const r of rows) {
    if (!r.conta || !isRealizado(r.situacao)) continue
    const s = r.tipo === 'receita' ? Math.abs(r.valor ?? 0) : r.tipo === 'despesa' ? -Math.abs(r.valor ?? 0) : 0
    saldo.set(r.conta, (saldo.get(r.conta) ?? 0) + s)
  }
  const contas: SeedConta[] = [...saldo.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([nome, v], i) => ({ nome, tipo: tipoConta(nome), saldo_inicial: Math.round(v * 100) / 100, cor: corPara(i) }))

  // centros de custo distintos (= clientes)
  const centrosSet = new Map<string, boolean>()
  for (const r of rows) if (r.centro_custo) centrosSet.set(r.centro_custo, true)
  const centros: SeedCentro[] = [...centrosSet.keys()]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((nome, i) => ({ nome, cor: corPara(i) }))

  // categorias com tipo (entrada | saida | ambos)
  const cat = new Map<string, { e: boolean; s: boolean }>()
  for (const r of rows) {
    if (!r.categoria || CAT_SISTEMA.has(r.categoria)) continue
    const cur = cat.get(r.categoria) ?? { e: false, s: false }
    if (r.tipo === 'receita') cur.e = true
    if (r.tipo === 'despesa') cur.s = true
    cat.set(r.categoria, cur)
  }
  const categorias: SeedCategoria[] = [...cat.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
    .map(([nome, v], i) => ({
      nome,
      tipo: v.e && v.s ? 'ambos' : v.e ? 'entrada' : 'saida',
      cor: corPara(i),
    }))

  return { contas, centros, categorias }
}

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
