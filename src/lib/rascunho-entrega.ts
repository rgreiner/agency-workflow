/**
 * Rascunho da "Nova entrega" da mídia. Mora no IndexedDB (não no localStorage)
 * porque guarda também as referências anexadas — File passa inteiro pelo
 * structured clone, e prints de 1 MB estouram a cota do localStorage.
 *
 * Fica só neste navegador. Tudo é best-effort: aba anônima ou storage bloqueado
 * só perde o rascunho, nunca quebra o formulário.
 */

const DB = 'flow-rascunhos'
const STORE = 'entrega'

export interface RascunhoEntrega {
  form: Record<string, unknown>
  anexos: File[]
  salvoEm: number
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function op<T>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  try {
    const db = await abrir()
    return await new Promise<T | null>((resolve, reject) => {
      const req = fn(db.transaction(STORE, modo).objectStore(STORE))
      req.onsuccess = () => resolve((req.result as T) ?? null)
      req.onerror = () => reject(req.error)
    }).finally(() => db.close())
  } catch {
    return null
  }
}

export const lerRascunhoEntrega = (orgSlug: string) =>
  op<RascunhoEntrega>('readonly', s => s.get(orgSlug))

export const salvarRascunhoEntrega = (orgSlug: string, r: RascunhoEntrega) =>
  op('readwrite', s => s.put(r, orgSlug))

export const apagarRascunhoEntrega = (orgSlug: string) =>
  op('readwrite', s => s.delete(orgSlug))
