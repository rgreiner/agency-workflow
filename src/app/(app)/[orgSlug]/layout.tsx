import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { AppShell } from '@/components/layout/AppShell'
import { OrgSettingsProvider } from '@/components/providers/OrgSettingsProvider'

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode
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

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', org.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) redirect('/')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, avatar_url')
    .eq('id', user.id)
    .single()

  const { data: workspacesRaw } = await supabase
    .from('workspaces')
    .select('id, name, color, campaigns(id, name)')
    .eq('org_id', org.id)
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

  const orgSettings = {
    orgId:           org.id,
    logoUrl:         rawSettings?.logo_url ?? null,
    accentColor:     rawSettings?.accent_color ?? '#6366f1',
    statusOverrides: (rawSettings?.status_overrides as unknown[] ?? []) as import('@/types').StatusOverride[],
  }

  const accent = orgSettings.accentColor

  return (
    <OrgSettingsProvider settings={orgSettings}>
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
      >
        {children}
      </AppShell>
    </OrgSettingsProvider>
  )
}
