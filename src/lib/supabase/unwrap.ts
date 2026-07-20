import 'server-only'

/**
 * Desempacota o resultado de uma query do PostgREST FALHANDO ALTO.
 *
 * O padrão `const x = (data ?? []) as T[]` transforma erro em lista vazia. Foi assim
 * que a tela de Lançamentos passou 8 dias mostrando zero lançamentos e cards zerados:
 * o select pedia uma coluna que não existia (migration 043 não aplicada), o PostgREST
 * devolvia 400, e o `?? []` engolia. Ninguém viu erro nenhum.
 *
 * Numa tela de dinheiro, lista vazia por falha é pior que erro: erro alguém reporta,
 * zero alguém acredita. Aqui o erro sobe pro error boundary, que já sabe exibir.
 *
 * Uso:
 *   const lancamentos = unwrap(await sb.from('lancamentos').select(...), 'lançamentos')
 */
export function unwrap<T>(
  res: { data: T[] | null; error: { message: string } | null },
  contexto: string,
): T[] {
  if (res.error) throw new Error(`Falha ao carregar ${contexto}: ${res.error.message}`)
  return res.data ?? []
}

/** Versão para `.maybeSingle()`/`.single()`, onde o vazio legítimo é null. */
export function unwrapOne<T>(
  res: { data: T | null; error: { message: string } | null },
  contexto: string,
): T | null {
  if (res.error) throw new Error(`Falha ao carregar ${contexto}: ${res.error.message}`)
  return res.data
}
