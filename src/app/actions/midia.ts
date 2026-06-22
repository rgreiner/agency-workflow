'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

const FIELDS = [
  'workspace_id', 'campaign_id', 'veiculo_id', 'tipo', 'titulo', 'emissao', 'job',
  'aut_veiculo', 'codigo_identificador', 'nota_fiscal', 'pecas', 'praca', 'abrangencia',
  'valor', 'desconto_pct', 'faturamento', 'prazo', 'data_base', 'dias_agencia',
  'primeira_veiculacao', 'ultima_veiculacao', 'contato', 'responsavel_id', 'situacao',
  'observacao', 'texto_legal',
] as const

function readMidiaData(formData: FormData) {
  const data: Record<string, string> = {}
  for (const f of FIELDS) data[f] = ((formData.get(f) as string) ?? '').trim()
  return data
}

export async function createMidia(orgSlug: string, formData: FormData) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const data = readMidiaData(formData)
  if (!data.workspace_id) return { error: 'Cliente obrigatório' }
  if (!data.veiculo_id) return { error: 'Veículo obrigatório' }
  if (!data.titulo) return { error: 'Título obrigatório' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('create_midia', {
    p_user_id: user.id, p_org_id: org.id, p_data: data,
  })
  if (error) return { error: error.message }

  redirect(`/${orgSlug}/midias/simplificada`)
}

export async function updateMidia(orgSlug: string, midiaId: string, formData: FormData) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const data = readMidiaData(formData)
  if (!data.titulo) return { error: 'Título obrigatório' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('update_midia', {
    p_user_id: user.id, p_midia_id: midiaId, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midias/simplificada`)
  redirect(`/${orgSlug}/midias/simplificada`)
}

export async function setMidiaSituacao(orgSlug: string, midiaId: string, situacao: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_midia_situacao', {
    p_user_id: user.id, p_midia_id: midiaId, p_situacao: situacao,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midias/simplificada`)
}

export async function setMidiaArchived(orgSlug: string, midiaId: string, archived: boolean) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_midia_archived', {
    p_user_id: user.id, p_midia_id: midiaId, p_archived: archived,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midias/simplificada`)
}
