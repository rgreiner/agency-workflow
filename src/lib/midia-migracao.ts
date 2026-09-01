/**
 * Correspondência entre as tarefas do cliente-balde e o novo modelo
 * (cliente real + rotina do catálogo). Puro: recebe listas, devolve sugestões.
 *
 * O balde codificou o cliente no TÍTULO — "[Comil] Otimização Campanhas
 * Digitais", "[Ópera] Boletos Digitais Mensais", e às vezes sem colchete
 * ("Residencial Di Napoli - Boletos"). Sugerir é seguro; decidir não: os nomes
 * do balde não cobrem tudo ("[Gestão]" não é cliente, "[Mel do Malte]" não tem
 * workspace). Por isso toda sugestão é editável e nada migra sem confirmação.
 */

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'ou', 'em', 'a', 'o', 'as', 'os',
  'no', 'na', 'para', 'com', 'mensal', 'mensais', 'digital', 'digitais'])

const raiz = (t: string) =>
  t.replace(/(oes|ais|res|s)$/, m => (m === 'oes' ? 'ao' : m === 'ais' ? 'al' : m === 'res' ? 'r' : ''))

const tokens = (s: string) =>
  new Set(norm(s).split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t)).map(raiz))

/** "[Comil] Otimização…" → "Comil". Sem colchete, devolve null. */
export function clienteDoTitulo(titulo: string): string | null {
  const m = titulo.match(/^\s*\[([^\]]+)\]/)
  return m ? m[1].trim() : null
}

/** Título sem o prefixo do cliente. */
export function tituloLimpo(titulo: string): string {
  return titulo.replace(/^\s*\[[^\]]+\]\s*-?\s*/, '').trim()
}

export interface Alvo { id: string; nome: string }

/**
 * Cliente sugerido: casa o prefixo `[X]` (ou o próprio título, quando não há
 * colchete) com o nome do workspace, ignorando acento e caixa. "Ópera" acha
 * "Opera"; "Residencial Di Napoli - Boletos" acha "Di Napoli" por conter o nome.
 */
export function sugerirCliente(titulo: string, clientes: Alvo[]): string | null {
  const marca = clienteDoTitulo(titulo)
  const alvo = norm(marca ?? titulo)

  const exato = clientes.find(c => norm(c.nome) === alvo)
  if (exato) return exato.id

  if (marca) {
    const parcial = clientes.find(c => alvo.includes(norm(c.nome)) || norm(c.nome).includes(alvo))
    if (parcial) return parcial.id
    return null   // "[Gestão]" e "[Mel do Malte]" caem aqui: humano decide
  }
  // Sem colchete: o nome do cliente pode estar solto no título.
  const noTexto = clientes
    .filter(c => norm(c.nome).length > 3 && alvo.includes(norm(c.nome)))
    .sort((a, b) => b.nome.length - a.nome.length)[0]
  return noTexto?.id ?? null
}

export interface RotinaAlvo extends Alvo { descricao?: string | null }

/**
 * Rotina sugerida: pontua por palavras em comum com o nome E a descrição do
 * catálogo. A descrição importa — "Planilhas de autorizações mensais" só acha
 * "NFs, check-in e relatório no CRM" porque a descrição dela fala em
 * "Relatório de Autorização".
 */
export function sugerirRotina(
  titulo: string, rotinas: RotinaAlvo[],
): { id: string; forte: boolean } | null {
  const t = tokens(tituloLimpo(titulo))
  if (t.size === 0) return null

  let melhor: { id: string; score: number; noNome: boolean } | null = null
  for (const r of rotinas) {
    const doNome = tokens(r.nome)
    const daDescricao = tokens(r.descricao ?? '')
    let score = 0
    let noNome = false
    for (const tk of t) {
      // Palavra do nome vale mais que palavra da descrição: "boleto" no nome da
      // rotina é identidade; na descrição pode ser menção de passagem.
      if (doNome.has(tk)) { score += 2; noNome = true }
      else if (daDescricao.has(tk)) score += 1
    }
    if (score > 0 && (!melhor || score > melhor.score)) melhor = { id: r.id, score, noNome }
  }
  if (!melhor) return null
  // Sem nenhuma palavra do NOME da rotina, a sugestão é fraca — foi o que
  // aconteceu com "[É o Amor] Liberação Mídia Mensal", que casou com
  // "NFs, check-in e relatório no CRM" só porque "mídia" aparece na descrição.
  // Sugestão errada com cara de certa é pior que sugestão nenhuma.
  return { id: melhor.id, forte: melhor.noNome }
}

export interface TarefaAlvo extends Alvo { prazo?: string | null }

/** Título de tarefa sem o prefixo de data ("260819 - Padrão…" → "Padrão…"). */
export function tituloSemData(titulo: string): string {
  return titulo.replace(/^\s*\d{6}\s*-?\s*/, '').trim()
}

/**
 * Tarefa sugerida para uma ENTREGA da mídia: palavras em comum entre o nome da
 * entrega e o título da tarefa, já sem o prefixo de data que o Flow põe na pasta.
 * Empate resolve pelo prazo mais próximo do envio ao veículo — duas peças do
 * mesmo anunciante costumam ter nome igual e datas diferentes.
 *
 * `forte` exige 2+ palavras em comum OU uma palavra longa (≥6 letras): a mídia
 * repete "anúncio", "arte", "post" em quase tudo, e uma palavra genérica em
 * comum não é evidência de nada — mesma lição da sugestão fraca das rotinas.
 */
export function sugerirTarefa(
  tituloEntrega: string, tarefas: TarefaAlvo[], prazoEnvio?: string | null,
): { id: string; forte: boolean } | null {
  const t = tokens(tituloEntrega)
  if (t.size === 0) return null

  const distancia = (prazo?: string | null) => {
    if (!prazoEnvio || !prazo) return 9999
    return Math.abs(Date.parse(prazo.slice(0, 10)) - Date.parse(prazoEnvio.slice(0, 10))) / 86400000
  }

  let melhor: { id: string; score: number; especifica: boolean; d: number } | null = null
  for (const a of tarefas) {
    const alvo = tokens(tituloSemData(a.nome))
    let score = 0
    let especifica = false
    for (const tk of t) if (alvo.has(tk)) { score++; if (tk.length >= 6) especifica = true }
    if (score === 0) continue
    const d = distancia(a.prazo)
    if (!melhor || score > melhor.score || (score === melhor.score && d < melhor.d)) {
      melhor = { id: a.id, score, especifica, d }
    }
  }
  if (!melhor) return null
  return { id: melhor.id, forte: melhor.score >= 2 || melhor.especifica }
}
