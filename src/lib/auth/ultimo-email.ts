import 'server-only'

/**
 * Lembra o último e-mail usado no acesso, por aparelho.
 *
 * Sem isto, cada erro de senha devolve a tela de login em branco e a pessoa redigita
 * o endereço inteiro — que é justamente onde nascem os `@amexcom.com.br` e os
 * `@hotmai.com` que o log registrou. Vai em cookie (e não na URL) porque e-mail em
 * query string fica em histórico e em log de proxy; e `httpOnly` porque quem lê é o
 * servidor, ao montar a página — nenhum script precisa disso.
 *
 * Guardar o e-mail depois do logout é o comportamento desejado: o que encerra é a
 * sessão, não o aparelho.
 */
import { cookies } from 'next/headers'

export const COOKIE_EMAIL = 'flow-ultimo-email'
const MAX_AGE = 180 * 24 * 60 * 60

export async function lembrarEmail(email: string): Promise<void> {
  const limpo = email.trim().slice(0, 200)
  if (!limpo) return
  const jar = await cookies()
  jar.set(COOKIE_EMAIL, limpo, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export async function emailLembrado(): Promise<string> {
  const jar = await cookies()
  return jar.get(COOKIE_EMAIL)?.value ?? ''
}
