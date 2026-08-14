// Receita e despesa por CATEGORIA dentro do mês de COMPETÊNCIA (RPC
// `fin_categorias_competencia`, migration 232). Tudo puro — recebe as somas
// vindas do banco e devolve as séries que o gráfico e a tabela consomem.
//
// Competência ≠ caixa: aqui o gasto pesa no mês a que se refere, mesmo que o
// dinheiro tenha saído antes ou vá sair depois. Por isso realizado e previsto
// entram nos MESMOS meses — o mês corrente é sempre parte realizado, parte a
// realizar, e ler só um dos dois faria o mês parecer barato.

import { macroPorCategoria, coresPorNome, type CategoriaGrupoLike } from './finance-categorias'

export interface CatCompRow {
  mes: string | null          // 'YYYY-MM-DD' (1º dia do mês de competência)
  tipo: string | null         // 'receita' | 'despesa'
  situacao: string | null     // 'realizado' | 'previsto'
  categoria: string | null
  /** Só na visão Hiper (RPC `fin_categorias_contato`, migration 233). */
  contato?: string | null
  valor: number | string | null
}

/** O que entra na conta: tudo, só o que já aconteceu, ou só o que falta acontecer. */
export type Foco = 'tudo' | 'realizado' | 'previsto'
/**
 * Nível de agrupamento:
 * · `macro`   — o grupo da DRE ("Impostos e Taxas")
 * · `detalhe` — a categoria vinculada ao lançamento ("Simples Nacional - DAS")
 * · `hiper`   — a categoria + o fornecedor/cliente ("Software / Licença de Uso · Google"),
 *               que responde "subiu por causa de quem". Exige as linhas da RPC
 *               `fin_categorias_contato`, carregadas sob demanda.
 */
export type Visao = 'macro' | 'detalhe' | 'hiper'

export const MESES_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Acima disso o gráfico vira sopa: o resto some em "Outros" (em produção há mês com 30 categorias de despesa).
 *  Na Hiper cabe mais linha: cada fatia é mais fina e o ponto do modo é justamente a cauda. */
export const TOP_CATEGORIAS = 8
export const TOP_HIPER = 12
/** Rótulo do bucket do resto. Leva a contagem porque o cadastro TEM uma categoria
 *  chamada "Outros" — duas linhas com o mesmo nome no gráfico não se distinguem. */
export const outrosLabel = (n: number) => `Outros (${n})`

const num = (v: number | string | null) => Math.abs(Number(v ?? 0))

export function anosDisponiveis(rows: CatCompRow[]): number[] {
  const set = new Set<number>()
  for (const r of rows) if (r.mes) set.add(Number(r.mes.slice(0, 4)))
  return [...set].sort((a, b) => a - b)
}

export interface FatiaCat {
  /** 'c0', 'c1'… — a dataKey da série no gráfico. Nome de categoria não serve:
   *  o recharts lê ponto como caminho ("Serv. Terceiros" viraria d["Serv"]["Terceiros"]). */
  key: string
  nome: string
  /** total do ano — define ordem e top-N, não muda quando um mês entra em foco. */
  totalAno: number
  total: number
  realizado: number
  previsto: number
  /** % do total do recorte (0–100). */
  pct: number
  /** valor por mês do ano, índice 0 = janeiro. */
  porMes: number[]
  /** é o bucket "Outros (N)", não uma categoria de verdade. */
  resto?: boolean
}

export interface PontoMes {
  /** 'jan' — rótulo do eixo. */
  mes: string
  /** 0–11, para casar com o mês corrente. */
  mi: number
  total: number
  realizado: number
  previsto: number
  /** 'c0', 'c1'… — uma por categoria visível (as séries empilhadas do gráfico). */
  [serie: string]: number | string
}

export interface SerieCategorias {
  pontos: PontoMes[]
  categorias: FatiaCat[]
  /** Desligadas na legenda: ficam fora de tudo (total, %, gráfico e tabela) e
   *  voltam como chip apagado para poder religar. */
  ocultas: { nome: string; totalAno: number }[]
  total: number
  totalRealizado: number
  totalPrevisto: number
}

/**
 * Série de um ano: 12 pontos (um por mês de competência) empilhados por
 * categoria, mais o consolidado por categoria com o percentual de cada uma.
 * `mesFoco` (0–11) restringe o consolidado a um mês — o gráfico continua
 * mostrando o ano inteiro.
 */
export function serieCategorias(
  rows: CatCompRow[],
  opts: {
    ano: number
    tipo: 'receita' | 'despesa'
    visao: Visao
    foco: Foco
    categorias: CategoriaGrupoLike[]
    mesFoco?: number | null
    /** Nomes desligados na legenda — saem da conta ANTES do top-N, então o
     *  percentual passa a ser sobre o que sobrou (é esse o ponto de desligar). */
    ocultas?: string[]
  },
): SerieCategorias {
  const { ano, tipo, visao, foco, categorias, mesFoco = null } = opts
  const ocultasSet = new Set(opts.ocultas ?? [])
  const macro = macroPorCategoria(categorias, tipo === 'receita' ? 'entrada' : 'saida')

  // categoria → [realizado[12], previsto[12]]
  const acc = new Map<string, { real: number[]; prev: number[] }>()
  const zeros = () => ({ real: new Array(12).fill(0), prev: new Array(12).fill(0) })

  for (const r of rows) {
    if (!r.mes || r.tipo !== tipo) continue
    if (Number(r.mes.slice(0, 4)) !== ano) continue
    const previsto = r.situacao === 'previsto'
    if (foco === 'realizado' && previsto) continue
    if (foco === 'previsto' && !previsto) continue
    const mi = Number(r.mes.slice(5, 7)) - 1
    if (mi < 0 || mi > 11) continue
    const crua = r.categoria || '(sem categoria)'
    const nome = visao === 'macro'
      ? (macro.get(crua.toLowerCase()) || crua)
      : visao === 'hiper'
        ? `${crua} · ${r.contato || '(sem fornecedor)'}`
        : crua
    let e = acc.get(nome)
    if (!e) { e = zeros(); acc.set(nome, e) }
    ;(previsto ? e.prev : e.real)[mi] += num(r.valor)
  }

  // A ordem e o top-N saem do ANO inteiro: focar um mês não pode reordenar as
  // faixas nem trocar as cores do gráfico (que segue mostrando o ano todo). Só os
  // valores e o percentual respondem ao foco.
  const somaAno = (arr: number[]) => arr.reduce((s, v) => s + v, 0)
  const somaFoco = (arr: number[]) => (mesFoco == null ? somaAno(arr) : arr[mesFoco])

  const todasComOcultas = [...acc.entries()]
    .map(([nome, e]) => ({
      key: '',
      nome,
      totalAno: somaAno(e.real) + somaAno(e.prev),
      realizado: somaFoco(e.real),
      previsto: somaFoco(e.prev),
      total: somaFoco(e.real) + somaFoco(e.prev),
      pct: 0,
      porMes: e.real.map((v, i) => v + e.prev[i]),
    }))
    .filter(f => f.totalAno > 0.005)
    .sort((a, b) => b.totalAno - a.totalAno)

  const todas = todasComOcultas.filter(f => !ocultasSet.has(f.nome))
  const ocultas = todasComOcultas
    .filter(f => ocultasSet.has(f.nome))
    .map(f => ({ nome: f.nome, totalAno: f.totalAno }))

  // Top N + "Outros" — inclusive no gráfico, para o empilhamento não virar sopa.
  const topN = visao === 'hiper' ? TOP_HIPER : TOP_CATEGORIAS
  const visiveis = todas.slice(0, topN)
  const resto = todas.slice(topN)
  const soma = (fs: typeof todas, campo: 'total' | 'realizado' | 'previsto' | 'totalAno') =>
    fs.reduce((s, f) => s + f[campo], 0)
  const fatias: FatiaCat[] = resto.length
    ? [...visiveis, {
        key: '',
        resto: true,
        nome: outrosLabel(resto.length),
        totalAno: soma(resto, 'totalAno'),
        total: soma(resto, 'total'),
        realizado: soma(resto, 'realizado'),
        previsto: soma(resto, 'previsto'),
        pct: 0,
        porMes: Array.from({ length: 12 }, (_, i) => resto.reduce((s, f) => s + f.porMes[i], 0)),
      }]
    : visiveis

  fatias.forEach((f, i) => { f.key = `c${i}` })
  const total = fatias.reduce((s, f) => s + f.total, 0)
  for (const f of fatias) f.pct = total > 0 ? (f.total / total) * 100 : 0

  const pontos: PontoMes[] = []
  for (let mi = 0; mi < 12; mi++) {
    const p: PontoMes = { mes: MESES_ABBR[mi], mi, total: 0, realizado: 0, previsto: 0 }
    for (const f of fatias) {
      const v = f.porMes[mi]
      if (v > 0.005) p[f.key] = v
      p.total += v
    }
    for (const [nome, e] of acc) {
      if (ocultasSet.has(nome)) continue
      p.realizado += e.real[mi]; p.previsto += e.prev[mi]
    }
    pontos.push(p)
  }

  return {
    pontos,
    categorias: fatias,
    ocultas,
    total,
    totalRealizado: fatias.reduce((s, f) => s + f.realizado, 0),
    totalPrevisto: fatias.reduce((s, f) => s + f.previsto, 0),
  }
}

/** Cor de cada categoria: a da config quando existe, senão uma cor estável por nome. */
export function coresDeFatias(fatias: FatiaCat[], categorias: CategoriaGrupoLike[]): Map<string, string> {
  const cfg = coresPorNome(categorias)
  const m = new Map<string, string>()
  for (const f of fatias) {
    m.set(f.key, f.resto ? '#cbd5e1' : (cfg.get(f.nome.toLowerCase()) ?? PALETA[hash(f.nome) % PALETA.length]))
  }
  return m
}

export const PALETA = ['#f97316', '#22c55e', '#3b82f6', '#0ea5e9', '#ec4899', '#eab308', '#14b8a6', '#ef4444', '#a3a3a3', '#06b6d4']

// Hash estável nome→índice: a cor não pisca entre renders nem muda de mês pra mês.
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
