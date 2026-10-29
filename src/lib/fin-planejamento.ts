// Planejamento financeiro (financeiro/planejamento) — módulo PURO, como o fin-cubo:
// a tela projeta tudo em memória a partir da MESMA carga da Análise (`fin_cubo`).
//
// Pedido do Rafael (29/10/2026, hiring freeze, caixa baixo, cliente inadimplente):
// "real de custos × receitas por categoria, e projeção dos próximos meses — não sei
// o quão confiável é o meu dado". Por isso cada número projetado diz DE ONDE veio:
//   • lançado   — existe lançamento em aberto com esse vencimento;
//   • estimado  — categoria recorrente com menos de 80% da mediana dos 6 últimos
//                 meses fechados lançada: completa até a mediana. Na receita só a
//                 parte AVULSA (comissão, job) — quem tem contrato lançado à frente
//                 fica de fora, senão completar desfaria o fim do contrato;
//   • premissa  — o que o Rafael decidiu na tela (valor fixo, contrato que renova,
//                 inadimplente que paga parcelado, entrada/saída extraordinária).
// O cenário mora no navegador (por usuário) e NUNCA altera lançamento.

import { addMes, type CuboRow } from './fin-cubo'

export type Tipo = 'receita' | 'despesa'
export type ModoCategoria = 'auto' | 'lancado' | 'zero' | 'valor'

export interface AjusteCategoria { modo: ModoCategoria; valor?: number }
/** Inadimplente que entra na conta: total dividido em `parcelas` a partir de `inicio`. */
export interface AjusteInadimplente { parcelas: number; inicio: string }
/** Contrato que termina no horizonte: renova com o último valor mensal (ou `valor`). */
export interface AjusteContrato { valor?: number }
export interface Extra {
  id: string; descricao: string; tipo: Tipo; valor: number; mes: string; parcelas: number
}

export interface Cenario {
  categorias: Record<string, AjusteCategoria>   // chave: `${tipo}|${categoria}`
  inadimplentes: Record<string, AjusteInadimplente> // chave: contato
  contratos: Record<string, AjusteContrato>     // chave: contato (presente = renova)
  extras: Extra[]
}
export const CENARIO_VAZIO: Cenario = { categorias: {}, inadimplentes: {}, contratos: {}, extras: [] }

export interface Celula { total: number; lancado: number; estimado: number; premissa: number }
const vazia = (): Celula => ({ total: 0, lancado: 0, estimado: 0, premissa: 0 })

export interface LinhaCategoria {
  key: string; tipo: Tipo; categoria: string; macro: string
  mediana: number; recorrente: boolean
  ajuste: AjusteCategoria | null
  /** Por coluna (passados = realizado; atual e futuros = projeção). */
  celulas: Celula[]
}
export interface LinhaPremissa { key: string; tipo: Tipo; label: string; celulas: Celula[] }

export interface Inadimplente { contato: string; categoria: string; total: number; desde: string }
export interface Contrato { contato: string; categoria: string; mensal: number; ultimo: string }
/** Cliente que pagou quase todo mês e não tem nada lançado à frente. */
export interface SemLancamento { contato: string; categoria: string; mediana: number; ultimo: string }

export interface Alerta {
  key: string; tipo: Tipo; categoria: string
  motivo: 'estimado' | 'acima' | 'novo'
  /** R$/mês nos meses futuros (estimativa somada, ou excesso sobre a mediana). */
  valor: number; mediana: number; lancado: number
}

export interface Projecao {
  passados: string[]; atual: string; futuros: string[]
  /** passados + atual + futuros, na ordem das colunas. */
  colunas: string[]
  categorias: LinhaCategoria[]
  premissas: LinhaPremissa[]
  receitas: Celula[]; despesas: Celula[]
  resultado: number[]
  /** Saldo no FIM de cada coluna a partir do atual (passados = null). */
  saldo: (number | null)[]
  inadimplentes: Inadimplente[]
  contratos: Contrato[]
  semLancamento: SemLancamento[]
  alertas: Alerta[]
  /** Parte da projeção futura que já é lançamento (0–1). */
  confiabilidade: { receita: number; despesa: number }
  primeiroNegativo: string | null
  menorSaldo: { mes: string; valor: number } | null
}

const num = (v: number | string) => Number(v) || 0
const mediana = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const soma = (a: Celula, b: Celula) => {
  a.total += b.total; a.lancado += b.lancado; a.estimado += b.estimado; a.premissa += b.premissa
}

/** Meses fechados que formam a "régua" de cada categoria. */
export const MESES_HISTORICO = 6
/** Recorrente = apareceu em pelo menos 4 dos 6 últimos meses fechados. */
const MIN_RECORRENTE = 4
/** Colunas de realizado mostradas antes do mês atual (referência visual). */
export const PASSADOS_VISIVEIS = 3

export function chaveCategoria(tipo: Tipo, categoria: string) { return `${tipo}|${categoria}` }

export function projetar(rows: CuboRow[], opts: {
  hoje: string; horizonte: number; saldoInicial: number; cenario: Cenario
  macroDe: (tipo: Tipo, categoria: string) => string
}): Projecao {
  const { hoje, horizonte, saldoInicial, cenario } = opts
  const historico = Array.from({ length: MESES_HISTORICO }, (_, i) => addMes(hoje, i - MESES_HISTORICO))
  const passados = historico.slice(-PASSADOS_VISIVEIS)
  const futuros = Array.from({ length: horizonte }, (_, i) => addMes(hoje, i + 1))
  const colunas = [...passados, hoje, ...futuros]
  const fim = futuros[futuros.length - 1] ?? hoje
  const iAtual = passados.length

  // ── Agrega o cubo por (tipo, categoria) e por contato (receita) ─────────
  interface Acc {
    real: Map<string, number>; prev: Map<string, number>; vencido: number
    /** Receita por contato (mês → valor), para separar contrato de avulso. */
    realPorContato: Map<string, Map<string, number>>; prevPorContato: Map<string, Map<string, number>>
  }
  const porCat = new Map<string, Acc & { tipo: Tipo; categoria: string }>()
  const inad = new Map<string, Inadimplente>()
  const contatoPrev = new Map<string, { categoria: string; meses: Map<string, number> }>()
  const contatoReal = new Map<string, Set<string>>()

  for (const r of rows) {
    const tipo = r.tipo as Tipo
    if (tipo !== 'receita' && tipo !== 'despesa') continue
    const mes = r.mes.slice(0, 7)
    const v = num(r.valor)
    const key = chaveCategoria(tipo, r.categoria)
    let a = porCat.get(key)
    if (!a) { a = { tipo, categoria: r.categoria, real: new Map(), prev: new Map(), vencido: 0, realPorContato: new Map(), prevPorContato: new Map() }; porCat.set(key, a) }

    if (r.situacao === 'realizado') {
      a.real.set(mes, (a.real.get(mes) ?? 0) + v)
      if (tipo === 'receita' && historico.includes(mes)) {
        const s = contatoReal.get(r.contato) ?? new Set<string>()
        s.add(mes); contatoReal.set(r.contato, s)
        addPorContato(a.realPorContato, r.contato, mes, v)
      }
      continue
    }
    // Previsto com vencimento em mês já fechado: receita = inadimplência (fica
    // FORA da conta até o Rafael dizer como entra); despesa = conta atrasada, que
    // ainda vai ter que sair — entra no mês atual.
    if (mes < hoje) {
      if (tipo === 'despesa') { a.vencido += v; continue }
      const i = inad.get(r.contato) ?? { contato: r.contato, categoria: r.categoria, total: 0, desde: mes }
      i.total += v; if (mes < i.desde) i.desde = mes
      inad.set(r.contato, i)
      continue
    }
    if (mes > fim) {
      // Além do horizonte só interessa para saber se o contrato continua.
      if (tipo === 'receita') marcaContrato(r.contato, r.categoria, mes, v)
      continue
    }
    a.prev.set(mes, (a.prev.get(mes) ?? 0) + v)
    if (tipo === 'receita') addPorContato(a.prevPorContato, r.contato, mes, v)
    if (tipo === 'receita' && mes > hoje) marcaContrato(r.contato, r.categoria, mes, v)
  }

  function addPorContato(m: Map<string, Map<string, number>>, contato: string, mes: string, v: number) {
    const x = m.get(contato) ?? new Map<string, number>()
    x.set(mes, (x.get(mes) ?? 0) + v)
    m.set(contato, x)
  }

  function marcaContrato(contato: string, categoria: string, mes: string, v: number) {
    const c = contatoPrev.get(contato) ?? { categoria, meses: new Map<string, number>() }
    c.meses.set(mes, (c.meses.get(mes) ?? 0) + v)
    contatoPrev.set(contato, c)
  }

  // Contratual = cliente com receita lançada em 2+ meses à frente (fee, job
  // parcelado) ou com parcela vencida em aberto: o futuro dele é o que está
  // lançado (ou a premissa de renovação), não a média.
  const comContrato = [...contatoPrev].filter(([, c]) => c.meses.size >= 2)
  const contratuais = new Set<string>([...comContrato.map(([k]) => k), ...inad.keys()])
  // Nas categorias que se vendem por contrato (fee, job), cliente que pagou 4+ dos
  // 6 meses também é contratual mesmo sem nada lançado: ou o contrato acabou ou
  // falta lançar — pergunta para o Rafael (`semLancamento`), não volume avulso.
  // Comissão não entra: o veículo paga todo mês sem contrato com a agência.
  const catsContrato = new Set(comContrato.map(([, c]) => c.categoria))
  const pagouSempre = (contato: string) => (contatoReal.get(contato)?.size ?? 0) >= MIN_RECORRENTE
  const ehContratual = (contato: string, categoria: string) =>
    contratuais.has(contato) || (catsContrato.has(categoria) && pagouSempre(contato))
  const somaAvulso = (pc: Map<string, Map<string, number>>, categoria: string, mes: string) =>
    [...pc].reduce((s, [contato, x]) => s + (ehContratual(contato, categoria) ? 0 : x.get(mes) ?? 0), 0)

  const semLancamento: SemLancamento[] = []
  for (const [, a] of porCat) {
    if (a.tipo !== 'receita' || !catsContrato.has(a.categoria)) continue
    for (const [contato, x] of a.realPorContato) {
      if (contratuais.has(contato) || !pagouSempre(contato)) continue
      semLancamento.push({ contato, categoria: a.categoria, mediana: mediana(historico.map(m => x.get(m) ?? 0)), ultimo: [...x.keys()].sort().pop() ?? '' })
    }
  }
  semLancamento.sort((a, b) => b.mediana - a.mediana)

  // ── Linhas por categoria ────────────────────────────────────────────────
  const categorias: LinhaCategoria[] = []
  for (const [key, a] of porCat) {
    const receita = a.tipo === 'receita'
    const hist = historico.map(m => a.real.get(m) ?? 0)
    const recorrente = hist.filter(v => v > 0).length >= MIN_RECORRENTE
    const med = recorrente ? mediana(hist) : 0
    // Régua da estimativa: despesa = a categoria toda; receita = só a parte avulsa.
    const histEst = receita ? historico.map(m => somaAvulso(a.realPorContato, a.categoria, m)) : hist
    const medEst = histEst.filter(v => v > 0).length >= MIN_RECORRENTE ? mediana(histEst) : 0
    const ajuste = cenario.categorias[key] ?? null
    const modo = ajuste?.modo ?? 'auto'

    const celulas = colunas.map((m, i): Celula => {
      const c = vazia()
      if (i < iAtual) { c.total = c.lancado = a.real.get(m) ?? 0; return c }
      const L = (a.prev.get(m) ?? 0) + (i === iAtual ? a.vencido : 0)
      if (modo === 'zero') return c
      if (i === iAtual || modo === 'lancado') { c.total = c.lancado = L; return c }
      if (modo === 'valor') { c.total = c.premissa = Math.max(0, ajuste?.valor ?? 0); return c }
      c.lancado = L
      // Lançado em 80%+ da mediana é o dado mais novo (folha no freeze, por ex.):
      // completar a diferença seria ruído, não prudência.
      const base = receita ? somaAvulso(a.prevPorContato, a.categoria, m) : L
      c.estimado = medEst > 0 && base < medEst * 0.8 ? medEst - base : 0
      c.total = c.lancado + c.estimado
      return c
    })
    const relevante = celulas.some(c => c.total > 0.5) || med > 0
    if (!relevante) continue
    categorias.push({
      key, tipo: a.tipo, categoria: a.categoria, macro: opts.macroDe(a.tipo, a.categoria),
      mediana: med, recorrente, ajuste, celulas,
    })
  }

  // ── Premissas: inadimplentes, contratos que renovam, extraordinários ────
  const premissas: LinhaPremissa[] = []
  const linhaPremissa = (key: string, tipo: Tipo, label: string, porMes: Map<string, number>) => {
    const celulas = colunas.map((m, i) => {
      const c = vazia()
      if (i < iAtual) return c
      c.total = c.premissa = porMes.get(m) ?? 0
      return c
    })
    if (celulas.some(c => c.total > 0)) premissas.push({ key, tipo, label, celulas })
  }

  const inadimplentes = [...inad.values()].filter(i => i.total > 0.5).sort((a, b) => b.total - a.total)
  {
    const porMes = new Map<string, number>()
    for (const i of inadimplentes) {
      const aj = cenario.inadimplentes[i.contato]
      if (!aj) continue
      const n = Math.max(1, Math.floor(aj.parcelas))
      for (let k = 0; k < n; k++) {
        const m = addMes(aj.inicio, k)
        porMes.set(m, (porMes.get(m) ?? 0) + i.total / n)
      }
    }
    linhaPremissa('inadimplentes', 'receita', 'Inadimplentes que voltam a pagar', porMes)
  }

  // Contrato = receita lançada à frente que para ANTES do fim do horizonte e que
  // é recorrente (3+ meses entre o realizado recente e o lançado). Valor de
  // renovação = a última parcela lançada.
  const contratos: Contrato[] = []
  for (const [contato, c] of contatoPrev) {
    const meses = [...c.meses.keys()].sort()
    const ultimo = meses[meses.length - 1]
    if (!ultimo || ultimo >= fim || meses.length < 2) continue
    if (meses.length + (contatoReal.get(contato)?.size ?? 0) < 3 || (c.meses.get(ultimo) ?? 0) < 1000) continue
    contratos.push({ contato, categoria: c.categoria, mensal: c.meses.get(ultimo) ?? 0, ultimo })
  }
  contratos.sort((a, b) => a.ultimo.localeCompare(b.ultimo) || b.mensal - a.mensal)
  {
    const porMes = new Map<string, number>()
    for (const c of contratos) {
      const aj = cenario.contratos[c.contato]
      if (!aj) continue
      const v = aj.valor ?? c.mensal
      for (let m = addMes(c.ultimo, 1); m <= fim; m = addMes(m, 1)) porMes.set(m, (porMes.get(m) ?? 0) + v)
    }
    linhaPremissa('contratos', 'receita', 'Contratos renovados', porMes)
  }

  for (const e of cenario.extras) {
    const porMes = new Map<string, number>()
    const n = Math.max(1, Math.floor(e.parcelas))
    for (let k = 0; k < n; k++) {
      const m = addMes(e.mes, k)
      porMes.set(m, (porMes.get(m) ?? 0) + e.valor / n)
    }
    linhaPremissa(`extra:${e.id}`, e.tipo, e.descricao || (e.tipo === 'receita' ? 'Entrada extraordinária' : 'Saída extraordinária'), porMes)
  }

  // ── Totais, saldo e confiabilidade ──────────────────────────────────────
  const receitas = colunas.map(vazia), despesas = colunas.map(vazia)
  for (const l of [...categorias, ...premissas]) {
    const alvo = l.tipo === 'receita' ? receitas : despesas
    l.celulas.forEach((c, i) => soma(alvo[i], c))
  }
  const resultado = colunas.map((_, i) => receitas[i].total - despesas[i].total)
  const saldo: (number | null)[] = []
  let acc = saldoInicial
  let primeiroNegativo: string | null = null
  let menorSaldo: Projecao['menorSaldo'] = null
  colunas.forEach((m, i) => {
    if (i < iAtual) { saldo.push(null); return }
    // O saldo de hoje já contém o que foi realizado no mês: do atual só soma o que falta.
    acc += resultado[i]
    saldo.push(acc)
    if (acc < 0 && !primeiroNegativo) primeiroNegativo = m
    if (!menorSaldo || acc < menorSaldo.valor) menorSaldo = { mes: m, valor: acc }
  })

  const parte = (cs: Celula[]) => {
    const fut = cs.slice(iAtual + 1)
    const tot = fut.reduce((s, c) => s + c.total, 0)
    return tot > 0 ? fut.reduce((s, c) => s + c.lancado, 0) / tot : 1
  }

  // ── O que a projeção está supondo (painel de confiabilidade) ────────────
  const alertas: Alerta[] = []
  const nFut = Math.max(1, futuros.length)
  for (const l of categorias) {
    if (l.ajuste && l.ajuste.modo !== 'auto') continue
    const fut = l.celulas.slice(iAtual + 1)
    const est = fut.reduce((s, c) => s + c.estimado, 0) / nFut
    const lan = fut.reduce((s, c) => s + c.lancado, 0) / nFut
    if (est >= 100) {
      alertas.push({ key: l.key, tipo: l.tipo, categoria: l.categoria, motivo: 'estimado', valor: est, mediana: l.mediana, lancado: lan })
    } else if (l.tipo === 'despesa' && l.mediana === 0 && lan >= 500) {
      alertas.push({ key: l.key, tipo: l.tipo, categoria: l.categoria, motivo: 'novo', valor: lan, mediana: 0, lancado: lan })
    } else if (l.tipo === 'despesa' && l.mediana > 0 && lan - l.mediana >= 1000 && lan > l.mediana * 1.3) {
      alertas.push({ key: l.key, tipo: l.tipo, categoria: l.categoria, motivo: 'acima', valor: lan - l.mediana, mediana: l.mediana, lancado: lan })
    }
  }
  alertas.sort((a, b) => b.valor - a.valor)

  return {
    passados, atual: hoje, futuros, colunas, categorias, premissas, receitas, despesas, resultado, saldo,
    inadimplentes, contratos, semLancamento, alertas,
    confiabilidade: { receita: parte(receitas), despesa: parte(despesas) },
    primeiroNegativo, menorSaldo,
  }
}
