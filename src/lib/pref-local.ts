/**
 * Preferência de tela por PESSOA, no navegador dela (colunas abertas, filtro,
 * "Eu"). Guardada em `localStorage` e lida por `useSyncExternalStore`, não por
 * `useState` + `useEffect`: o lint do projeto barra `setState` dentro de efeito,
 * e o efeito ainda causaria um segundo render depois da hidratação.
 *
 * O cache existe porque `useSyncExternalStore` exige um snapshot ESTÁVEL enquanto
 * nada mudou — devolver um objeto novo a cada leitura entra em laço de render.
 *
 * Versionar a chave (`:v2`) quando o formato ou o default mudar.
 */
export interface PrefLocal<T> {
  get: () => T
  set: (valor: T) => void
  assinar: (cb: () => void) => () => void
  padrao: T
}

export function criarPrefLocal<T>(chave: string, padrao: T, ler: (bruto: string) => T): PrefLocal<T> {
  const ouvintes = new Set<() => void>()
  let cache: { bruto: string | null; valor: T } | null = null

  const get = (): T => {
    let bruto: string | null = null
    try { bruto = localStorage.getItem(chave) } catch { /* aba anônima / storage bloqueado */ }
    if (cache && cache.bruto === bruto) return cache.valor
    let valor = padrao
    if (bruto != null) { try { valor = ler(bruto) } catch { valor = padrao } }
    cache = { bruto, valor }
    return valor
  }

  const set = (valor: T) => {
    try { localStorage.setItem(chave, JSON.stringify(valor)) } catch { /* só perde a memória */ }
    cache = null
    ouvintes.forEach(f => f())
  }

  const assinar = (cb: () => void) => { ouvintes.add(cb); return () => { ouvintes.delete(cb) } }
  return { get, set, assinar, padrao }
}
