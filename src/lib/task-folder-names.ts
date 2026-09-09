/**
 * Nomes que a estrutura de pasta de tarefa usa — SEM 'server-only', porque o
 * editor de caminho (cliente) precisa reconhecer uma subpasta pra barrar o
 * "colei o caminho do Preview no lugar da pasta da tarefa".
 */

/** As cinco subpastas que toda pasta de tarefa recebe (Drive e S3 honram a mesma lista). */
export const SUBPASTAS_TAREFA = ['Final', 'Preview', 'Redação', 'Mockup', 'Links'] as const

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Último segmento de um caminho (Windows ou POSIX), ignorando barra final. */
export function ultimoSegmento(path: string | null | undefined): string {
  return (path ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
}

/** "Preview", "redacao", "FINAL\"… é nome de subpasta padrão? */
export function isSubpastaTarefa(nome: string): boolean {
  const n = semAcento(nome)
  return SUBPASTAS_TAREFA.some(s => semAcento(s) === n)
}
