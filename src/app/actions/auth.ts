'use server'

/**
 * Server actions do auth próprio (e-mail+senha). Substituem o OAuth do Google.
 * O login lê `auth.users` pela conexão direta, valida a senha (scrypt) e grava
 * o JWT no cookie (`iniciarSessao`).
 */
import { redirect } from 'next/navigation'
import { buscarUsuarioPorEmail, criarUsuario } from '@/lib/auth/usuarios'
import { verificarSenha } from '@/lib/auth/password'
import { criarTokenReset, consumirTokenReset, redefinirSenhaUsuario } from '@/lib/auth/reset'
import { sendPasswordResetEmail } from '@/app/actions/email'
import { iniciarSessao, encerrarSessao, getUsuario } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

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
 * Solicita o reset: se houver conta com o e-mail, gera um token e manda o link.
 * Resposta SEMPRE genérica (não revela se o e-mail existe).
 */
export async function solicitarReset(formData: FormData): Promise<void> {
  const email = String(formData.get('email') || '').trim()
  if (!email) redirect('/recuperar-senha?erro=campos')

  const usuario = await buscarUsuarioPorEmail(email)
  if (usuario) {
    try {
      const token = await criarTokenReset(usuario.id)
      const r = await sendPasswordResetEmail(usuario.email, `${SITE_URL}/redefinir-senha/${token}`, usuario.nome)
      if (r.error) console.error('[reset] falha ao enviar e-mail:', r.error)
    } catch (e) {
      console.error('[reset] erro ao solicitar reset:', e)
    }
  }
  redirect('/recuperar-senha?enviado=1')
}

/** Redefine a senha a partir do token (uso único, validade de 1h). */
export async function redefinirSenha(token: string, formData: FormData): Promise<void> {
  const senha = String(formData.get('senha') || '')
  const confirmar = String(formData.get('confirmar') || '')
  if (senha.length < 8) redirect(`/redefinir-senha/${token}?erro=curta`)
  if (senha !== confirmar) redirect(`/redefinir-senha/${token}?erro=confere`)

  const userId = await consumirTokenReset(token)
  if (!userId) redirect(`/redefinir-senha/${token}?erro=token`)

  await redefinirSenhaUsuario(userId, senha)
  redirect('/login?reset=ok')
}

/** Troca a própria senha (logado): confere a senha atual e grava a nova. */
export async function alterarMinhaSenha(senhaAtual: string, novaSenha: string): Promise<{ error?: string }> {
  const me = await getUsuario()
  if (!me) return { error: 'Não autenticado' }
  if (novaSenha.length < 8) return { error: 'A nova senha precisa ter ao menos 8 caracteres.' }
  const usuario = await buscarUsuarioPorEmail(me.email)
  const ok = usuario?.senha_hash ? await verificarSenha(senhaAtual, usuario.senha_hash) : false
  if (!usuario || !ok) return { error: 'Senha atual incorreta.' }
  await redefinirSenhaUsuario(usuario.id, novaSenha)
  return {}
}

// ── Reset pelo ADMIN (tela de Membros) ──────────────────────────────────────
// Valida: quem chama é owner/admin da org; o alvo é membro; o alvo não é owner.
async function podeResetarMembro(orgId: string, targetUserId: string): Promise<{ error?: string }> {
  const me = await getUsuario()
  if (!me) return { error: 'Não autenticado' }
  const supabase = await createClient()
  const { data: mine } = await supabase
    .from('organization_members').select('role').eq('org_id', orgId).eq('user_id', me.id).single()
  if (!mine || !['owner', 'admin'].includes(mine.role)) return { error: 'Sem permissão' }
  const { data: tgt } = await supabase
    .from('organization_members').select('role').eq('org_id', orgId).eq('user_id', targetUserId).single()
  if (!tgt) return { error: 'Usuário não é membro desta organização' }
  if (tgt.role === 'owner') return { error: 'Não dá pra redefinir a senha do proprietário por aqui.' }
  return {}
}

/**
 * Gera um link de redefinição (uso único, 1h) p/ o admin copiar e enviar
 * (WhatsApp etc.). Independe de e-mail configurado.
 */
export async function adminGenerateResetLink(orgId: string, targetUserId: string): Promise<{ url?: string; error?: string }> {
  const guard = await podeResetarMembro(orgId, targetUserId)
  if (guard.error) return { error: guard.error }
  try {
    const token = await criarTokenReset(targetUserId)
    return { url: `${SITE_URL}/redefinir-senha/${token}` }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao gerar o link' }
  }
}

/** Define uma nova senha diretamente para o membro (mín. 8 caracteres). */
export async function adminSetPassword(orgId: string, targetUserId: string, novaSenha: string): Promise<{ error?: string }> {
  if (novaSenha.length < 8) return { error: 'A senha precisa ter ao menos 8 caracteres.' }
  const guard = await podeResetarMembro(orgId, targetUserId)
  if (guard.error) return { error: guard.error }
  try {
    await redefinirSenhaUsuario(targetUserId, novaSenha)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao definir a senha' }
  }
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
