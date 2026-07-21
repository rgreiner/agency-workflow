import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import type { ClienteOpt, VeiculoOpt, MemberOpt } from '@/app/(app)/[orgSlug]/midias/simplificada/MidiaForm'

/** Carrega os seletores (clientes+campanhas, veículos, membros) usados nos forms de mídia. */
export async function loadMidiaSelectors(orgSlug: string) {
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

  // Fornecedores entram aqui por causa da PRODUÇÃO da Mídia Externa: quando ela é
  // "De Terceiros", quem paga a comissão é o fornecedor, não o veículo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fornRaw } = await (supabase as any)
    .from('fornecedores').select('id, name').eq('org_id', org.id).eq('archived', false).order('name')
  const fornecedores = (fornRaw ?? []) as FornecedorOpt[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memRaw } = await (supabase as any)
    .from('organization_members').select('profiles!user_id(id, full_name, email)').eq('org_id', org.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members: MemberOpt[] = (memRaw ?? []).map((m: any) => ({
    id: m.profiles?.id, name: m.profiles?.full_name ?? m.profiles?.email ?? '—',
  })).filter((m: MemberOpt) => m.id)

  const today = new Date().toISOString().slice(0, 10)
  return { supabase, orgId: org.id as string, userId: user.id as string, clientes, veiculos, fornecedores, members, today }
}

export interface FornecedorOpt { id: string; name: string }

/** Seletores da Produção: clientes+campanhas, fornecedores, membros. */
export async function loadProducaoSelectors(orgSlug: string) {
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
  const { data: fornRaw } = await (supabase as any)
    .from('fornecedores').select('id, name').eq('org_id', org.id).eq('archived', false).order('name')
  const fornecedores = (fornRaw ?? []) as FornecedorOpt[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memRaw } = await (supabase as any)
    .from('organization_members').select('profiles!user_id(id, full_name, email)').eq('org_id', org.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members: MemberOpt[] = (memRaw ?? []).map((m: any) => ({
    id: m.profiles?.id, name: m.profiles?.full_name ?? m.profiles?.email ?? '—',
  })).filter((m: MemberOpt) => m.id)

  const today = new Date().toISOString().slice(0, 10)
  return { supabase, orgId: org.id as string, userId: user.id as string, clientes, fornecedores, members, today }
}
