import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { AppShell } from '@/components/layout/AppShell'
import { OrgSettingsProvider } from '@/components/providers/OrgSettingsProvider'
import { UserPrefsProvider } from '@/components/providers/UserPrefsProvider'
import { UsuarioProvider } from '@/components/providers/UsuarioProvider'
import { ChatDock } from '@/components/chat/ChatDock'
import { PontoPrompt } from '@/components/ponto/PontoPrompt'
import { PontoGate } from '@/components/ponto/PontoGate'
import { TabUnreadBadge } from '@/components/layout/TabUnreadBadge'
import { computeAccess, ACCESS_SELECT, type MembershipRow } from '@/lib/auth/access'
import { membrosAtivos } from '@/lib/membros'
import { porNome } from '@/lib/utils'

export default async function OrgLayout({
  children,
  modal,
  params,
}: {
  children: React.ReactNode
  modal: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const user = await getUsuario()
  if (!user) redirect('/login')

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', orgSlug)
    .single()

  if (!org) redirect('/')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase as any)
    .from('organization_members')
    .select(ACCESS_SELECT)
    .eq('org_id', org.id)
    .eq('user_id', user.id)
    .eq('arquivado', false)
    .maybeSingle() as { data: MembershipRow | null }

  if (!membership) redirect('/')

  // Acesso ao Operacional: cargo × toggles do membro (ver computeAccess).
  const access = computeAccess(membership)
  const positionName = access.positionName

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, drive_mac_user, drive_google_email, drive_lang')
    .eq('id', user.id)
    .single()

  const { data: workspacesRaw } = await supabase
    .from('workspaces')
    .select('id, name, color, campaigns(id, name)')
    .order('name', { referencedTable: 'campaigns' })
    .eq('org_id', org.id)
    .eq('archived', false)
    .eq('campaigns.archived', false)
    .order('name')

  const workspaces = (workspacesRaw ?? []).map(ws => ({
    id: ws.id,
    name: ws.name,
    color: ws.color,
    campaigns: (ws.campaigns as unknown as { id: string; name: string }[]) ?? [],
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawSettings } = await (supabase as any)
    .from('org_settings')
    .select('logo_url, accent_color, status_overrides')
    .eq('org_id', org.id)
    .single() as { data: { logo_url: string | null; accent_color: string; status_overrides: unknown[] } | null }

  // Trilha de primeiros passos: o item na sidebar só existe enquanto houver
  // etapa pendente — quem já entendeu não fica olhando pra ele.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: trilhaRaw } = await (supabase as any).rpc('onboarding_trilha', { p_org_id: org.id })
  const onboardingPendente = ((trilhaRaw ?? []) as { concluido: boolean }[]).filter(e => !e.concluido).length

  // Membros da org (p/ o chat) — exceto eu mesmo e quem foi arquivado: não se abre
  // conversa nova com quem saiu da agência.
  const { data: membersRaw } = await membrosAtivos(supabase, org.id, 'user_id, profiles!user_id(id, full_name, avatar_url)')
  const chatMembers = ((membersRaw ?? []) as { profiles: { id: string; full_name: string | null; avatar_url: string | null } | { id: string; full_name: string | null; avatar_url: string | null }[] | null }[])
    .map(m => (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles))
    .filter((p): p is { id: string; full_name: string | null; avatar_url: string | null } => !!p && p.id !== user.id)
    .map(p => ({ id: p.id, name: p.full_name ?? 'Sem nome', avatarUrl: p.avatar_url ?? null }))
    .sort(porNome(m => m.name))

  // Cadastro de status da org (migration 168) — fonte única do app inteiro.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: statusRows } = await (supabase as any)
    .from('org_status')
    .select('valor, label, grupo, bg, txt, ordem, papel')
    .eq('org_id', org.id)
    .order('ordem') as { data: import('@/types').OrgStatusRow[] | null }

  const orgSettings = {
    orgId:           org.id,
    logoUrl:         rawSettings?.logo_url ?? null,
    accentColor:     rawSettings?.accent_color ?? '#f97316',
    statusOverrides: (rawSettings?.status_overrides as unknown[] ?? []) as import('@/types').StatusOverride[],
    statuses:        statusRows ?? [],
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
        canMidias={access.midias}
        canProducao={access.producao}
        canFinance={access.financeiro}
        canCadastros={access.cadastros}
        canRh={access.rh}
        canMidiaHub={access.midiaHub}
        canManage={access.isOwner}
        canListaGlobal={access.listaGlobal}
        onboardingPendente={onboardingPendente}
      >
        {children}
      </AppShell>

      {/* Slot da modal (intercepting route do detalhe da tarefa) */}
      {modal}

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
