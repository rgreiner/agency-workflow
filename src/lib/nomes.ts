// Nome de pessoa/empresa escrito à mão: comparar, escolher a melhor grafia e
// sugerir. Módulo puro — mesma régua usada pelo cubo da Análise no banco.
//
// O problema que originou isto: "É o Amor" e "É O Amor" eram dois clientes na
// tabela dinâmica; "KSBIG HORTIFRUTIGRANJEIROS LTDA" (caixa alta do arquivo da
// Conta Azul) e "Ksbig Hortifrutigranjeiros Ltda" (cadastro do Flow) partiam
// R$ 245 mil em dois. Ver migration 250.

import { porNome } from './utils'

/* Tabela FIXA de acentos, espelhando `fin_sem_acento` (migration 250) caractere a
   caractere. NÃO trocar por `normalize('NFD')`: o Postgres traduz só esta tabela e o
   NFD trataria também ñ, ů e afins — as duas réguas passariam a divergir, e o
   drilldown da Análise (que filtra em JS sobre nomes agrupados no banco) traria só
   metade dos lançamentos. */
const ACENTOS    = 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ'
const SEM_ACENTO = 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'

export function semAcento(s: string): string {
  let out = ''
  for (const ch of s ?? '') {
    const i = ACENTOS.indexOf(ch)
    out += i >= 0 ? SEM_ACENTO[i] : ch
  }
  return out
}

/** Chave de comparação de nome. Espelha `fin_chave_nome` (migration 250). */
export function chaveNome(s: string): string {
  return semAcento((s ?? '').trim()).toLowerCase()
}

export interface VarianteNome {
  nome: string
  /** Quantas vezes esta grafia aparece. Desempata quando o resto empata. */
  peso?: number
  /** Veio de um cadastro (fornecedor/cliente), não de texto digitado. Ganha sempre. */
  cadastro?: boolean
}

const ehCaixaAlta = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase()
const temAcento = (s: string) => s !== semAcento(s)

/**
 * A melhor grafia entre variantes do mesmo nome, nesta ordem:
 *   1. a do cadastro — é a que a pessoa escolheu de propósito;
 *   2. fora de CAIXA ALTA — "Ksbig Hortifrutigranjeiros Ltda", não o gritado do arquivo;
 *   3. com acento — "Simão", não "Simao";
 *   4. a mais usada;
 *   5. alfabética, para o resultado não variar entre carregamentos.
 * A ordem 2–5 é a MESMA do `fin_cubo`, para tela e cubo não discordarem.
 */
export function melhorGrafia(variantes: VarianteNome[]): string {
  const ranque = (v: VarianteNome): [number, number, number, number] => [
    v.cadastro ? 0 : 1,
    ehCaixaAlta(v.nome) ? 1 : 0,
    temAcento(v.nome) ? 0 : 1,
    -(v.peso ?? 0),
  ]
  return [...variantes].sort((a, b) => {
    const ra = ranque(a), rb = ranque(b)
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i]
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })[0]?.nome ?? ''
}

/**
 * Lista de sugestões: uma entrada por nome (variantes de grafia colapsadas na
 * melhor), em ordem alfabética. `localeCompare` e não a ordem do Postgres — o
 * banco em Alpine ordena por bytes e joga acento pro fim (ver memória).
 */
export function sugestoesDeNome(variantes: VarianteNome[]): string[] {
  const porChave = new Map<string, VarianteNome[]>()
  for (const v of variantes) {
    const nome = (v.nome ?? '').trim()
    if (!nome) continue
    const k = chaveNome(nome)
    const lista = porChave.get(k)
    if (lista) lista.push({ ...v, nome })
    else porChave.set(k, [{ ...v, nome }])
  }
  return [...porChave.values()].map(melhorGrafia).sort(porNome(n => n))
}

/**
 * Sugestões que casam com o que está sendo digitado, melhores primeiro:
 * começa-com antes de contém. `limite` corta a lista para o painel não virar rolagem.
 */
export function filtraSugestoes(sugestoes: string[], texto: string, limite = 8): string[] {
  const q = chaveNome(texto)
  if (!q) return []
  const comeca: string[] = []
  const contem: string[] = []
  for (const s of sugestoes) {
    const k = chaveNome(s)
    if (k.startsWith(q)) comeca.push(s)
    else if (k.includes(q)) contem.push(s)
  }
  return [...comeca, ...contem].slice(0, limite)
}
