'use server'

/**
 * Portal do cliente — actions.
 * Lado público (sem sessão de membro): pedir magic link e entrar com o token.
 * Lado admin (sessão de membro owner/admin): gerenciar os contatos com acesso.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import {
  buscarPortalUserPorEmail, criarTokenPortal, consumirTokenPortal,
  iniciarSessaoPortal, encerrarSessaoPortal,
} from '@/lib/auth/portal'
import { sendMail } from '@/lib/email/send'
import { emailLayout } from '@/lib/email/layout'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

// ── Lado público (cliente) ────────────────────────────────────────────────────

/**
 * Pede o link de acesso. Resposta SEMPRE genérica — não revela se o e-mail
 * está cadastrado.
 */
export async function solicitarAcessoPortal(formData: FormData): Promise<void> {
  const email = String(formData.get('email') || '').trim()
  if (!email) redirect('/portal?erro=campos')

  const contato = await buscarPortalUserPorEmail(email)
  if (contato) {
    try {
      const token = await criarTokenPortal(contato.id)
      const url = `${SITE_URL}/portal/entrar/${token}`
      const { error } = await sendMail({
        to: contato.email,
        subject: 'Seu acesso ao painel — Flow',
        html: emailLayout({
          heading: 'Acesse o seu painel',
          bodyHtml: `<p>Olá, ${contato.nome}!</p>
<p>Toque no botão abaixo pra entrar no painel de acompanhamento dos seus trabalhos. O link vale por 30 minutos e só funciona uma vez.</p>`,
          cta: { label: 'Entrar no painel', url },
          footerNote: 'Se você não pediu este acesso, ignore este e-mail.',
        }),
      })
      if (error) throw new Error(error)
    } catch (e) {
      // Sem sessão de membro aqui (fluxo anônimo) — RLS barraria o insert em
      // system_errors; o log fica no stdout do container.
      console.error('[portal] falha ao enviar magic link:', e)
    }
  }

  redirect('/portal?enviado=1')
}

/** Consome o token do magic link e abre a sessão do portal. */
export async function entrarPortal(token: string): Promise<void> {
  const contato = await consumirTokenPortal(token)
  if (!contato) redirect('/portal?erro=link')
  await iniciarSessaoPortal(contato)
  redirect('/portal/painel')
}

/** Sai do portal. */
export async function sairPortal(): Promise<void> {
  await encerrarSessaoPortal()
  redirect('/portal')
}

// ── Lado admin (membro owner/admin da org) ────────────────────────────────────

async function adminContext(workspaceId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }

  const { data: ws } = await supabase
    .from('workspaces').select('id, org_id, name').eq('id', workspaceId).single()
  if (!ws) return { error: 'Cliente não encontrado' as const }

  const { data: member } = await supabase
    .from('organization_members')
    .select('role').eq('org_id', ws.org_id).eq('user_id', user.id).single()
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return { error: 'Só administradores gerenciam o acesso do cliente' as const }
  }
  return { supabase, user, ws }
}

export async function criarAcessoPortal(
  orgSlug: string, workspaceId: string, formData: FormData,
): Promise<{ error?: string }> {
  const ctx = await adminContext(workspaceId)
  if ('error' in ctx) return { error: ctx.error }

  const nome = String(formData.get('nome') || '').trim()
  const email = String(formData.get('email') || '').trim().toLowerCase()
  if (!nome || !email) return { error: 'Preencha nome e e-mail.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'E-mail inválido.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (ctx.supabase as any).from('portal_users').insert({
    org_id: ctx.ws.org_id,
    workspace_id: workspaceId,
    nome,
    email,
    created_by: ctx.user.id,
  })
  if (error) {
    if (String(error.code) === '23505') return { error: 'Este e-mail já tem acesso neste cliente.' }
    return { error: 'Não foi possível criar o acesso.' }
  }

  revalidatePath(`/${orgSlug}/workspaces/${workspaceId}`)
  return {}
}

export async function setAcessoPortalAtivo(
  orgSlug: string, workspaceId: string, portalUserId: string, ativo: boolean,
): Promise<{ error?: string }> {
  const ctx = await adminContext(workspaceId)
  if ('error' in ctx) return { error: ctx.error }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (ctx.supabase as any)
    .from('portal_users').update({ ativo })
    .eq('id', portalUserId).eq('workspace_id', workspaceId)
  if (error) return { error: 'Não foi possível atualizar o acesso.' }

  revalidatePath(`/${orgSlug}/workspaces/${workspaceId}`)
  return {}
}

/** Manda o magic link direto pro contato (convite/reenvio pelo admin). */
export async function enviarConvitePortal(
  workspaceId: string, portalUserId: string,
): Promise<{ error?: string }> {
  const ctx = await adminContext(workspaceId)
  if ('error' in ctx) return { error: ctx.error }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contato } = await (ctx.supabase as any)
    .from('portal_users').select('id, nome, email, ativo')
    .eq('id', portalUserId).eq('workspace_id', workspaceId).single()
  if (!contato) return { error: 'Contato não encontrado.' }
  if (!contato.ativo) return { error: 'Contato desativado — reative antes de convidar.' }

  const { data: org } = await ctx.supabase
    .from('organizations').select('name').eq('id', ctx.ws.org_id).single()
  const agencia = org?.name ?? 'a agência'

  const token = await criarTokenPortal(contato.id)
  const url = `${SITE_URL}/portal/entrar/${token}`
  const { error } = await sendMail({
    to: contato.email,
    subject: `Acompanhe seus trabalhos com a ${agencia} — Flow`,
    html: emailLayout({
      heading: 'Seu painel de acompanhamento',
      bodyHtml: `<p>Olá, ${contato.nome}!</p>
<p>A <b>${agencia}</b> preparou um painel pra você acompanhar as demandas em andamento: o que está com a agência, o que aguarda uma informação sua e o que está em aprovação.</p>
<p>O botão abaixo entra direto (o link vale por 30 minutos). Depois, é só acessar <b>${SITE_URL.replace(/^https?:\/\//, '')}/portal</b> e pedir um novo link com este e-mail.</p>`,
      cta: { label: 'Entrar no painel', url },
      footerNote: 'Se você não esperava este convite, ignore este e-mail.',
    }),
  })
  if (error) return { error: `Falha no envio: ${error}` }
  return {}
}
