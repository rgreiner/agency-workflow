import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role, organizations(name)')
    .eq('user_id', user.id)
    .single()

  if (!membership) notFound()

  const isAdmin = ['owner', 'admin'].includes(membership.role)
  const orgName = (membership.organizations as { name: string } | null)?.name

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Configurações</h1>
        <p className="text-gray-500 text-sm mt-1">{orgName}</p>
      </div>

      <div className="flex gap-1 mb-8 border-b border-gray-200">
        {[
          { href: `/${orgSlug}/settings/membros`, label: 'Membros' },
          ...(isAdmin ? [{ href: `/${orgSlug}/settings/cargos`, label: 'Cargos' }] : []),
        ].map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 border-b-2 border-transparent hover:border-gray-300 transition -mb-px"
          >
            {label}
          </Link>
        ))}
      </div>

      {children}
    </div>
  )
}
