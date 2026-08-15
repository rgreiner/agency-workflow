import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { notFound } from 'next/navigation'
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: positions } = await (supabase as any)
    .from('org_positions')
    .select('id, name, color, allowed_statuses, op_ver_tudo, op_midias, op_producao, op_midia_hub')
    .eq('org_id', org.id)
    .order('name') as { data: { id: string; name: string; color: string; allowed_statuses: string[]; op_ver_tudo: boolean; op_midias: boolean; op_producao: boolean; op_midia_hub: boolean }[] | null }

  return (
    <div className="max-w-5xl">
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
              op_ver_tudo: boolean; op_midias: boolean; op_producao: boolean; op_midia_hub: boolean
            }}
            orgSlug={orgSlug}
          />
        ))}

        <NewPositionForm orgSlug={orgSlug} />
      </div>
    </div>
  )
}
