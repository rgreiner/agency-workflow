import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { runHealthChecks } from '@/lib/health/checks'

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const user = await getUsuario()
  if (!user) notFound()

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role, organizations(name)')
    .eq('user_id', user.id)
    .single()

  if (!membership) notFound()

  const isAdmin = ['owner', 'admin'].includes(membership.role)
  const orgName = (membership.organizations as { name: string } | null)?.name

  // Contagens p/ os badges das abas (só admin as vê): erros em aberto + divergências.
  let errosPendentes = 0
  let verificacoesPendentes = 0
  if (isAdmin) {
    const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
    if (org) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = await (supabase as any)
        .from('system_errors')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.id)
        .eq('resolved', false)
      errosPendentes = count ?? 0

      const checks = await runHealthChecks(supabase, org.id)
      verificacoesPendentes = checks.reduce((n, c) => n + c.items.length, 0)
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900">Configurações</h1>
        <p className="text-gray-500 text-sm mt-0.5">{orgName}</p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {[
          { href: `/${orgSlug}/settings/membros`,   label: 'Membros',          badge: 0 },
          ...(isAdmin ? [
            { href: `/${orgSlug}/settings/cargos`,    label: 'Cargos',           badge: 0 },
            { href: `/${orgSlug}/settings/aparencia`, label: 'Aparência',        badge: 0 },
            { href: `/${orgSlug}/settings/saude`,     label: 'Verificações',     badge: verificacoesPendentes },
            { href: `/${orgSlug}/settings/erros`,     label: 'Erros do sistema', badge: errosPendentes },
          ] : []),
        ].map(({ href, label, badge }) => (
          <Link
            key={href}
            href={href}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 border-b-2 border-transparent hover:border-gray-300 transition -mb-px inline-flex items-center gap-2"
          >
            {label}
            {badge > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold leading-none">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </Link>
        ))}
      </div>

      {children}
    </div>
  )
}
