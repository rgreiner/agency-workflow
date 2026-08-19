// Regras da tela de Análise (financeiro/analise) — módulo PURO de propósito: a
// tela pivota tudo em memória e nenhuma dessas contas pode depender de React ou
// do supabase para ser conferida.
//
// A tela inteira sai de UMA carga (`fin_cubo`, migration 248): 4,4 mil linhas
// agregadas cobrem 2023→2032. Trocar período, dimensão ou filtro é recálculo
// local, não requisição.

import { macroPorCategoria, type CategoriaGrupoLike } from './finance-categorias'

export interface CuboRow {
  mes: string             // 'YYYY-MM-DD' — mês de CAIXA
  mes_comp: string | null // 'YYYY-MM-DD' — mês de competência
  tipo: string            // 'receita' | 'despesa'
  situacao: string        // 'realizado' | 'previsto'
  categoria: string
  centro_custo: string
  contato: string
  conta: string
  valor: number | string
  qtd: number
}

export type Base = 'caixa' | 'competencia'
export type TipoFiltro = 'despesa' | 'receita' | 'ambos'
export type Dim = 'macro' | 'categoria' | 'contato' | 'centro_custo' | 'conta' | 'mes' | 'ano' | 'nenhum'

export const DIMENSOES: { value: Dim; label: string }[] = [
  { value: 'categoria',    label: 'Categoria' },
  { value: 'macro',        label: 'Grupo de categoria' },
  { value: 'contato',      label: 'Fornecedor / cliente' },
  { value: 'centro_custo', label: 'Centro de custo' },
  { value: 'conta',        label: 'Conta' },
  { value: 'mes',          label: 'Mês' },
  { value: 'ano',          label: 'Ano' },
]
export const DIMENSOES_COLUNA: { value: Dim; label: string }[] = [
  { value: 'nenhum', label: 'Sem coluna (só o total)' },
  ...DIMENSOES,
]

export interface Filtros {
  base: Base
  de: string            // 'YYYY-MM' inclusive
  ate: string           // 'YYYY-MM' inclusive
  tipo: TipoFiltro
  situacoes: string[]   // subconjunto de ['realizado', 'previsto']
  categorias: string[]
  centros: string[]
  contatos: string[]
  contas: string[]
}

export const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Mês da linha na base escolhida ('YYYY-MM'). Competência sem valor cai no caixa. */
export function mesDe(r: CuboRow, base: Base): string {
  const d = base === 'competencia' ? (r.mes_comp ?? r.mes) : r.mes
  return d.slice(0, 7)
}

export const rotuloMes = (ym: string) => `${MESES_ABREV[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`

/** 'YYYY-MM' somando n meses (n negativo anda para trás). */
export function addMes(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export type Preset =
  | 'mes' | 'mes_anterior' | 'ultimos3' | 'ultimos6' | 'ultimos12'
  | 'ano' | 'ano_anterior' | 'tudo' | 'custom'

export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'mes',           label: 'Mês atual' },
  { value: 'mes_anterior',  label: 'Mês anterior' },
  { value: 'ultimos3',      label: 'Últimos 3 meses' },
  { value: 'ultimos6',      label: 'Últimos 6 meses' },
  { value: 'ultimos12',     label: 'Últimos 12 meses' },
  { value: 'ano',           label: 'Este ano' },
  { value: 'ano_anterior',  label: 'Ano passado' },
  { value: 'tudo',          label: 'Todo o período' },
  { value: 'custom',        label: 'Personalizado' },
]

/** Intervalo de meses de um preset. `limites` só é usado pelo 'tudo'. */
export function rangeDoPreset(
  p: Preset, hoje: Date, limites?: { min: string; max: string },
): { de: string; ate: string } {
  const ym = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
  const ano = ym.slice(0, 4)
  switch (p) {
    case 'mes':          return { de: ym, ate: ym }
    case 'mes_anterior': return { de: addMes(ym, -1), ate: addMes(ym, -1) }
    // Inclui o mês corrente: "últimos 3" com o mês de hoje de fora é uma leitura
    // que ninguém faz — a pergunta é sempre "e até agora?".
    case 'ultimos3':     return { de: addMes(ym, -2),  ate: ym }
    case 'ultimos6':     return { de: addMes(ym, -5),  ate: ym }
    case 'ultimos12':    return { de: addMes(ym, -11), ate: ym }
    case 'ano':          return { de: `${ano}-01`, ate: `${ano}-12` }
    case 'ano_anterior': {
      const a = String(Number(ano) - 1)
      return { de: `${a}-01`, ate: `${a}-12` }
    }
    case 'tudo':         return { de: limites?.min ?? `${ano}-01`, ate: limites?.max ?? `${ano}-12` }
    default:             return { de: ym, ate: ym }
  }
}

/** Menor e maior mês presentes no cubo, na base escolhida. */
export function limitesDoCubo(rows: CuboRow[], base: Base): { min: string; max: string } {
  if (rows.length === 0) {
    const a = new Date().getFullYear()
    return { min: `${a}-01`, max: `${a}-12` }
  }
  let min = '9999-12', max = '0000-01'
  for (const r of rows) {
    const m = mesDe(r, base)
    if (m < min) min = m
    if (m > max) max = m
  }
  return { min, max }
}

const inclui = (sel: string[], v: string) => sel.length === 0 || sel.includes(v)

/** Recorte de período + tipo + situação — o que define o UNIVERSO da tela. */
export function noEscopo(r: CuboRow, f: Filtros): boolean {
  const m = mesDe(r, f.base)
  if (m < f.de || m > f.ate) return false
  if (f.tipo !== 'ambos' && r.tipo !== f.tipo) return false
  return f.situacoes.includes(r.situacao)
}

/** Escopo + os multi-selects de dimensão. */
export function aplicaFiltros(rows: CuboRow[], f: Filtros): CuboRow[] {
  return rows.filter(r =>
    noEscopo(r, f) &&
    inclui(f.categorias, r.categoria) &&
    inclui(f.centros, r.centro_custo) &&
    inclui(f.contatos, r.contato) &&
    inclui(f.contas, r.conta))
}

/**
 * Opções dos multi-selects. Derivadas só do ESCOPO (período/tipo/situação), não
 * dos outros multi-selects: filtrar as opções pelo que já está filtrado tranca a
 * pessoa na primeira escolha — não dá para acrescentar um segundo fornecedor.
 * Ordenadas por peso em R$, que é a ordem em que se procura num painel de custo.
 */
export function opcoesDeFiltro(rows: CuboRow[], f: Filtros) {
  const acc = {
    categorias: new Map<string, number>(),
    centros: new Map<string, number>(),
    contatos: new Map<string, number>(),
    contas: new Map<string, number>(),
  }
  for (const r of rows) {
    if (!noEscopo(r, f)) continue
    const v = Number(r.valor ?? 0)
    acc.categorias.set(r.categoria, (acc.categorias.get(r.categoria) ?? 0) + v)
    acc.centros.set(r.centro_custo, (acc.centros.get(r.centro_custo) ?? 0) + v)
    acc.contatos.set(r.contato, (acc.contatos.get(r.contato) ?? 0) + v)
    acc.contas.set(r.conta, (acc.contas.get(r.conta) ?? 0) + v)
  }
  const opts = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([nome]) => ({ value: nome, label: nome }))
  return {
    categorias: opts(acc.categorias),
    centros: opts(acc.centros),
    contatos: opts(acc.contatos),
    contas: opts(acc.contas),
  }
}

export interface Celula { realizado: number; previsto: number; qtd: number }
export interface PivotLinha { key: string; label: string; cor?: string; celulas: Celula[]; total: Celula }
export interface Pivot {
  colunas: { key: string; label: string }[]
  linhas: PivotLinha[]
  totalColunas: Celula[]
  total: Celula
  /** Maior total de linha — escala das barras de proporção. */
  maxLinha: number
}

export const vazia = (): Celula => ({ realizado: 0, previsto: 0, qtd: 0 })
export const totalDe = (c: Celula) => c.realizado + c.previsto

function acumula(c: Celula, r: CuboRow) {
  const v = Number(r.valor ?? 0)
  if (r.situacao === 'previsto') c.previsto += v
  else c.realizado += v
  c.qtd += Number(r.qtd ?? 0)
}

interface Macros { receita: Map<string, string>; despesa: Map<string, string> }

/**
 * O mesmo nome de categoria existe nos dois lados ("Empréstimos de Bancos" é
 * filho de um grupo de receita E de um de despesa) — por isso o mapa é por
 * direção, e a linha escolhe pelo próprio tipo.
 */
export function macrosPorDirecao(categorias: CategoriaGrupoLike[]): Macros {
  return {
    receita: macroPorCategoria(categorias, 'entrada'),
    despesa: macroPorCategoria(categorias, 'saida'),
  }
}

export function chaveDim(r: CuboRow, dim: Dim, base: Base, macros: Macros): string {
  switch (dim) {
    case 'macro':        return (r.tipo === 'receita' ? macros.receita : macros.despesa)
      .get(r.categoria.toLowerCase()) ?? r.categoria
    case 'categoria':    return r.categoria
    case 'contato':      return r.contato
    case 'centro_custo': return r.centro_custo
    case 'conta':        return r.conta
    case 'mes':          return mesDe(r, base)
    case 'ano':          return mesDe(r, base).slice(0, 4)
    case 'nenhum':       return 'total'
  }
}

export const rotuloDim = (dim: Dim, key: string) =>
  dim === 'mes' ? rotuloMes(key) : dim === 'nenhum' ? 'Total' : key

/** Dimensão temporal ordena pelo tempo; o resto, pelo peso em R$. */
const temporal = (d: Dim) => d === 'mes' || d === 'ano'

export interface OpcoesPivot {
  linha: Dim
  coluna: Dim
  base: Base
  categorias: CategoriaGrupoLike[]
  cores?: Map<string, string>
  /** Ordena as linhas por esta coluna (índice) em vez de pelo total. */
  ordenarPor?: number | null
  /** Teto de colunas visíveis; o excedente vira uma coluna "Outros". */
  maxColunas?: number
}

/** Soma `b` dentro de `a` (mesma célula acumulada de outra célula). */
function somaCelula(a: Celula, b: Celula) {
  a.realizado += b.realizado
  a.previsto += b.previsto
  a.qtd += b.qtd
}

export function pivot(rows: CuboRow[], o: OpcoesPivot): Pivot {
  const macros = macrosPorDirecao(o.categorias)
  const colTotal = new Map<string, Celula>()
  const linTotal = new Map<string, Celula>()
  // Mapa aninhado, não chave concatenada: nome de categoria e de fornecedor têm
  // espaço, hífen e barra — qualquer separador de texto colidiria em silêncio.
  const grade = new Map<string, Map<string, Celula>>()

  for (const r of rows) {
    const kl = chaveDim(r, o.linha, o.base, macros)
    const kc = chaveDim(r, o.coluna, o.base, macros)
    if (!colTotal.has(kc)) colTotal.set(kc, vazia())
    if (!linTotal.has(kl)) linTotal.set(kl, vazia())
    let linha = grade.get(kl)
    if (!linha) { linha = new Map(); grade.set(kl, linha) }
    let cel = linha.get(kc)
    if (!cel) { cel = vazia(); linha.set(kc, cel) }
    acumula(colTotal.get(kc)!, r)
    acumula(linTotal.get(kl)!, r)
    acumula(cel, r)
  }

  const ordenaChaves = (m: Map<string, Celula>, dim: Dim) =>
    [...m.entries()]
      .sort((a, b) => temporal(dim) ? a[0].localeCompare(b[0]) : totalDe(b[1]) - totalDe(a[1]))
      .map(([k]) => k)

  // Cruzar por fornecedor daria 237 colunas — ilegível e lento. O excedente vira
  // uma coluna "Outros" SOMADA, nunca descartada: coluna que some sem entrar em
  // lugar nenhum faz a linha não fechar com o total, e aí a tabela mente.
  const todasCols = ordenaChaves(colTotal, o.coluna)
  const teto = o.maxColunas ?? 0
  const cortar = teto > 0 && !temporal(o.coluna) && todasCols.length > teto
  const colKeys = cortar ? todasCols.slice(0, teto - 1) : todasCols
  const sobra = cortar ? todasCols.slice(teto - 1) : []
  const colunas = colKeys.map(k => ({ key: k, label: rotuloDim(o.coluna, k) }))
  if (sobra.length) colunas.push({ key: '__outros__', label: `Outros (${sobra.length})` })

  const linhas: PivotLinha[] = ordenaChaves(linTotal, o.linha).map(kl => {
    const celulas = colKeys.map(kc => grade.get(kl)?.get(kc) ?? vazia())
    if (sobra.length) {
      const outros = vazia()
      for (const kc of sobra) {
        const c = grade.get(kl)?.get(kc)
        if (c) somaCelula(outros, c)
      }
      celulas.push(outros)
    }
    return {
      key: kl,
      label: rotuloDim(o.linha, kl),
      cor: o.cores?.get(kl.toLowerCase()),
      celulas,
      total: linTotal.get(kl)!,
    }
  })

  const ord = o.ordenarPor
  if (ord != null && ord >= 0 && ord < colKeys.length) {
    linhas.sort((a, b) => totalDe(b.celulas[ord]) - totalDe(a.celulas[ord]))
  }

  const total = vazia()
  for (const c of colTotal.values()) {
    total.realizado += c.realizado
    total.previsto += c.previsto
    total.qtd += c.qtd
  }

  const totalColunas = colKeys.map(k => colTotal.get(k)!)
  if (sobra.length) {
    const outros = vazia()
    for (const kc of sobra) somaCelula(outros, colTotal.get(kc)!)
    totalColunas.push(outros)
  }

  return {
    colunas,
    linhas,
    totalColunas,
    total,
    maxLinha: Math.max(1, ...linhas.map(l => totalDe(l.total))),
  }
}

/** O que a célula clicada representa — vira o filtro do drilldown. */
export interface Drill {
  linhaDim: Dim
  linhaKey: string
  colunaDim: Dim | null
  colunaKey: string | null
}

/** 'YYYY-MM' → 'YYYY-MM-DD' do último dia (sem conversão de fuso). */
export function fimDoMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${ym}-${String(ultimo).padStart(2, '0')}`
}

/**
 * Categorias que compõem um macro-grupo, olhando o que EXISTE nas linhas — e não
 * o cadastro: categoria renomeada ou vinda do extrato antigo não está mais no
 * grupo, e o drilldown por macro precisa achar o lançamento assim mesmo.
 */
export function categoriasDoMacro(
  rows: CuboRow[], macro: string, base: Base, categorias: CategoriaGrupoLike[],
): string[] {
  const macros = macrosPorDirecao(categorias)
  const out = new Set<string>()
  for (const r of rows) if (chaveDim(r, 'macro', base, macros) === macro) out.add(r.categoria)
  return [...out]
}
