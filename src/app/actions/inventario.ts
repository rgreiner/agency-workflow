'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

export interface InventarioPonto {
  codigo: string
  face?: string | null
  tipo_midia?: string | null
  cidade?: string | null
  bairro?: string | null
  logradouro?: string | null
  numero?: string | null
  referencia?: string | null
  endereco_full?: string | null
  lat?: number | null
  lng?: number | null
  foto_url?: string | null
}

/** Grava (upsert) os pontos revisados na prévia do import. */
export async function salvarInventario(orgSlug: string, veiculoId: string, formato: string, pontos: InventarioPonto[]) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('upsert_inventario_pontos', {
    p_user_id: user.id, p_org_id: org.id, p_veiculo_id: veiculoId,
    p_formato: formato || 'logycware',
    p_pontos: pontos.map(p => ({
      codigo: p.codigo, face: p.face ?? null, tipo_midia: p.tipo_midia ?? null,
      cidade: p.cidade ?? null, bairro: p.bairro ?? null, logradouro: p.logradouro ?? null,
      numero: p.numero ?? null, referencia: p.referencia ?? null, endereco_full: p.endereco_full ?? null,
      lat: p.lat ?? null, lng: p.lng ?? null, foto_url: p.foto_url ?? null,
    })),
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/cadastros/veiculos`)
  return { result: data as { ok: boolean; processados: number } }
}

export interface InventarioPontoRef {
  codigo: string
  tipo_midia: string | null
  cidade: string | null
  endereco_full: string | null
  lat: number | null
  lng: number | null
  foto_url: string | null
}

/** Lista os pontos do inventário de um veículo (pro autofill da MX). RLS garante a org. */
export async function listarInventario(veiculoId: string): Promise<InventarioPontoRef[]> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user || !veiculoId) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('veiculo_inventario')
    .select('codigo, tipo_midia, cidade, endereco_full, lat, lng, foto_url')
    .eq('veiculo_id', veiculoId).eq('ativo', true)
    .order('codigo', { ascending: true })
  return (data ?? []) as InventarioPontoRef[]
}
