'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

const FIELDS = [
  'tipo', 'workspace_id', 'campaign_id', 'titulo', 'faturar', 'emissao', 'validade_dias',
  'bv_pct', 'honorarios_pct', 'valor', 'codigo_identificador', 'nota_fiscal', 'situacao',
  'observacao', 'texto_legal', 'contato', 'responsavel_id',
] as const

function readData(formData: FormData) {
  const data: Record<string, string> = {}
  for (const f of FIELDS) data[f] = ((formData.get(f) as string) ?? '').trim()
  return data
}
function readDetalhe(formData: FormData): unknown {
  try { return JSON.parse((formData.get('detalhe') as string) || '{}') } catch { return {} }
}

export async function createProducao(orgSlug: string, formData: FormData) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const data = readData(formData)
  const redirectTo = ((formData.get('redirect_to') as string) ?? '').trim()
  if (!data.workspace_id) return { error: 'Cliente obrigatório' }
  if (!data.titulo) return { error: 'Título obrigatório' }

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  const payload = { ...data, detalhe: readDetalhe(formData) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('create_producao', { p_user_id: user.id, p_org_id: org.id, p_data: payload })
  if (error) return { error: error.message }
  redirect(redirectTo || `/${orgSlug}/producao/orcamento`)
}

export async function updateProducao(orgSlug: string, producaoId: string, formData: FormData) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const data = readData(formData)
  const redirectTo = ((formData.get('redirect_to') as string) ?? '').trim()
  if (!data.titulo) return { error: 'Título obrigatório' }

  const payload = { ...data, detalhe: readDetalhe(formData) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('update_producao', { p_user_id: user.id, p_producao_id: producaoId, p_data: payload })
  if (error) return { error: error.message }
  const dest = redirectTo || `/${orgSlug}/producao/orcamento`
  revalidatePath(dest)
  redirect(dest)
}

export async function setProducaoSituacao(orgSlug: string, producaoId: string, situacao: string, basePath: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_producao_situacao', { p_user_id: user.id, p_producao_id: producaoId, p_situacao: situacao })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/${basePath}`)
}

export async function setProducaoArchived(orgSlug: string, producaoId: string, archived: boolean, basePath: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_producao_archived', { p_user_id: user.id, p_producao_id: producaoId, p_archived: archived })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/${basePath}`)
}
