import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { createMidia } from '@/app/actions/midia'
import type { ClienteOpt, VeiculoOpt, MemberOpt } from '../../simplificada/MidiaForm'
import { ImpressaForm } from '../ImpressaForm'

export default async function NovaImpressaPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) redirect('/login')

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) redirect('/')

  const { data: wsRaw } = await supabase
    .from('workspaces').select('id, name, campaigns(id, name)')
    .eq('org_id', org.id).eq('archived', false).eq('campaigns.archived', false).order('name')
  const clientes: ClienteOpt[] = (wsRaw ?? []).map(w => ({
    id: w.id, name: w.name, campaigns: (w.campaigns as unknown as { id: string; name: string }[]) ?? [],
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: veicRaw } = await (supabase as any)
    .from('veiculos').select('id, name, commission_pct').eq('org_id', org.id).eq('archived', false).order('name')
  const veiculos = (veicRaw ?? []) as VeiculoOpt[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memRaw } = await (supabase as any)
    .from('organization_members').select('profiles!user_id(id, full_name, email)').eq('org_id', org.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members: MemberOpt[] = (memRaw ?? []).map((m: any) => ({
    id: m.profiles?.id, name: m.profiles?.full_name ?? m.profiles?.email ?? '—',
  })).filter((m: MemberOpt) => m.id)

  const today = new Date().toISOString().slice(0, 10)

  return (
    <ImpressaForm
      clientes={clientes}
      veiculos={veiculos}
      members={members}
      defaultResponsavelId={user.id}
      today={today}
      redirectTo={`/${orgSlug}/midias/impressa`}
      submitLabel="Gravar"
      onSubmit={createMidia.bind(null, orgSlug)}
    />
  )
}
