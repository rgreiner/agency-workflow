'use server'

/**
 * Server actions do auth próprio (e-mail+senha). Substituem o OAuth do Google.
 * O login lê `auth.users` pela conexão direta, valida a senha (scrypt) e grava
 * o JWT no cookie (`iniciarSessao`).
 */
import { redirect } from 'next/navigation'
import { buscarUsuarioPorEmail, criarUsuario } from '@/lib/auth/usuarios'
import { verificarSenha } from '@/lib/auth/password'
import { iniciarSessao, encerrarSessao } from '@/lib/auth/server'

export async function login(formData: FormData): Promise<void> {
  const email = String(formData.get('email') || '').trim()
  const senha = String(formData.get('senha') || '')
  const next = String(formData.get('next') || '')
  if (!email || !senha) redirect('/login?erro=campos')

  const usuario = await buscarUsuarioPorEmail(email)
  const ok = usuario?.senha_hash ? await verificarSenha(senha, usuario.senha_hash) : false
  if (!usuario || !ok) redirect('/login?erro=credenciais')

  await iniciarSessao({ id: usuario.id, email: usuario.email })
  redirect(next.startsWith('/') ? next : '/')
}

export async function logout(): Promise<void> {
  await encerrarSessao()
  redirect('/login')
}

/**
 * Fluxo de convite: entra (se a conta existe e a senha confere) ou cria a
 * conta, abre a sessão e volta pra página do convite, que então aceita.
 */
export async function entrarConvite(token: string, formData: FormData): Promise<void> {
  const email = String(formData.get('email') || '').trim()
  const senha = String(formData.get('senha') || '')
  const nome = String(formData.get('nome') || '').trim()
  if (!email || !senha) redirect(`/convite/${token}?erro=campos`)

  const existente = await buscarUsuarioPorEmail(email)
  if (existente) {
    const ok = existente.senha_hash ? await verificarSenha(senha, existente.senha_hash) : false
    if (!ok) redirect(`/convite/${token}?erro=credenciais`)
    await iniciarSessao({ id: existente.id, email: existente.email })
  } else {
    const id = await criarUsuario(email, senha, nome || email.split('@')[0])
    await iniciarSessao({ id, email: email.toLowerCase() })
  }
  redirect(`/convite/${token}`)
}
