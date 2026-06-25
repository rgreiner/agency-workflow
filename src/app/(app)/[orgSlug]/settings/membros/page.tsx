import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { notFound } from 'next/navigation'
import { MemberRow } from './MemberRow'
import { InviteButton } from './InviteButton'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Proprietário',
  admin: 'Admin',
  manager: 'Gerente',
  member: 'Membro',
  viewer: 'Visualizador',
}

export default async function MembrosPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const user = await getUsuario()
  if (!user) notFound()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, max_members')
    .eq('slug', orgSlug)
    .single()
  if (!org) notFound()

  const { data: myMembership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', org.id)
    .eq('user_id', user.id)
    .single()

  const isAdmin = ['owner', 'admin'].includes(myMembership?.role ?? '')

  type MemberRowData = {
    id: string
    role: string
    position_id: string | null
    can_finance: boolean | null
    can_vendas: boolean | null
    profiles: { id: string; full_name: string | null; email: string; avatar_url: string | null } | null
    org_positions: { id: string; name: string; color: string } | null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membersRaw } = await (supabase as any)
    .from('organization_members')
    .select('id, role, position_id, can_finance, can_vendas, profiles!user_id(id, full_name, email, avatar_url), org_positions(id, name, color)')
    .eq('org_id', org.id)
    .order('joined_at', { ascending: true })
  const members = (membersRaw ?? []) as MemberRowData[]

  const { data: positions } = await supabase
    .from('org_positions')
    .select('id, name, color')
    .eq('org_id', org.id)
    .order('name')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-500">
          {members?.length ?? 0} de {org.max_members} membros
        </p>
        {isAdmin && (
          <InviteButton orgId={org.id} orgSlug={orgSlug} />
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Pessoa</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Cargo</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Papel</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Financeiro</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Vendas</th>
              {isAdmin && <th className="w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {members?.map((m) => {
              const profile = m.profiles as unknown as {
                id: string; full_name: string | null; email: string; avatar_url: string | null
              } | null
              const position = m.org_positions as unknown as { id: string; name: string; color: string } | null
              const isMe = profile?.id === user.id
              const isOwner = m.role === 'owner'

              return (
                <MemberRow
                  key={m.id}
                  memberId={m.id}
                  orgSlug={orgSlug}
                  orgId={org.id}
                  profile={profile}
                  position={position}
                  role={m.role}
                  canFinance={m.can_finance ?? false}
                  canVendas={m.can_vendas ?? false}
                  positions={positions ?? []}
                  isAdmin={isAdmin}
                  isMe={isMe}
                  isOwner={isOwner}
                  roleLabels={ROLE_LABELS}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
