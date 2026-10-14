/**
 * Legenda de cada peça para a tela de aprovação do cliente (mig. 343).
 *
 * A Redação escreve um bloco por peça — "Post e Story 1", "Carrossel 2",
 * "Motion 3 - 15”" — e cada bloco termina em "Legenda:". O Design nomeia os
 * arquivos da Preview com o MESMO nome + número ("Carrossel 2 - Card 1.png",
 * "Motion 3-15 - Cartela 1.png", "mockup CARROSSEL 2 1080x1350.jpg").
 *
 * Regra: casa peça e bloco por TIPO + NÚMERO. O que não casar fica sem legenda,
 * nunca com a legenda de outra peça. O cliente só vê o trecho da legenda — o
 * resto do documento (texto da arte, títulos de anúncio, notas) não sai daqui.
 */

/** Palavras que abrem um bloco de peça (e que o Design usa no nome do arquivo). */
const TIPOS = [
  'post', 'posts', 'story', 'stories', 'storie', 'carrossel', 'carrosel', 'carousel',
  'motion', 'reels', 'reel', 'video', 'peca', 'arte', 'banner', 'criativo', 'anuncio', 'feed',
]
const SINONIMO: Record<string, string> = {
  posts: 'post', stories: 'story', storie: 'story', carrosel: 'carrossel', carousel: 'carrossel',
  reel: 'reels',
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
const tipoCanonico = (t: string) => SINONIMO[t] ?? t

/**
 * Nota interna do Google Docs: o export em texto marca o comentário com "[a]" no
 * corpo e despeja o texto dele no fim, numa linha que começa com "[a]". As duas
 * coisas saem (colchete com 1–2 letras minúsculas; "[logo KSBIG]" fica).
 */
function semComentarios(texto: string): string {
  return texto
    .split('\n')
    .filter(l => !/^\s*\[[a-z]{1,2}\]/.test(l))
    .join('\n')
    .replace(/\[[a-z]{1,2}\]/g, '')
}

/** "Post e Story 1" → { tipos: ['post','story'], n: 1 }; linha comum → null. */
function cabecalho(linha: string): { nome: string; tipos: string[]; n: number } | null {
  const l = linha.trim()
  if (!l || l.length > 48 || l.includes(':')) return null
  const m = semAcento(l).match(/^([a-z][a-z\s/+&e]*?)\s*(\d{1,2})\b/)
  if (!m) return null
  const tipos = m[1].split(/[\s/+&]+/).filter(p => TIPOS.includes(p)).map(tipoCanonico)
  if (tipos.length === 0) return null
  return { nome: l.replace(/\s*-\s*\d+\s*[”"″]?\s*$/, '').trim(), tipos, n: Number(m[2]) }
}

export interface BlocoLegenda { nome: string; tipos: string[]; n: number; legenda: string }

/** Blocos com legenda do texto da Redação. Sem cabeçalho e com 1 legenda só → bloco único. */
export function blocosDaRedacao(texto: string): BlocoLegenda[] {
  const linhas = semComentarios(texto.replace(/\r/g, '')).split('\n')
  const blocos: BlocoLegenda[] = []
  let atual: BlocoLegenda | null = null
  let coletando = false
  let semCabecalho: string[] | null = null

  const fechar = () => { coletando = false }

  for (const bruta of linhas) {
    const linha = bruta.trimEnd()
    const cab = cabecalho(linha)
    // Separador "____", título de anúncio ou bloco novo encerram a legenda.
    if (cab || /^_{4,}/.test(linha.trim()) || /^t[ií]tulo\s*\d+\s*[:⁚]/i.test(linha.trim()) || /^###\s/.test(linha)) {
      fechar()
      if (cab) { atual = { ...cab, legenda: '' }; blocos.push(atual) }
      continue
    }
    const leg = linha.match(/^\s*legenda\s*[:⁚-]?\s*(.*)$/i)
    if (leg) {
      coletando = true
      if (atual) atual.legenda = leg[1]
      else semCabecalho = [...(semCabecalho ?? []), leg[1]]
      continue
    }
    // "TEXTO DA ARTE", "Card 2" e afins também encerram (são da arte, não da legenda).
    if (coletando && /^\s*(texto da arte|card \d+|cartela \d+|tela \d+)\b/i.test(linha)) { fechar(); continue }
    if (coletando) {
      if (atual) atual.legenda += `\n${linha}`
      else if (semCabecalho) semCabecalho[semCabecalho.length - 1] += `\n${linha}`
    }
  }

  const limpa = (s: string) => s.replace(/\n{3,}/g, '\n\n').trim()
  const comLegenda = blocos.map(b => ({ ...b, legenda: limpa(b.legenda) })).filter(b => b.legenda)
  if (comLegenda.length === 0 && semCabecalho?.length === 1 && limpa(semCabecalho[0])) {
    return [{ nome: '', tipos: [], n: 0, legenda: limpa(semCabecalho[0]) }]
  }
  return comLegenda
}

/** Tipo + número no nome do arquivo ("Carrossel 2 - Card 1.png" → carrossel 2). */
function chaveDoArquivo(nome: string): { tipo: string; n: number } | null {
  const base = semAcento(nome.replace(/\.[a-z0-9]{2,5}$/i, ''))
  const re = /([a-z]+)\s*[-_]?\s*(\d{1,2})(?!\d|x\d)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(base))) {
    if (TIPOS.includes(m[1])) return { tipo: tipoCanonico(m[1]), n: Number(m[2]) }
  }
  return null
}

export interface PecaRef { ref: string; name: string }
export interface GrupoPeca { nome: string; legenda: string; refs: string[] }

/**
 * Agrupa as peças pela legenda. Devolve null quando não há legenda nenhuma — a
 * tela segue no modo lista. Peça sem par vai para o grupo final, sem legenda.
 */
export function agruparPorLegenda(pecas: PecaRef[], texto: string): GrupoPeca[] | null {
  const blocos = blocosDaRedacao(texto)
  if (blocos.length === 0 || pecas.length === 0) return null

  // Documento de uma legenda só (ex.: "Legenda Feed Fotos"): vale para todas.
  if (blocos.length === 1 && blocos[0].tipos.length === 0) {
    return [{ nome: '', legenda: blocos[0].legenda, refs: ordenar(pecas).map(p => p.ref) }]
  }

  const grupos = new Map<BlocoLegenda, string[]>()
  const sobra: PecaRef[] = []
  for (const p of ordenar(pecas)) {
    const k = chaveDoArquivo(p.name)
    // Ambíguo (dois blocos com o mesmo tipo e número) também não casa.
    const cand = k ? blocos.filter(b => b.n === k.n && b.tipos.includes(k.tipo)) : []
    if (cand.length === 1) grupos.set(cand[0], [...(grupos.get(cand[0]) ?? []), p.ref])
    else sobra.push(p)
  }
  if (grupos.size === 0) return null

  const out: GrupoPeca[] = blocos
    .filter(b => grupos.has(b))
    .map(b => ({ nome: b.nome, legenda: b.legenda, refs: grupos.get(b)! }))
  if (sobra.length) out.push({ nome: 'Outras peças', legenda: '', refs: sobra.map(p => p.ref) })
  return out
}

/** Ordem natural, com o mockup do grupo no fim (a peça vem antes da simulação). */
function ordenar(pecas: PecaRef[]): PecaRef[] {
  const mock = (n: string) => (/mockup/i.test(n) ? 1 : 0)
  return [...pecas].sort((a, b) =>
    mock(a.name) - mock(b.name) || a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
}

export interface ConferenciaLegendas {
  /** Peças que o cliente vai ver junto de uma legenda. */
  comLegenda: number
  total: number
  /** Arquivos da Preview sem bloco correspondente na Redação. */
  semLegenda: string[]
  /** Blocos com legenda na Redação que não acharam arte na Preview. */
  legendaSemPeca: string[]
  /** A Redação não tem nenhum "Legenda:" que dê para casar. */
  nenhuma: boolean
}

/**
 * O que o cliente vai ver na aprovação — para a equipe conferir ANTES de mandar.
 * Mesma regra de `agruparPorLegenda`, contada do lado da agência.
 */
export function conferirLegendas(pecas: PecaRef[], texto: string): ConferenciaLegendas {
  const grupos = agruparPorLegenda(pecas, texto)
  if (!grupos) {
    return { comLegenda: 0, total: pecas.length, semLegenda: pecas.map(p => p.name), legendaSemPeca: [], nenhuma: true }
  }
  const nome = new Map(pecas.map(p => [p.ref, p.name]))
  const semLegenda = grupos.filter(g => !g.legenda).flatMap(g => g.refs.map(r => nome.get(r) ?? r))
  const usados = new Set(grupos.filter(g => g.legenda).map(g => g.nome))
  const legendaSemPeca = blocosDaRedacao(texto).filter(b => b.nome && !usados.has(b.nome)).map(b => b.nome)
  return {
    comLegenda: pecas.length - semLegenda.length, total: pecas.length,
    semLegenda, legendaSemPeca, nenhuma: false,
  }
}
