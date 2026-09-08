'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

// Sem acento, sem caixa, espaços colapsados: "Rio Estamparia" = "rio  estamparía".
const chaveNome = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

function readData(formData: FormData) {
  const get = (k: string) => ((formData.get(k) as string) ?? '').trim()
  const j = (k: string) => { try { return JSON.parse((formData.get(k) as string) || '[]') } catch { return [] } }
  return {
    name: get('name'), tipo: get('tipo'), tax_id: get('tax_id'), notes: get('notes'),
    enderecos: j('enderecos'), telefones: j('telefones'), emails: j('emails'), contas_bancarias: j('contas_bancarias'),
    // A RPC só mexe em `tags` quando a chave vem no payload (migration 235).
    tags: j('tags'),
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


/**
 * Cadastro RÁPIDO pelo orçamento/pedido (Rafael, 08/09/2026): a pessoa digita um
 * fornecedor que ainda não existe e segue orçando; o resto (tipo, CNPJ, contato)
 * fica pra completar em Cadastros › Fornecedores, que marca o cadastro como
 * incompleto. Nome igual a um já existente (sem acento/caixa) reaproveita em vez
 * de duplicar — e desarquiva se estava arquivado.
 */
export async function createFornecedorRapido(orgSlug: string, nome: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const name = nome.trim()
  if (name.length < 2) return { error: 'Nome muito curto' }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: parecidos } = await (supabase as any)
    .from('fornecedores').select('id, name, archived').eq('org_id', org.id).ilike('name', name)
  const igual = ((parecidos ?? []) as { id: string; name: string; archived: boolean }[])
    .find(f => chaveNome(f.name) === chaveNome(name))
  if (igual) {
    if (igual.archived) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('set_fornecedor_archived', { p_user_id: user.id, p_fornecedor_id: igual.id, p_archived: false })
      if (error) return { error: error.message }
      revalidatePath(`/${orgSlug}/cadastros/fornecedores`)
    }
    return { id: igual.id, name: igual.name, existente: true }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: id, error } = await (supabase as any).rpc('create_fornecedor', {
    p_user_id: user.id, p_org_id: org.id,
    p_data: { name, tipo: '', tax_id: '', notes: '', enderecos: [], telefones: [], emails: [], contas_bancarias: [], tags: [] },
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/cadastros/fornecedores`)
  return { id: id as string, name, existente: false }
}
