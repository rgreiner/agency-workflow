import type { Anexo } from '@/app/actions/financeiro'
import type { NotaDoLancamento } from '@/app/actions/nfse'

/** Prefixo das URLs de anexo que apontam para uma NFS-e emitida pelo Flow. */
export const PREFIXO_NOTA = '/api/fiscal/nota/'

/**
 * A NFS-e emitida, no formato de anexo do documento de faturamento.
 *
 * A URL aponta para a rota que RENDERIZA o DANFSe, não para um arquivo no
 * volume. É de propósito: a nota pode ser cancelada ou substituída depois de
 * emitida, e o PDF precisa sair com a marca d'água do estado atual — um arquivo
 * congelado mentiria. Quem lê anexo (o e-mail ao cliente) resolve esta URL
 * gerando o PDF na hora; ver `lerAnexosFaturamento`.
 */
export function anexoDaNota(n: NotaDoLancamento): Anexo {
  return {
    url: `${PREFIXO_NOTA}${n.id}`,
    nome: `NFS-e ${n.numero ?? n.chave}.pdf`,
    tipo: 'NF',
    numero: n.numero ?? undefined,
    emitente: 'agencia',
  }
}

/** O id da nota, quando o anexo é uma NFS-e emitida aqui. */
export function notaIdDoAnexo(url: string): string | null {
  const i = url?.indexOf(PREFIXO_NOTA)
  if (i === undefined || i < 0) return null
  const id = url.slice(i + PREFIXO_NOTA.length).split(/[?#]/)[0]
  return id || null
}
