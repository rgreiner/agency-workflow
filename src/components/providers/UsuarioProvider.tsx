'use client'

/**
 * Quem é o usuário logado, no BROWSER.
 *
 * Antes isso saía de `document.cookie`: o client decodificava o payload do
 * `flow-jwt` para descobrir o próprio id. Com o cookie httpOnly (03/08) o token
 * não está mais ao alcance do JavaScript — e não precisa estar, porque o
 * servidor já sabe quem é e pode simplesmente contar.
 *
 * É só identidade para a UI e para preencher `p_user_id` nas RPCs; autorização
 * de verdade continua sendo o PostgREST validando o JWT + a RLS no banco (que,
 * aliás, comparam `p_user_id` com `auth.uid()` — mentir aqui não leva a nada).
 */
import { createContext, useContext } from 'react'

export interface UsuarioAtual {
  id: string
  email: string
}

const Ctx = createContext<UsuarioAtual | null>(null)

export function UsuarioProvider({ value, children }: { value: UsuarioAtual; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Usuário logado, ou null fora do provider (não deve acontecer dentro de /[orgSlug]). */
export function useUsuario(): UsuarioAtual | null {
  return useContext(Ctx)
}
