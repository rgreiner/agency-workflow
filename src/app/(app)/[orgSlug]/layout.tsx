import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopNav } from '@/components/layout/TopNav'

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
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

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar
        orgSlug={org.slug}
        orgName={org.name}
        userEmail={user.email ?? ''}
        userAvatar={profile?.avatar_url}
        userName={profile?.full_name ?? null}
        workspaces={workspaces}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopNav
          orgSlug={org.slug}
          orgName={org.name}
          workspaces={workspaces}
        />
        <main className="flex-1 overflow-y-auto min-w-0">
          <div className="pt-12 md:pt-0 h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
