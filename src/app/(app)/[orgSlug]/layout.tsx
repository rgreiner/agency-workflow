import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { lerSidebarPrefs } from '@/lib/sidebar-prefs'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { AppShell } from '@/components/layout/AppShell'
import { pendenciasDeTransicao } from '@/lib/midia-hub'
import { OrgSettingsProvider } from '@/components/providers/OrgSettingsProvider'
import { pautaListasDe } from '@/lib/atividade-titulo'
import { UserPrefsProvider } from '@/components/providers/UserPrefsProvider'
import { UsuarioProvider } from '@/components/providers/UsuarioProvider'
import { ChatDock } from '@/components/chat/ChatDock'
import { PontoPrompt } from '@/components/ponto/PontoPrompt'
import { PontoGate } from '@/components/ponto/PontoGate'
import { TabUnreadBadge } from '@/components/layout/TabUnreadBadge'
import { computeAccess, orgPorSlug, membershipAtiva } from '@/lib/auth/access'
import { membrosAtivos } from '@/lib/membros'
import { porNome } from '@/lib/utils'
import { configDaOrg, trilhaPendente, divergenciasFinanceiras } from '@/lib/org-cache'
import { Heartbeat } from '@/components/layout/Heartbeat'

export default async function OrgLayout({
  children,
  modal,
  painel,
  params,
}: {
  children: React.ReactNode
  modal: React.ReactNode
  /** Slot @painel — a página que quiser põe conteúdo no corpo da sidebar. */
  painel: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()
  // Casca (modo/recolhida/grupos/Espaços) já vem certa do servidor — ver lib/sidebar-prefs.
  const jar = await cookies()
  const sidebarPrefs = lerSidebarPrefs(n => jar.get(n)?.value)

  const user = await getUsuario()
  if (!user) redirect('/login')

  // As duas consultas abaixo têm cache por request (React cache): a página que
  // chamar getAccess() logo depois não repete nenhuma delas.
  const org = await orgPorSlug(orgSlug)
  if (!org) redirect('/')

  const membership = await membershipAtiva(org.id, user.id)
  if (!membership) redirect('/')

  // Acesso ao Operacional: cargo × toggles do membro (ver computeAccess).
  const access = computeAccess(membership)
  const positionName = access.positionName

  // Tudo daqui em diante depende só da org e do acesso — sai em PARALELO.
  // Antes eram 9 consultas em fila (cada uma esperando a anterior), refeitas a
  // cada navegação e a cada atualização automática da Lista/tarefa; medido em
  // 16/10/2026: ~13 transações/s no banco com pouca gente usando. Desde a Onda 2
  // da auditoria (31/10/2026), aparência/status/pauta, a trilha e as
  // divergências vêm de cache entre requests (lib/org-cache): sobram 4 idas ao
  // banco por navegação em vez de 9.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const sbx = supabase as any
  const [
    { data: profile },
    { data: workspacesRaw },
    config,
    onboardingPendente,
    midiaTransicao,
    financeAlertas,
    { data: membersRaw },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, avatar_url, drive_mac_user, drive_google_email, drive_lang')
      .eq('id', user.id)
      .single(),
    supabase
      .from('workspaces')
      .select('id, name, color, campaigns(id, name)')
      .order('name', { referencedTable: 'campaigns' })
      .eq('org_id', org.id)
      .eq('archived', false)
      .eq('campaigns.archived', false)
      .order('name'),
    // Aparência + cadastro de status (migration 168) + opções da pauta (285):
    // cache por org, invalidado pelas actions de Configurações.
    configDaOrg(sbx, org.id),
    // Trilha de primeiros passos: o item na sidebar só existe enquanto houver
    // etapa pendente — quem já entendeu não fica olhando pra ele. Cache por
    // pessoa, invalidado ao marcar/editar etapa.
    trilhaPendente(sbx, org.id, user.id),
    // Telas transitórias da Mídia (migrar rotinas, vincular entregas): o item só
    // existe enquanto houver o que fazer. Só para quem opera o Hub.
    access.midiaHub
      ? pendenciasDeTransicao(sbx, org.id)
      : Promise.resolve({ migrar: 0, vincular: 0 }),
    // Contas cujo saldo no Flow não bate com o banco NA DATA DO ÚLTIMO OFX, fora o
    // que ainda está na fila de conciliação (migs. 347/348). Acende o Financeiro.
    // Cache de 60 s por org: a RPC soma o extrato inteiro conta a conta.
    access.financeiro ? divergenciasFinanceiras(sbx, org.id) : Promise.resolve(0),
    // Membros da org (p/ o chat) — quem foi arquivado não entra.
    membrosAtivos(supabase, org.id, 'user_id, profiles!user_id(id, full_name, avatar_url)'),
  ])
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const workspaces = (workspacesRaw ?? []).map(ws => ({
    id: ws.id,
    name: ws.name,
    color: ws.color,
    campaigns: (ws.campaigns as unknown as { id: string; name: string }[]) ?? [],
  }))
  // Conversa nova não se abre com quem saiu da agência nem comigo mesmo.
  const chatMembers = ((membersRaw ?? []) as { profiles: { id: string; full_name: string | null; avatar_url: string | null } | { id: string; full_name: string | null; avatar_url: string | null }[] | null }[])
    .map(m => (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles))
    .filter((p): p is { id: string; full_name: string | null; avatar_url: string | null } => !!p && p.id !== user.id)
    .map(p => ({ id: p.id, name: p.full_name ?? 'Sem nome', avatarUrl: p.avatar_url ?? null }))
    .sort(porNome(m => m.name))

  const orgSettings = {
    orgId:           org.id,
    logoUrl:         config.settings?.logo_url ?? null,
    accentColor:     config.settings?.accent_color ?? '#ff6a00',
    statusOverrides: (config.settings?.status_overrides as unknown[] ?? []) as import('@/types').StatusOverride[],
    statuses:        config.statuses,
    pauta:           pautaListasDe(config.pauta),
  }

  const accent = orgSettings.accentColor

  return (
    <OrgSettingsProvider settings={orgSettings}>
      {/* Quem está logado, para os client components. Vem daqui porque o token
          virou httpOnly — o browser não decodifica mais o JWT pra se descobrir. */}
      <UsuarioProvider value={{ id: user.id, email: user.email ?? '' }}>
      <UserPrefsProvider value={{
        orgSlug: org.slug,
        driveMacUser: (profile as { drive_mac_user?: string | null } | null)?.drive_mac_user ?? null,
        driveGoogleEmail: (profile as { drive_google_email?: string | null } | null)?.drive_google_email ?? null,
        driveLang: (profile as { drive_lang?: string | null } | null)?.drive_lang ?? 'pt',
      }}>
      {/* Inject accent color as CSS variable */}
      <style>{`:root { --accent: ${accent}; }`}</style>

      <AppShell
        orgSlug={org.slug}
        orgName={org.name}
        userEmail={user.email ?? ''}
        userAvatar={profile?.avatar_url}
        userName={profile?.full_name ?? null}
        workspaces={workspaces}
        logoUrl={orgSettings.logoUrl}
        accentColor={accent}
        positionName={positionName}
        trabalharHref={access.trabalharHref}
        canMidias={access.midias}
        canProducao={access.producao}
        canFinance={access.financeiro}
        canCadastros={access.cadastros}
        canRh={access.rh}
        canMidiaHub={access.midiaHub}
        canManage={access.isOwner}
        canListaGlobal={access.listaGlobal}
        onboardingPendente={onboardingPendente}
        midiaTransicao={midiaTransicao}
        financeAlertas={financeAlertas}
        painel={painel}
        prefs={sidebarPrefs}
      >
        {children}
      </AppShell>

      {/* Slot da modal (intercepting route do detalhe da tarefa) */}
      {modal}

      {/* O único timer da aba: inbox, chat, presença e ponto numa batida a cada 30 s */}
      <Heartbeat orgId={org.id} memberIds={chatMembers.map(m => m.id)} />

      {/* Messenger interno — dock global no canto inferior direito */}
      <ChatDock orgId={org.id} orgSlug={orgSlug} meId={user.id} members={chatMembers} />
      {/* Lembrete de ponto: card no canto perto dos horários da jornada +
          preventivo (trabalhando sem ponto aberto). Sem ficha vinculada, nada. */}
      <PontoPrompt orgSlug={orgSlug} />
      <PontoGate orgSlug={orgSlug} />

      {/* Total de não-lidas (inbox + chat) no título da aba */}
      <TabUnreadBadge />
      </UserPrefsProvider>
      </UsuarioProvider>
    </OrgSettingsProvider>
  )
}
