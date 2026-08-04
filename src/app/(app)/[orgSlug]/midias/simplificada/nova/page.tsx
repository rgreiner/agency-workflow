import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { createMidia } from '@/app/actions/midia'
import { midiaTextoLegalPadrao } from '@/lib/agency'
import { membrosAtivos } from '@/lib/membros'
import { MidiaForm, type ClienteOpt, type VeiculoOpt, type MemberOpt } from '../MidiaForm'

export default async function NovaMidiaPage({
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

  // Clientes (workspaces) + campanhas ativas
  const { data: wsRaw } = await supabase
    .from('workspaces')
    .select('id, name, campaigns(id, name)')
    .order('name', { referencedTable: 'campaigns' })
    .eq('org_id', org.id)
    .eq('archived', false)
    .eq('campaigns.archived', false)
    .order('name')
  const clientes: ClienteOpt[] = (wsRaw ?? []).map(w => ({
    id: w.id, name: w.name,
    campaigns: (w.campaigns as unknown as { id: string; name: string }[]) ?? [],
  }))

  // Veículos ativos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: veicRaw } = await (supabase as any)
    .from('veiculos').select('id, name, commission_pct')
    .eq('org_id', org.id).eq('archived', false).order('name')
  const veiculos = (veicRaw ?? []) as VeiculoOpt[]

  // Membros (para Responsável) — sem os arquivados.
  const { data: memRaw } = await membrosAtivos(supabase, org.id, 'profiles!user_id(id, full_name, email)')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members: MemberOpt[] = (memRaw ?? []).map((m: any) => ({
    id: m.profiles?.id, name: m.profiles?.full_name ?? m.profiles?.email ?? '—',
  })).filter((m: MemberOpt) => m.id)

  const today = new Date().toISOString().slice(0, 10)
  const defaultTextoLegal = await midiaTextoLegalPadrao(supabase, org.id)

  return (
    <MidiaForm
      clientes={clientes}
      veiculos={veiculos}
      members={members}
      defaultResponsavelId={user.id}
      today={today}
      submitLabel="Gravar"
      defaultTextoLegal={defaultTextoLegal}
      onSubmit={createMidia.bind(null, orgSlug)}
    />
  )
}
