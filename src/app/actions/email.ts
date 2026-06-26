'use server'

import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

const FROM = process.env.RESEND_FROM ?? 'Agency Workflow <onboarding@resend.dev>'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

// Instancia sob demanda — NUNCA no topo do módulo: `new Resend()` sem chave
// lança, e isso derrubaria todo o chunk de server actions só por importar este
// arquivo (quebrava membros/cargos quando RESEND_API_KEY não está setada).
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  return key ? new Resend(key) : null
}

export async function sendInviteEmail(
  orgSlug: string,
  orgId: string,
  toEmail: string
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // Get or create invite link
  const { data: token, error: rpcError } = await supabase.rpc('upsert_invite_link', {
    p_user_id: user.id,
    p_org_id: orgId,
    p_role: 'member',
  })
  if (rpcError) return { error: rpcError.message }

  // Get sender name + org name
  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('full_name').eq('id', user.id).single()
  if (profileError) return { error: profileError.message }

  const { data: org, error: orgError } = await supabase
    .from('organizations').select('name').eq('id', orgId).single()
  if (orgError) return { error: orgError.message }

  const senderName = profile?.full_name ?? user.email ?? 'Alguém'
  const orgName = org.name
  const inviteUrl = `${SITE_URL}/convite/${token}`

  const resend = getResend()
  if (!resend) {
    return { error: 'Envio de e-mail não configurado (defina RESEND_API_KEY).' }
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `${senderName} convidou você para ${orgName}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 40px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; border: 1px solid #e5e7eb; overflow: hidden;">

    <!-- Header -->
    <div style="background: #ea580c; padding: 32px; text-align: center;">
      <div style="width: 48px; height: 48px; background: rgba(255,255,255,0.2); border-radius: 12px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center;">
        <span style="color: white; font-size: 22px; font-weight: 700;">${orgName.charAt(0).toUpperCase()}</span>
      </div>
      <p style="color: rgba(255,255,255,0.8); margin: 0; font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase;">Agency Workflow</p>
    </div>

    <!-- Body -->
    <div style="padding: 32px;">
      <h1 style="font-size: 22px; font-weight: 700; color: #111827; margin: 0 0 8px;">Você foi convidado!</h1>
      <p style="color: #6b7280; font-size: 15px; margin: 0 0 24px; line-height: 1.5;">
        <strong style="color: #374151;">${senderName}</strong> convidou você para entrar em <strong style="color: #374151;">${orgName}</strong> no Agency Workflow.
      </p>

      <a href="${inviteUrl}"
         style="display: block; background: #ea580c; color: white; text-decoration: none; text-align: center; padding: 14px 24px; border-radius: 10px; font-weight: 600; font-size: 15px;">
        Aceitar convite
      </a>

      <p style="color: #9ca3af; font-size: 12px; margin: 20px 0 0; text-align: center;">
        Ou acesse: <a href="${inviteUrl}" style="color: #ea580c;">${inviteUrl}</a>
      </p>
    </div>

    <!-- Footer -->
    <div style="border-top: 1px solid #f3f4f6; padding: 16px 32px;">
      <p style="color: #d1d5db; font-size: 11px; margin: 0; text-align: center;">
        Se você não esperava este convite, pode ignorar este e-mail.
      </p>
    </div>
  </div>
</body>
</html>`,
  })

  if (error) return { error: error.message }
  return {}
}

export async function sendPasswordResetEmail(
  toEmail: string,
  resetUrl: string,
  nome: string | null,
): Promise<{ error?: string }> {
  const resend = getResend()
  if (!resend) return { error: 'Envio de e-mail não configurado (defina RESEND_API_KEY).' }

  const saudacao = nome ? `Olá, ${nome}!` : 'Olá!'

  const { error } = await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Redefinir sua senha — Agency Workflow',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 40px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; border: 1px solid #e5e7eb; overflow: hidden;">

    <div style="background: #ea580c; padding: 32px; text-align: center;">
      <p style="color: rgba(255,255,255,0.85); margin: 0; font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase;">Agency Workflow</p>
    </div>

    <div style="padding: 32px;">
      <h1 style="font-size: 22px; font-weight: 700; color: #111827; margin: 0 0 8px;">Redefinir senha</h1>
      <p style="color: #6b7280; font-size: 15px; margin: 0 0 24px; line-height: 1.5;">
        ${saudacao} Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para escolher uma nova senha.
      </p>

      <a href="${resetUrl}"
         style="display: block; background: #ea580c; color: white; text-decoration: none; text-align: center; padding: 14px 24px; border-radius: 10px; font-weight: 600; font-size: 15px;">
        Criar nova senha
      </a>

      <p style="color: #9ca3af; font-size: 12px; margin: 20px 0 0; text-align: center;">
        Ou acesse: <a href="${resetUrl}" style="color: #ea580c;">${resetUrl}</a>
      </p>
      <p style="color: #9ca3af; font-size: 12px; margin: 12px 0 0; text-align: center;">
        Este link expira em 1 hora.
      </p>
    </div>

    <div style="border-top: 1px solid #f3f4f6; padding: 16px 32px;">
      <p style="color: #d1d5db; font-size: 11px; margin: 0; text-align: center;">
        Se você não pediu para redefinir a senha, pode ignorar este e-mail com segurança.
      </p>
    </div>
  </div>
</body>
</html>`,
  })

  if (error) return { error: error.message }
  return {}
}
