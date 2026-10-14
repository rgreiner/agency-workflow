'use server'

/**
 * Portal do cliente — actions.
 * Lado público (sem sessão de membro): pedir magic link e entrar com o token.
 * Lado admin (sessão de membro owner/admin): gerenciar os contatos com acesso.
 */
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { headers } from 'next/headers'
import { sql } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'
import { createPortalClient } from '@/lib/supabase/portal'
import { getUsuario } from '@/lib/auth/server'
import { dispatchPushNotificacoes } from '@/lib/push'
import {
  buscarPortalUsersPorEmail, criarTokenPortal, consumirTokenPortal,
  iniciarSessaoPortal, encerrarSessaoPortal, sessaoPortal,
  verificarSenhaPortal, definirSenhaPortal, cadastrarPortalViaConvite,
} from '@/lib/auth/portal'
import { limiteEstourado, registrarTentativa, registrarBloqueio } from '@/lib/auth/rate-limit'
import { sendMail } from '@/lib/email/send'
import { emailLayout } from '@/lib/email/layout'
import { uploadToSubfolder } from '@/lib/task-folders'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

const MSG_PREVIEW = 'Você está vendo como o cliente. Só o cliente responde e decide por aqui.'

/** Sessão de "ver como cliente" (membro da agência) é só leitura. */
async function emPreview(): Promise<boolean> {
  return (await sessaoPortal())?.preview === true
}

// ── Lado público (cliente) ────────────────────────────────────────────────────

/**
 * Pede o link de acesso. Resposta SEMPRE genérica — não revela se o e-mail
 * está cadastrado.
 */
export async function solicitarAcessoPortal(formData: FormData): Promise<void> {
  const email = String(formData.get('email') || '').trim()
  if (!email) redirect('/portal?erro=campos')
  // Passou do limite? Devolve o mesmo "enviado" de sempre — a resposta genérica
  // é o que impede descobrir quais e-mails são contatos de cliente.
  if (await limiteEstourado('portal_magic', email)) {
    await registrarBloqueio('portal_magic', email)
    redirect('/portal?enviado=1')
  }
  await registrarTentativa('portal_magic', email, true)

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

/** Login por e-mail + senha (acesso recorrente). Mensagem genérica em erro. */
export async function loginPortalSenha(formData: FormData): Promise<void> {
  const email = String(formData.get('email') || '').trim()
  const senha = String(formData.get('senha') || '')
  if (!email || !senha) redirect('/portal?erro=campos')
  if (await limiteEstourado('portal', email)) {
    await registrarBloqueio('portal', email)
    redirect('/portal?erro=bloqueado')
  }

  const contato = await verificarSenhaPortal(email, senha)
  if (!contato) {
    await registrarTentativa('portal', email, false)
    redirect('/portal?erro=senha')
  }
  await registrarTentativa('portal', email, true)
  await iniciarSessaoPortal(contato)
  redirect('/portal/painel')
}

/** Cliente logado cria/troca a própria senha de acesso. */
export async function criarSenhaPortal(senha: string): Promise<{ error?: string }> {
  const claims = await sessaoPortal()
  if (!claims) return { error: 'Sessão expirada. Entre de novo.' }
  if (claims.preview) return { error: MSG_PREVIEW }
  if (senha.length < 6) return { error: 'A senha precisa de pelo menos 6 caracteres.' }
  await definirSenhaPortal(claims.portalSub, senha)
  return {}
}

/** Sai do portal. Quem estava vendo como cliente volta para a tela do Flow. */
export async function sairPortal(): Promise<void> {
  const claims = await sessaoPortal()
  await encerrarSessaoPortal()
  redirect(claims?.preview ? (claims.voltar ?? '/') : '/portal')
}

export interface PortalAnexo { chave: string; nome: string }

/** Responder uma pendência (tarefa em pendente_cliente do cliente). */
export async function responderPendencia(
  activityId: string, mensagem: string, anexos: PortalAnexo[],
): Promise<{ error?: string }> {
  if (await emPreview()) return { error: MSG_PREVIEW }
  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('portal_responder_pendencia', {
    p_activity_id: activityId,
    p_mensagem: mensagem,
    p_anexos: anexos,
  })
  if (error) return { error: 'Não foi possível enviar sua resposta. Tente de novo.' }
  // A RPC notifica o time no sino — empurra o push na hora, não na varredura.
  after(() => dispatchPushNotificacoes().catch(() => {}))
  return {}
}

/** Abrir uma solicitação nova (vira briefing pro atendimento). */
export async function criarSolicitacao(
  titulo: string, mensagem: string, anexos: PortalAnexo[],
): Promise<{ error?: string }> {
  if (await emPreview()) return { error: MSG_PREVIEW }
  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('portal_criar_solicitacao', {
    p_titulo: titulo,
    p_mensagem: mensagem,
    p_anexos: anexos,
  })
  if (error) return { error: 'Não foi possível enviar sua solicitação. Tente de novo.' }
  after(() => dispatchPushNotificacoes().catch(() => {}))
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
  if (await emPreview()) return { error: MSG_PREVIEW }
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
  // "Cliente APROVOU / pediu ajuste" é o push que o atendimento mais espera.
  after(() => dispatchPushNotificacoes().catch(() => {}))
  return {}
}

export interface EntradaCliente {
  id: string
  kind: 'resposta' | 'solicitacao' | 'aprovacao' | 'ajuste'
  pecas: ComentarioPeca[]
  activityId: string | null
  /** Aceite/ajuste de ORÇAMENTO no portal (mig. 342). */
  producaoId: string | null
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
    .select('id, kind, activity_id, producao_id, titulo, mensagem, anexos, pecas, status, created_at, ' +
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
    producaoId: r.producao_id ?? null,
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


// ── Cadastro pelo link (mig. 342) ─────────────────────────────────────────────

/**
 * O cliente se cadastra pelo link que a agência mandou: nome, e-mail e senha.
 * Entra direto no painel do cliente daquele link.
 */
export async function cadastrarPortal(token: string, formData: FormData): Promise<{ error?: string }> {
  const nome = String(formData.get('nome') || '').trim()
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const senha = String(formData.get('senha') || '')
  if (!nome || !email || !senha) return { error: 'Preencha nome, e-mail e senha.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Confira o e-mail.' }
  if (senha.trim().length < 6) return { error: 'A senha precisa de pelo menos 6 caracteres.' }

  if (await limiteEstourado('portal_magic', email)) {
    await registrarBloqueio('portal_magic', email)
    return { error: 'Muitas tentativas. Espere alguns minutos e tente de novo.' }
  }
  await registrarTentativa('portal_magic', email, true)

  const res = await cadastrarPortalViaConvite(token, nome, email, senha)
  if (res.erro === 'convite_invalido') return { error: 'Este link expirou. Peça um novo ao seu atendimento.' }
  if (res.erro === 'ja_tem_acesso') return { error: 'Este e-mail já tem acesso. Entre com a sua senha ou peça um link de acesso.' }
  if (res.erro || !res.user) return { error: 'Não foi possível criar o acesso. Tente de novo.' }

  await iniciarSessaoPortal(res.user)
  after(() => dispatchPushNotificacoes().catch(() => {}))
  redirect('/portal/painel')
}

/** Link de cadastro ATIVO do cliente (ou null). Só quem gere o portal enxerga. */
export async function linkCadastroAtivo(workspaceId: string): Promise<{ url: string; expiraEm: string; usos: number } | null> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('portal_convites')
    .select('token, expires_at, usos')
    .eq('workspace_id', workspaceId).is('revogado_em', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  return { url: `${SITE_URL}/portal/cadastro/${data.token}`, expiraEm: data.expires_at, usos: data.usos }
}

/** Gera um link de cadastro novo (30 dias). O anterior deixa de valer. */
export async function gerarLinkCadastro(
  orgSlug: string, workspaceId: string,
): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const { data: ws } = await supabase.from('workspaces').select('id, org_id').eq('id', workspaceId).single()
  if (!ws) return { error: 'Cliente não encontrado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const agora = new Date().toISOString()
  const { error: eRev } = await sb.from('portal_convites')
    .update({ revogado_em: agora }).eq('workspace_id', workspaceId).is('revogado_em', null)
  if (eRev) return { error: 'Sem permissão para gerar o link deste cliente.' }

  const token = randomBytes(24).toString('base64url')
  const { error } = await sb.from('portal_convites').insert({
    org_id: ws.org_id, workspace_id: workspaceId, token, created_by: user.id,
  })
  if (error) return { error: 'Sem permissão para gerar o link deste cliente.' }
  revalidatePath(`/${orgSlug}/workspaces/${workspaceId}`)
  return { url: `${SITE_URL}/portal/cadastro/${token}` }
}

/** Desativa o link de cadastro do cliente (quem já entrou continua entrando). */
export async function revogarLinkCadastro(orgSlug: string, workspaceId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('portal_convites')
    .update({ revogado_em: new Date().toISOString() }).eq('workspace_id', workspaceId).is('revogado_em', null)
  if (error) return { error: 'Não foi possível desativar o link.' }
  revalidatePath(`/${orgSlug}/workspaces/${workspaceId}`)
  return {}
}

// ── Ver como cliente (mig. 342) ───────────────────────────────────────────────

/** Abre o painel do cliente como ele vê, sem a senha dele. Só leitura. */
export async function verComoCliente(orgSlug: string, workspaceId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: id, error } = await (supabase as any).rpc('portal_preview_abrir', { p_workspace: workspaceId })
  if (error || !id) return { error: 'Sem permissão para abrir o painel deste cliente.' }
  await iniciarSessaoPortal(
    { id: String(id), email: '' },
    { preview: true, voltar: `/${orgSlug}/workspaces/${workspaceId}` },
  )
  redirect('/portal/painel')
}

// ── Orçamento no portal (mig. 342) ────────────────────────────────────────────

/** IP de quem decidiu (atrás do Traefik) — vai junto do aceite. */
async function ipDoPedido(): Promise<string> {
  const h = await headers()
  return ((h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || '-').slice(0, 64)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Cliente aprova o orçamento (situação vira 'aprovado') ou pede alteração.
 * Avisa por e-mail o responsável, o atendimento, os gerentes e o dono.
 */
export async function decidirOrcamento(
  producaoId: string, decisao: 'aprovado' | 'ajuste', mensagem: string,
): Promise<{ error?: string }> {
  if (await emPreview()) return { error: MSG_PREVIEW }
  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('portal_decidir_orcamento', {
    p_id: producaoId, p_decisao: decisao, p_mensagem: mensagem || null, p_ip: await ipDoPedido(),
  })
  if (error) {
    const msg = String(error.message ?? '')
    if (msg.includes('já foi respondido')) return { error: 'Este orçamento já foi respondido.' }
    if (msg.includes('Descreva o ajuste')) return { error: 'Conte o que precisa mudar.' }
    return { error: 'Não foi possível registrar. Tente de novo.' }
  }

  const r = data as {
    titulo: string; valor: number; contato: string; cliente: string; slug: string; destinatarios: string[]
  }
  after(async () => {
    await dispatchPushNotificacoes().catch(() => {})
    try {
      const ids = r.destinatarios ?? []
      if (!ids.length) return
      const quem = { nome: r.contato, cliente: r.cliente, slug: r.slug }
      const emails = await sql<{ email: string }[]>`select email from auth.users where id = any(${ids}::uuid[])`
      const aprovado = decisao === 'aprovado'
      const valor = Number(r.valor ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      const assunto = aprovado
        ? `✅ ${quem?.cliente ?? 'Cliente'} aprovou: ${r.titulo}`
        : `✏️ ${quem?.cliente ?? 'Cliente'} pediu alteração: ${r.titulo}`
      const html = emailLayout({
        heading: aprovado ? 'Orçamento aprovado pelo cliente' : 'Cliente pediu alteração no orçamento',
        bodyHtml: `<p><b>${esc(quem?.nome ?? 'O cliente')}</b> (${esc(quem?.cliente ?? '')}) ${aprovado ? 'aprovou' : 'pediu alteração em'} <b>${esc(r.titulo)}</b>, no valor de <b>${valor}</b>, pelo painel do cliente.</p>
${mensagem ? `<p style="padding:10px 12px;background:#f9fafb;border-radius:8px;">${esc(mensagem)}</p>` : ''}
<p>${aprovado ? 'A situação do orçamento já foi marcada como <b>aprovado</b> no Flow.' : 'O orçamento continua em aberto. Ajuste e mostre de novo ao cliente.'}</p>`,
        cta: quem?.slug ? { label: 'Abrir o orçamento', url: `${SITE_URL}/${quem.slug}/producao/orcamento/${producaoId}` } : undefined,
      })
      for (const { email } of emails) {
        await sendMail({ to: email, subject: assunto, html }).catch(() => {})
      }
    } catch (e) {
      console.error('[portal] falha no e-mail do orçamento:', e)
    }
  })
  return {}
}

/** Agência mostra (ou retira) o orçamento no painel do cliente. */
export async function publicarOrcamentoPortal(
  orgSlug: string, producaoId: string, publicar: boolean,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('orcamento_portal_publicar', {
    p_id: producaoId, p_publicar: publicar,
  })
  if (error) return { error: String(error.message ?? 'Não foi possível atualizar.') }
  revalidatePath(`/${orgSlug}/producao/orcamento/${producaoId}`)
  return {}
}

// ── Quadro: solicitar alteração (mig. 343) ────────────────────────────────────

const MIME_POR_EXT: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', txt: 'text/plain', doc: 'application/msword', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/**
 * Cliente pede alteração num trabalho do quadro (fora da aprovação). Não muda o
 * status: registra, avisa o atendimento e manda os anexos para a pasta Links da
 * tarefa, onde o time já procura referência.
 */
export async function solicitarAlteracao(
  activityId: string, mensagem: string, anexos: PortalAnexo[],
): Promise<{ error?: string }> {
  if (await emPreview()) return { error: MSG_PREVIEW }
  if (!mensagem.trim()) return { error: 'Conte o que precisa mudar.' }
  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('portal_solicitar_alteracao', {
    p_activity_id: activityId, p_mensagem: mensagem, p_anexos: anexos,
  })
  if (error) {
    if (String(error.message ?? '').includes('indisponível')) return { error: 'Este trabalho não aceita alteração por aqui agora.' }
    return { error: 'Não foi possível enviar. Tente de novo.' }
  }

  const r = data as { pasta_ref: string | null; org_id: string; workspace_id: string }
  after(async () => {
    await dispatchPushNotificacoes().catch(() => {})
    if (!r.pasta_ref || anexos.length === 0) return
    const prefixo = `portal-privado/${r.org_id}/${r.workspace_id}/`
    const raiz = process.env.UPLOAD_DIR || '/app/uploads'
    for (const a of anexos) {
      // Só arquivo que o próprio cliente subiu (a chave nasce no /api/portal/upload).
      if (!a.chave.startsWith(prefixo) || a.chave.includes('..')) continue
      try {
        const buf = await readFile(path.join(raiz, a.chave))
        const ext = (a.chave.split('.').pop() ?? '').toLowerCase()
        const nome = `Cliente - ${a.nome}`.replace(/[/\\]/g, '-').slice(0, 180)
        await uploadToSubfolder(r.pasta_ref, 'Links', nome, MIME_POR_EXT[ext] ?? 'application/octet-stream', buf)
      } catch (e) {
        // O anexo segue acessível em Solicitações; só não chegou à pasta.
        console.error('[portal] anexo não foi para a pasta Links:', e)
      }
    }
  })
  return {}
}
