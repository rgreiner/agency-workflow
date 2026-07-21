// Documento fiscal do lançamento: número e emitente, além do arquivo.
//
// Por que existe: uma comissão de produção envolve 3 partes e até 4 papéis (NF do
// fornecedor contra o cliente, NF da agência contra o fornecedor, e os boletos de
// cada um). O número é o que se procura na hora de conferir — e hoje ele vive só
// no NOME DO ARQUIVO, em pelo menos cinco formatos diferentes:
//   "Positiva - NF 2163.pdf" · "NF 593.pdf" · "4091.pdf" · "100177.PDF"
//   "ocvel_vencto_01_07_2026_doc_17883_bol_14195_cli_...pdf"
// Ou seja, o campo já era preenchido na mão, no único lugar que existia.

export const EMITENTES = [
  { value: '', label: 'Emitente —' },
  { value: 'agencia', label: 'Agência' },
  { value: 'fornecedor', label: 'Fornecedor' },
  { value: 'cliente', label: 'Cliente' },
] as const

export const EMITENTE_LABEL: Record<string, string> = {
  agencia: 'agência', fornecedor: 'fornecedor', cliente: 'cliente',
}

/**
 * Tenta ler o número no nome do arquivo. **Conservador de propósito**: número
 * fiscal errado é pior que número ausente, então só devolve quando não há
 * ambiguidade. Casos como `ocvel_..._doc_17883_bol_14195_cli_1753...` (vários
 * números) ou `WhatsApp Image 2026-07-03 at 16.37.24` voltam vazios.
 */
export function numeroDoNome(nome: string): string {
  const base = (nome || '').replace(/\.[a-z0-9]+$/i, '').trim()
  if (!base) return ''

  // 1) "NF 2163", "boleto 2158", "nf-593" — o rótulo diz qual número importa.
  const rotulado = base.match(/\b(?:nf|nfe|nota(?:\s+fiscal)?|boleto|bol)\b[\s._-]*(\d{2,10})\b/i)
  if (rotulado) return rotulado[1]

  // 2) O nome inteiro é o número: "4091", "100177".
  if (/^\d{2,10}$/.test(base)) return base

  // 3) Qualquer outra coisa: só aceita se houver EXATAMENTE um número no nome —
  //    com dois ou mais não dá pra saber qual é o fiscal.
  const todos = base.match(/\d{2,10}/g) ?? []
  if (todos.length === 1) return todos[0]
  return ''
}

/** Etiqueta curta do documento: "NF 2163" / "Boleto 2158" / "NF" quando não há número. */
export function chipDocumento(d: { tipo?: string; numero?: string }): string {
  const t = d.tipo || 'Doc'
  return d.numero ? `${t} ${d.numero}` : t
}

/** Tudo que a busca precisa enxergar de um documento (número, nome e emitente). */
export function textoBuscavel(docs: { nome?: string; numero?: string; emitente?: string }[] | null | undefined): string {
  return (docs ?? [])
    .map(d => `${d.numero ?? ''} ${d.nome ?? ''} ${EMITENTE_LABEL[d.emitente ?? ''] ?? ''}`)
    .join(' ')
}
