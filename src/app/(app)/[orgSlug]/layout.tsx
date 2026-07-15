import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { AppShell } from '@/components/layout/AppShell'
import { OrgSettingsProvider } from '@/components/providers/OrgSettingsProvider'
import { UserPrefsProvider } from '@/components/providers/UserPrefsProvider'
import { ChatDock } from '@/components/chat/ChatDock'
import { TabUnreadBadge } from '@/components/layout/TabUnreadBadge'

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
    .select('role, can_finance, can_vendas, org_positions(name)')
    .eq('org_id', org.id)
    .eq('user_id', user.id)
    .single() as { data: { role: string; can_finance: boolean; can_vendas: boolean; org_positions: { name: string } | null } | null }

  if (!membership) redirect('/')

  // Permissões do Operacional: flag explícita ou implícita p/ owner/admin.
  // can_finance → submenus do Financeiro; can_vendas → Mídias/Produção/Cadastros.
  const isAdminRole = ['owner', 'admin'].includes(membership.role)
  const canFinance = membership.can_finance || isAdminRole
  const canVendas = membership.can_vendas || isAdminRole

  // Nome do cargo do usuário (ex.: "Redação") — vira o rótulo da aba de trabalho
  // no menu superior. Sem cargo (ex.: owner "acesso total") → fallback "Atendimento".
  const positionName =
    (membership.org_positions as unknown as { name: string } | null)?.name ?? null

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, drive_mac_user, drive_google_email')
    .eq('id', user.id)
    .single()

  const { data: workspacesRaw } = await supabase
    .from('workspaces')
    .select('id, name, color, campaigns(id, name)')
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

  // Membros da org (p/ o chat) — exceto eu mesmo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membersRaw } = await (supabase as any)
    .from('organization_members')
    .select('user_id, profiles!user_id(id, full_name, avatar_url)')
    .eq('org_id', org.id)
  const chatMembers = ((membersRaw ?? []) as { profiles: { id: string; full_name: string | null; avatar_url: string | null } | { id: string; full_name: string | null; avatar_url: string | null }[] | null }[])
    .map(m => (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles))
    .filter((p): p is { id: string; full_name: string | null; avatar_url: string | null } => !!p && p.id !== user.id)
    .map(p => ({ id: p.id, name: p.full_name ?? 'Sem nome', avatarUrl: p.avatar_url ?? null }))

  const orgSettings = {
    orgId:           org.id,
    logoUrl:         rawSettings?.logo_url ?? null,
    accentColor:     rawSettings?.accent_color ?? '#f97316',
    statusOverrides: (rawSettings?.status_overrides as unknown[] ?? []) as import('@/types').StatusOverride[],
  }

  const accent = orgSettings.accentColor

  return (
    <OrgSettingsProvider settings={orgSettings}>
      <UserPrefsProvider value={{
        orgSlug: org.slug,
        driveMacUser: (profile as { drive_mac_user?: string | null } | null)?.drive_mac_user ?? null,
        driveGoogleEmail: (profile as { drive_google_email?: string | null } | null)?.drive_google_email ?? null,
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
        canFinance={canFinance}
        canVendas={canVendas}
        canManage={membership.role === 'owner'}
      >
        {children}
      </AppShell>

      {/* Slot da modal (intercepting route do detalhe da tarefa) */}
      {modal}

      {/* Messenger interno — dock global no canto inferior direito */}
      <ChatDock orgId={org.id} orgSlug={orgSlug} meId={user.id} members={chatMembers} />

      {/* Total de não-lidas (inbox + chat) no título da aba */}
      <TabUnreadBadge />
      </UserPrefsProvider>
    </OrgSettingsProvider>
  )
}
