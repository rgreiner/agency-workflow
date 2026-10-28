/**
 * Histórico de cotações e compras (mig. 389) — para o orçamento:
 *  • sugerir fornecedor pesando quem responde, quem é escolhido e quem tem o melhor preço;
 *  • projetar o custo de um item a partir de itens PARECIDOS já cotados ou comprados.
 *
 * Semelhança = palavras do nome (peso 2) e da descrição (peso 1) em comum, sem acento,
 * sem plural e sem palavra curta. Simples de propósito: dá para explicar na tela por
 * que um item foi considerado parecido.
 */

export interface PrecoHistorico {
  producao_id: string; documento: string | null; situacao: string; data: string
  /** Pedido: de qual orçamento saiu (mig. 390). Tipo do fornecedor, para calibrar por tipo. */
  origem_orcamento_id?: string | null; tipo?: string | null
  /** Pedido gerado de orçamento (mig. 391): projeção congelada no dia, opção orçada e margem (comissão + honorários). */
  projecao?: { unit: number; n: number; em: string; fator?: number | null } | null
  orcado_unit?: number | null; margem_pct?: number | null
  nome: string; descricao: string; fornecedor_id: string; fornecedor: string
  quant: number; unit: number; escolhido: boolean; mais_barato: boolean
}
export interface FornecedorHistorico { fornecedor_id: string; convidados: number; responderam: number; horas_resposta: number | null; pedidos: number }
export interface HistoricoCotacao { precos: PrecoHistorico[]; fornecedores: FornecedorHistorico[] }

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
const VAZIAS = new Set(['para', 'com', 'sem', 'dos', 'das', 'nos', 'nas', 'por', 'cor', 'tam', 'tamanho', 'cores', 'personalizado', 'personalizada', 'personalizados', 'personalizadas',
  'impressao', 'unidade', 'unidades', 'modelo', 'tipo', 'acabamento', 'frete', 'incluso', 'regiao', 'cascavel', 'conforme', 'arte', 'entrega', 'remessa', 'segunda', 'primeira', 'nova', 'novo', 'evento', 'logo'])

/** Palavras que dizem o QUE é ("canecas de porcelana" → caneca, porcelana). */
export function palavras(s: string): string[] {
  return [...new Set(norm(s ?? '').split(/[^a-z0-9]+/)
    // Só palavra de letras (medida como "4x1,20" não diz o que é); 3 letras valem (ACM, MDF, PVC).
    .filter(w => w.length >= 3 && /^[a-z]+$/.test(w) && !VAZIAS.has(w))
    .map(w => w.replace(/(oes|aes)$/, 'ao').replace(/s$/, '')))]
}

/** 0–1: quanto o item do histórico se parece com o item do orçamento. */
export function semelhanca(nomeA: string, descA: string, nomeB: string, descB: string): number {
  const na = palavras(nomeA), nb = new Set(palavras(nomeB))
  if (!na.length || !nb.size) return 0
  const comumNome = na.filter(w => nb.has(w)).length
  if (!comumNome) return 0   // nome sem nada em comum não é parecido, por mais que a descrição bata
  const da = palavras(descA), db = new Set(palavras(descB))
  const comumDesc = da.filter(w => db.has(w)).length
  // Pesa mais o quanto do item PEDIDO aparece no histórico: "Placas ACM" está inteiro em
  // "Placas ACM Adesivada 4x1,20 parafusado no tapume", mesmo com o nome de lá sendo longo.
  const nomeScore = 0.7 * comumNome / na.length + 0.3 * comumNome / nb.size
  const descScore = da.length && db.size ? 0.7 * comumDesc / da.length + 0.3 * comumDesc / db.size : 0
  return Math.min(1, (2 * nomeScore + descScore) / (da.length && db.size ? 3 : 2))
}

export interface Parecido extends PrecoHistorico { score: number }

/** Itens parecidos do histórico (fora o próprio orçamento), do mais parecido ao menos. */
export function parecidos(h: HistoricoCotacao | null | undefined, nome: string, descricao: string, excluirProducao?: string, minimo = 0.34): Parecido[] {
  if (!h || !nome.trim()) return []
  return h.precos
    .filter(p => p.producao_id !== excluirProducao)
    .map(p => ({ ...p, score: semelhanca(nome, descricao, p.nome, p.descricao) }))
    .filter(p => p.score >= minimo)
    .sort((a, b) => b.score - a.score || (b.escolhido ? 1 : 0) - (a.escolhido ? 1 : 0) || b.data.localeCompare(a.data))
}

const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Projeção do custo unitário para a quantidade pedida: usa as referências de
 * quantidade mais próxima (escala de preço muda com o volume) e prefere o que foi
 * ESCOLHIDO ou COMPRADO — preço de opção recusada pesa menos.
 */
export function projetar(refs: Parecido[], quant: number): { unit: number; min: number; max: number; n: number; quantRef: number } | null {
  const q = quant > 0 ? quant : 1
  const dist = (r: Parecido) => Math.abs(Math.log(r.quant) - Math.log(q))
  // Quantidade 10x maior ou menor é outro produto na prática (unidade × metro, brinde × lote):
  // sem referência nessa faixa, não há projeção — melhor nada do que um número enganoso.
  refs = refs.filter(r => dist(r) <= Math.log(10))
  if (!refs.length) return null
  // Só os MAIS parecidos entram na conta (até 0,15 abaixo do melhor): "Catálogo 36x26" não
  // deve ter o preço puxado por "Folder catálogo capa dura" se há catálogo de verdade.
  const melhor = Math.max(...refs.map(r => r.score))
  refs = refs.filter(r => r.score >= melhor - 0.15)
  const perto = Math.min(...refs.map(dist))
  // Faixa de quantidade "equivalente": até 2x para mais ou para menos da mais próxima.
  const faixa = refs.filter(r => dist(r) <= perto + Math.log(2))
  const fortes = faixa.filter(r => r.escolhido)
  const base = (fortes.length >= 2 ? fortes : faixa).slice(0, 12)
  const us = base.map(r => r.unit)
  return { unit: mediana(us), min: Math.min(...us), max: Math.max(...us), n: base.length, quantRef: Math.round(mediana(base.map(r => r.quant))) }
}

/** Perfil do fornecedor para a sugestão: responde? é escolhido? tem o melhor preço nesses itens? */
export function perfil(h: HistoricoCotacao | null | undefined, fornecedorId: string, itens: { nome: string; descricao: string }[]) {
  const f = h?.fornecedores.find(x => x.fornecedor_id === fornecedorId)
  const dele = (h?.precos ?? []).filter(p => p.fornecedor_id === fornecedorId)
  const parecidosDele = dele.filter(p => itens.some(it => semelhanca(it.nome, it.descricao, p.nome, p.descricao) >= 0.34))
  return {
    convidados: f?.convidados ?? 0,
    responderam: f?.responderam ?? 0,
    horas: f?.horas_resposta ?? null,
    escolhidos: dele.filter(p => p.escolhido).length + 0,
    pedidos: f?.pedidos ?? 0,
    parecidos: parecidosDele.length,
    maisBaratoParecidos: parecidosDele.filter(p => p.mais_barato).length,
    maisBarato: dele.filter(p => p.mais_barato).length,
  }
}

// ── Calibração (mig. 390): a projeção refeita para cada pedido já feito ──────

export interface ParCalibracao { item: string; documento: string | null; tipo: string; fornecedor: string; quant: number; projetado: number; real: number; erro: number }
export interface CalibracaoTipo { tipo: string; n: number; vies: number; erroMedio: number; fator: number | null }

/**
 * Para cada item de PEDIDO (custo real), refaz a projeção como ela teria saído no dia:
 * só com o histórico ATÉ a data dele e sem o próprio orçamento de onde ele veio
 * (a opção escolhida ali preveria a si mesma). Erro = real ÷ projetado − 1.
 */
export function calibrar(h: HistoricoCotacao | null | undefined): { pares: ParCalibracao[]; porTipo: CalibracaoTipo[] } {
  if (!h) return { pares: [], porTipo: [] }
  const pares: ParCalibracao[] = []
  for (const p of h.precos.filter(x => x.situacao === 'pedido')) {
    const fora = new Set([p.producao_id, p.origem_orcamento_id].filter(Boolean) as string[])
    const antes = { ...h, precos: h.precos.filter(x => x.data <= p.data && !fora.has(x.producao_id) && !(x.origem_orcamento_id && fora.has(x.origem_orcamento_id))) }
    const proj = projetar(parecidos(antes, p.nome, p.descricao), p.quant)
    if (!proj || proj.unit <= 0) continue
    pares.push({ item: p.nome, documento: p.documento, tipo: p.tipo || 'Sem tipo', fornecedor: p.fornecedor, quant: p.quant, projetado: proj.unit, real: p.unit, erro: p.unit / proj.unit - 1 })
  }
  const grupos = new Map<string, ParCalibracao[]>()
  for (const x of pares) grupos.set(x.tipo, [...(grupos.get(x.tipo) ?? []), x])
  const porTipo = [...grupos].map(([tipo, xs]) => {
    const vies = mediana(xs.map(x => x.erro))
    return {
      tipo, n: xs.length, vies, erroMedio: mediana(xs.map(x => Math.abs(x.erro))),
      // Só corrige quando o erro é CONSISTENTE: 5+ pedidos do tipo, viés de 5%+ e ao menos
      // 60% deles errando para o mesmo lado e por menos de 100%. Menos que isso é ruído.
      fator: xs.length >= 5 && Math.abs(vies) >= 0.05
        && xs.filter(x => Math.sign(x.erro) === Math.sign(vies) && Math.abs(x.erro) < 1).length >= 0.6 * xs.length ? 1 + vies : null,
    }
  }).sort((a, b) => b.n - a.n)
  return { pares, porTipo }
}

/** Tipo predominante entre as referências (o do fornecedor que mais aparece). */
export function tipoDasRefs(refs: Parecido[]): string | null {
  const c = new Map<string, number>()
  for (const r of refs.slice(0, 12)) if (r.tipo) c.set(r.tipo, (c.get(r.tipo) ?? 0) + 1)
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

// ── Projeção registrada na aprovação (mig. 391) ─────────────────────────────

export interface Registro {
  item: string; documento: string | null; fornecedor: string; quant: number; em: string
  projetado: number; orcado: number | null; real: number
  /** Real − projetado, em R$ no total do item (positivo = saiu mais caro que a projeção). */
  desvio: number
  /** Margem da agência no item (comissão + honorários sobre o valor real). */
  margem: number
}

/** Itens de PP com a projeção congelada: erro de custo da época × margem negociada. */
export function registrados(h: HistoricoCotacao | null | undefined): Registro[] {
  return (h?.precos ?? [])
    .filter(p => p.situacao === 'pedido' && p.projecao && p.projecao.unit > 0)
    .map(p => ({
      item: p.nome, documento: p.documento, fornecedor: p.fornecedor, quant: p.quant, em: p.projecao!.em,
      projetado: p.projecao!.unit, orcado: p.orcado_unit ?? null, real: p.unit,
      desvio: (p.unit - p.projecao!.unit) * p.quant,
      margem: p.unit * p.quant * Number(p.margem_pct ?? 0) / 100,
    }))
}
