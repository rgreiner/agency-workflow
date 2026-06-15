import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { notFound } from 'next/navigation'
import { STATUS_CONFIG } from '@/types'
import { PositionCard } from './PositionCard'
import { NewPositionForm } from './NewPositionForm'

export default async function CargosPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const user = await getUsuario()
  if (!user) notFound()

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) notFound()

  const { data: myMembership } = await supabase
    .from('organization_members')
    .select('role').eq('org_id', org.id).eq('user_id', user.id).single()

  if (!['owner', 'admin'].includes(myMembership?.role ?? '')) notFound()

  const { data: positions } = await supabase
    .from('org_positions')
    .select('id, name, color, allowed_statuses')
    .eq('org_id', org.id)
    .order('name')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-500">
          {positions?.length ?? 0} cargo{positions?.length !== 1 ? 's' : ''} configurado{positions?.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="space-y-4">
        {positions?.map((pos) => (
          <PositionCard
            key={pos.id}
            position={pos as {
              id: string; name: string; color: string
              allowed_statuses: string[]
            }}
            orgSlug={orgSlug}
          />
        ))}

        <NewPositionForm orgSlug={orgSlug} />
      </div>
    </div>
  )
}
