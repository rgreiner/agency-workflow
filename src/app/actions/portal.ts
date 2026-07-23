'use server'

/**
 * Portal do cliente — actions.
 * Lado público (sem sessão de membro): pedir magic link e entrar com o token.
 * Lado admin (sessão de membro owner/admin): gerenciar os contatos com acesso.
 */
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createPortalClient } from '@/lib/supabase/portal'
import { getUsuario } from '@/lib/auth/server'
import {
  buscarPortalUsersPorEmail, criarTokenPortal, consumirTokenPortal,
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

  // Um link POR cliente em que a pessoa é contato (normalmente só um).
  const contatos = await buscarPortalUsersPorEmail(email)
  for (const contato of contatos) {
    try {
      const supabase = await createClient()
      const { data: ws } = await supabase
        .from('workspaces').select('name').eq('id', contato.workspace_id).single()
      const cliente = ws?.name ?? null

      const token = await criarTokenPortal(contato.id)
      const url = `${SITE_URL}/portal/entrar/${token}`
      const { error } = await sendMail({
        to: contato.email,
        subject: cliente ? `Seu acesso ao painel — ${cliente}` : 'Seu acesso ao painel — Flow',
        html: emailLayout({
          heading: 'Acesse o seu painel',
          bodyHtml: `<p>Olá, ${contato.nome}!</p>
<p>Toque no botão abaixo pra entrar no painel de acompanhamento${cliente ? ` de <b>${cliente}</b>` : ''}. O link vale por 30 minutos e só funciona uma vez.</p>`,
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

export interface PortalAnexo { chave: string; nome: string }

/** Responder uma pendência (tarefa em pendente_cliente do cliente). */
export async function responderPendencia(
  activityId: string, mensagem: string, anexos: PortalAnexo[],
): Promise<{ error?: string }> {
  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('portal_responder_pendencia', {
    p_activity_id: activityId,
    p_mensagem: mensagem,
    p_anexos: anexos,
  })
  if (error) return { error: 'Não foi possível enviar sua resposta. Tente de novo.' }
  return {}
}

/** Abrir uma solicitação nova (vira briefing pro atendimento). */
export async function criarSolicitacao(
  titulo: string, mensagem: string, anexos: PortalAnexo[],
): Promise<{ error?: string }> {
  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('portal_criar_solicitacao', {
    p_titulo: titulo,
    p_mensagem: mensagem,
    p_anexos: anexos,
  })
  if (error) return { error: 'Não foi possível enviar sua solicitação. Tente de novo.' }
  return {}
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

export interface ComentarioPeca { nome: string; comentario: string }

/**
 * Registra a decisão do cliente sobre as peças: aceite formal ou pedido de
 * ajuste. Nenhum dos dois muda o status da tarefa — o atendimento é notificado
 * e decide o próximo passo.
 */
export async function registrarDecisao(
  activityId: string,
  decisao: 'aprovado' | 'ajuste',
  mensagem: string,
  pecas: ComentarioPeca[],
): Promise<{ error?: string }> {
  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('portal_registrar_decisao', {
    p_activity_id: activityId,
    p_decisao: decisao,
    p_mensagem: mensagem || null,
    p_pecas: pecas,
  })
  if (error) {
    const msg = String(error.message ?? '')
    if (msg.includes('já foi respondido')) return { error: 'Este trabalho já foi respondido.' }
    if (msg.includes('Descreva o ajuste')) return { error: 'Conte o que precisa ser ajustado.' }
    return { error: 'Não foi possível registrar. Tente de novo.' }
  }
  return {}
}

export interface EntradaCliente {
  id: string
  kind: 'resposta' | 'solicitacao' | 'aprovacao' | 'ajuste'
  pecas: ComentarioPeca[]
  activityId: string | null
  titulo: string | null
  mensagem: string
  anexos: PortalAnexo[]
  status: 'novo' | 'lido' | 'arquivado'
  createdAt: string
  clienteNome: string
  workspaceId: string
  workspaceNome: string
  campaignId: string | null
  atividadeTitulo: string | null
}

/** Lista as entradas do cliente (respostas + solicitações) da org, pro atendimento. */
export async function listarEntradasCliente(
  orgSlug: string, status: 'novo' | 'lido' | 'arquivado' | 'todos' = 'novo',
): Promise<{ items: EntradaCliente[]; podeGerir: boolean }> {
  const supabase = await createClient()
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { items: [], podeGerir: false }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pode } = await (supabase as any).rpc('portal_pode_gerir', { p_org: org.id })
  if (!pode) return { items: [], podeGerir: false }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from('portal_entries')
    .select('id, kind, activity_id, titulo, mensagem, anexos, pecas, status, created_at, ' +
            'workspace:workspaces!workspace_id(id, name), portal_user:portal_users!portal_user_id(nome), ' +
            'activity:activities!activity_id(title, campaign_id)')
    .eq('org_id', org.id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (status !== 'todos') q = q.eq('status', status)

  const { data } = await q
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: EntradaCliente[] = (data ?? []).map((r: any) => ({
    id: r.id,
    kind: r.kind,
    activityId: r.activity_id,
    titulo: r.titulo,
    mensagem: r.mensagem,
    anexos: Array.isArray(r.anexos) ? r.anexos : [],
    pecas: Array.isArray(r.pecas) ? r.pecas : [],
    status: r.status,
    createdAt: r.created_at,
    clienteNome: r.portal_user?.nome ?? 'Cliente',
    workspaceId: r.workspace?.id ?? '',
    workspaceNome: r.workspace?.name ?? '',
    campaignId: r.activity?.campaign_id ?? null,
    atividadeTitulo: r.activity?.title ?? null,
  }))
  return { items, podeGerir: true }
}

/** Marca uma entrada como lida/arquivada/novo (atendimento). */
export async function setEntradaStatus(
  orgSlug: string, entryId: string, status: 'novo' | 'lido' | 'arquivado',
): Promise<{ error?: string }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('portal_entries').update({ status }).eq('id', entryId)
  if (error) return { error: 'Não foi possível atualizar (sem permissão?).' }
  revalidatePath(`/${orgSlug}/solicitacoes`)
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
