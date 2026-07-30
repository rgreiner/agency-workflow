/**
 * Parser do relatório "Jornada" do Pontomais (PDF → texto via pdftotext -layout).
 *
 * Por que ler o CABEÇALHO de cada página em vez de posição fixa: o Pontomais monta
 * as colunas por colaborador. A Danielle tem `Crédito | Débito`, a Heloísa tem
 * `H. faltantes` — e a largura das colunas muda de página para página (o -layout
 * calcula por página). Então: quebra por página, lê a linha "Data …" daquela página,
 * pega o x de cada coluna e fatia as linhas por esses offsets.
 *
 * O nome do colaborador só aparece na PRIMEIRA página do bloco dele — as seguintes
 * herdam o corrente.
 *
 * ⚠️ Os totais (horas normais, H.E., saldo) são IMPORTADOS COMO ESTÃO, nunca
 * recalculados: o Pontomais credita 8h fixas de "horas normais" e joga o excedente
 * em hora extra, régua diferente da do Flow. Recalcular faria o histórico divergir
 * do que as pessoas já viram e assinaram.
 */

export interface PontomaisDia {
  data: string                     // YYYY-MM-DD
  marcacoes: (string | null)[]     // [1ªEnt, 1ªSaí, 2ªEnt, 2ªSaí, 3ªEnt, 3ªSaí] em HH:MM
  credito_min: number | null
  debito_min: number | null
  faltantes_min: number | null
  intervalo_min: number | null
  normais_min: number | null
  he50_min: number | null
  he100_min: number | null
  noturno_min: number | null
  saldo_min: number | null         // saldo ACUMULADO do banco de horas naquele dia
  motivo: string | null
}
export interface PontomaisPessoa {
  nome: string
  dias: PontomaisDia[]
  /** Linha TOTAIS do rodapé — usada como checksum da importação. */
  totais: { normais_min: number | null; he50_min: number | null; he100_min: number | null } | null
  saldo_final_min: number | null
}
export interface PontomaisRelatorio {
  periodo: { ini: string | null; fim: string | null }
  pessoas: PontomaisPessoa[]
  /** Datas com observação de feriado/emenda, deduzidas do relatório. */
  feriados: { data: string; nome: string; pessoas: number }[]
}

/** "08:35" → 515 · "-02:56" → -176 */
export function hhmmToMin(s: string): number | null {
  const m = /^(-?)(\d{1,3}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const v = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -v : v
}
const brToIso = (d: string) => { const [dd, mm, yy] = d.split('/'); return `${yy}-${mm}-${dd}` }

/** Colunas que sabemos mapear, identificadas pelo rótulo no cabeçalho. */
type Col = { key: string; start: number }
function colKey(label: string): string | null {
  const l = label.toLowerCase()
  if (l === 'data') return 'data'
  if (l.includes('crédito') || l.includes('credito')) return 'credito'
  if (l.includes('débito') || l.includes('debito')) return 'debito'
  if (l.includes('faltantes')) return 'faltantes'
  if (l.includes('intervalo')) return 'intervalo'
  if (l.includes('normais')) return 'normais'
  if (l.includes('(50')) return 'he50'
  if (l.includes('(100')) return 'he100'
  if (l.includes('noturno')) return 'noturno'
  if (l.includes('saldo')) return 'saldo'
  if (l.includes('motivo')) return 'motivo'
  // Marcações. O rótulo NÃO é confiável para saber o par: o "3ª" costuma quebrar
  // para a linha de cima, deixando só "Entrada" — igual à 1ª. Por isso devolvemos
  // um marcador genérico e numeramos por ORDEM de aparição (sempre 1ªE,1ªS,2ªE,2ªS,3ªE,3ªS).
  if (/^([123]\s*[ªa]\s*)?(entrada|saída|saida)$/.test(l.replace(/\s+/g, ' ').trim())) return 'mark'
  return null
}

/** Extrai (rótulo, offset) da linha de cabeçalho que começa com "Data". */
function parseHeader(line: string): Col[] {
  const cols: Col[] = []
  const re = /\S+(?:\s\S+)*?/g
  // Tokeniza por blocos separados por 2+ espaços (o -layout separa colunas assim).
  let idx = 0, nMark = 0
  for (const part of line.split(/(\s{2,})/)) {
    if (!/^\s*$/.test(part)) {
      const k = colKey(part.trim())
      if (k) cols.push({ key: k === 'mark' ? `m${++nMark}` : k, start: idx })
    }
    idx += part.length
  }
  void re
  return cols
}

function fatiar(row: string, cols: Col[], i: number): string {
  // Tolerância à esquerda: o valor pode começar 1-2 chars antes do rótulo.
  const ini = Math.max(0, cols[i].start - 2)
  const fim = i + 1 < cols.length ? Math.max(ini, cols[i + 1].start - 2) : row.length
  return row.slice(ini, fim).trim()
}

const RE_DIA = /^\s*(?:Seg|Ter|Qua|Qui|Sex|Sáb|Dom),\s*(\d{2}\/\d{2}\/\d{4})/
const RE_NOME = /^\s*Colaborador:\s*(.+?)\s*$/
const RE_PERIODO = /De\s+(\d{2}\/\d{2}\/\d{4})\s+at[ée]\s+(\d{2}\/\d{2}\/\d{4})/

/** Palavras do Motivo/Observação que indicam feriado/emenda da EMPRESA (não do indivíduo). */
const FERIADO_RE = /(ano novo|carnaval|quarta-?feira de cinzas|paix[ãa]o de cristo|tiradentes|dia do trabalho|corpus\s*christi|natal|finados|independ[êe]ncia|nossa senhora|proclama[çc][ãa]o|jogos da copa|emenda[^|]*)/i

export function parsePontomais(texto: string): PontomaisRelatorio {
  const pessoas: PontomaisPessoa[] = []
  const feriadoHits = new Map<string, { nome: string; pessoas: Set<string> }>()
  let periodo: { ini: string | null; fim: string | null } = { ini: null, fim: null }
  let atual: PontomaisPessoa | null = null

  for (const pagina of texto.split('\f')) {
    const linhas = pagina.split('\n')

    const nomeLn = linhas.find(l => RE_NOME.test(l))
    if (nomeLn) {
      const nome = RE_NOME.exec(nomeLn)![1]
      atual = { nome, dias: [], totais: null, saldo_final_min: null }
      pessoas.push(atual)
    }
    if (!periodo.ini) {
      const p = linhas.map(l => RE_PERIODO.exec(l)).find(Boolean)
      if (p) periodo = { ini: brToIso(p[1]), fim: brToIso(p[2]) }
    }
    if (!atual) continue

    const hdrIdx = linhas.findIndex(l => /^\s*Data\s{2,}/.test(l))
    if (hdrIdx < 0) continue
    const cols = parseHeader(linhas[hdrIdx])
    if (!cols.some(c => c.key === 'data')) continue

    // Observação longa quebra para a linha seguinte — vai emendando no último dia.
    let ultimoDia: PontomaisDia | null = null
    const iMotivo = cols.findIndex(c => c.key === 'motivo')

    for (const ln of linhas.slice(hdrIdx + 1)) {
      const md = RE_DIA.exec(ln)
      if (!md && ultimoDia && iMotivo >= 0 && !/^\s*TOTAIS/.test(ln)) {
        const cont = fatiar(ln, cols, iMotivo)
        // Só emenda se a continuação estiver MESMO na coluna de observação
        // (linha em branco ou lixo de rodapé não conta).
        if (cont && !/^\s*$/.test(cont) && ln.slice(0, cols[iMotivo].start - 2).trim() === '') {
          ultimoDia.motivo = `${ultimoDia.motivo ?? ''} ${cont}`.trim()
        }
        continue
      }
      if (md) {
        const get = (k: string) => {
          const i = cols.findIndex(c => c.key === k)
          return i < 0 ? '' : fatiar(ln, cols, i)
        }
        const num = (k: string) => { const v = get(k); return v ? hhmmToMin(v) : null }
        const marc = (n: number) => { const v = get(`m${n}`); return /^\d{2}:\d{2}$/.test(v) ? v : null }
        const motivo = get('motivo') || null

        atual.dias.push({
          data: brToIso(md[1]),
          marcacoes: [marc(1), marc(2), marc(3), marc(4), marc(5), marc(6)],
          credito_min: num('credito'), debito_min: num('debito'), faltantes_min: num('faltantes'),
          intervalo_min: num('intervalo'), normais_min: num('normais'),
          he50_min: num('he50'), he100_min: num('he100'), noturno_min: num('noturno'),
          saldo_min: num('saldo'), motivo,
        })

        ultimoDia = atual.dias[atual.dias.length - 1]
        if (motivo) {
          const f = FERIADO_RE.exec(motivo)
          if (f) {
            const key = brToIso(md[1])
            const e = feriadoHits.get(key) ?? { nome: f[1].trim(), pessoas: new Set<string>() }
            e.pessoas.add(atual.nome)
            feriadoHits.set(key, e)
          }
        }
        continue
      }
      if (/^\s*TOTAIS/.test(ln)) {
        const i = (k: string) => { const j = cols.findIndex(c => c.key === k); return j < 0 ? null : hhmmToMin(fatiar(ln, cols, j).split(/\s/)[0] ?? '') }
        atual.totais = { normais_min: i('normais'), he50_min: i('he50'), he100_min: i('he100') }
      }
    }
  }

  for (const p of pessoas) {
    const ult = [...p.dias].reverse().find(d => d.saldo_min !== null)
    p.saldo_final_min = ult?.saldo_min ?? null
  }

  const feriados = [...feriadoHits.entries()]
    .map(([data, v]) => ({ data, nome: v.nome, pessoas: v.pessoas.size }))
    .sort((a, b) => a.data.localeCompare(b.data))

  return { periodo, pessoas, feriados }
}
