'use server'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string }
}

export interface LocalRh {
  id: string; nome: string; ips: string[]
  lat: number | null; lon: number | null; raio_m: number; ativo: boolean
}

export async function salvarLocal(orgSlug: string, id: string | null, dados: {
  nome: string; ips: string[]; lat: number | null; lon: number | null; raio_m: number; ativo: boolean
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  if (!dados.nome?.trim()) return { error: 'Dê um nome ao local.' }
  if (!dados.ips.length && (dados.lat == null || dados.lon == null)) {
    return { error: 'Informe ao menos o IP da rede ou a coordenada do local.' }
  }
  const linha = {
    nome: dados.nome.trim(), ips: dados.ips,
    lat: dados.lat, lon: dados.lon,
    raio_m: Math.max(20, dados.raio_m || 150), ativo: dados.ativo,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = c.supabase as any
  const { error } = id
    ? await sb.from('rh_local').update(linha).eq('id', id).eq('org_id', c.orgId)
    : await sb.from('rh_local').insert({ ...linha, org_id: c.orgId })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ponto`)
  return { ok: true }
}

export async function excluirLocal(orgSlug: string, id: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).from('rh_local').delete().eq('id', id).eq('org_id', c.orgId)
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ponto`)
  return { ok: true }
}

/** IP público de quem está acessando agora — para o RH cadastrar a rede da
 *  agência sem precisar procurar em site externo. */
export async function meuIp() {
  const h = await headers()
  return (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim() || null
}
