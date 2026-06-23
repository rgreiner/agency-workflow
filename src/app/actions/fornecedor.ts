'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

function readData(formData: FormData) {
  const get = (k: string) => ((formData.get(k) as string) ?? '').trim()
  const j = (k: string) => { try { return JSON.parse((formData.get(k) as string) || '[]') } catch { return [] } }
  return {
    name: get('name'), tipo: get('tipo'), tax_id: get('tax_id'), notes: get('notes'),
    enderecos: j('enderecos'), telefones: j('telefones'), emails: j('emails'), contas_bancarias: j('contas_bancarias'),
  }
}

export async function createFornecedor(orgSlug: string, formData: FormData) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const data = readData(formData)
  if (!data.name) return { error: 'Nome obrigatório' }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('create_fornecedor', { p_user_id: user.id, p_org_id: org.id, p_data: data })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/cadastros/fornecedores`)
}

export async function updateFornecedor(orgSlug: string, fornecedorId: string, formData: FormData) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const data = readData(formData)
  if (!data.name) return { error: 'Nome obrigatório' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('update_fornecedor', { p_user_id: user.id, p_fornecedor_id: fornecedorId, p_data: data })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/cadastros/fornecedores`)
}

export async function setFornecedorArchived(orgSlug: string, fornecedorId: string, archived: boolean) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_fornecedor_archived', { p_user_id: user.id, p_fornecedor_id: fornecedorId, p_archived: archived })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/cadastros/fornecedores`)
}
