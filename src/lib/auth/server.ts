/**
 * Helpers de sessão para Server Components / Server Actions (Node).
 * Substituem o antigo `supabase.auth.getUser()`. A "sessão" é o próprio JWT
 * (cookie `flow-jwt`), assinado com JWT_SECRET — o mesmo que o supabase-js
 * envia ao PostgREST.
 */
import { cookies } from "next/headers";
import { COOKIE_TOKEN, mintToken, opcoesCookie, verifyToken } from "./jwt";

export type SessionUser = { id: string; email: string };

/** Usuário logado atual (ou null). Nunca lança — falha vira null. */
export async function getUsuario(): Promise<SessionUser | null> {
  try {
    const jar = await cookies();
    const claims = await verifyToken(jar.get(COOKIE_TOKEN)?.value);
    return claims ? { id: claims.sub, email: claims.email } : null;
  } catch {
    return null;
  }
}

/** Inicia a sessão (grava o JWT no cookie). */
export async function iniciarSessao(user: SessionUser): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_TOKEN, await mintToken({ sub: user.id, email: user.email }), opcoesCookie());
}

/** Encerra a sessão (remove o cookie). */
export async function encerrarSessao(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_TOKEN);
}
