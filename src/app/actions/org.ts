'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function createOrganization(formData: FormData) {
  const name = formData.get('name') as string
  if (!name?.trim()) return { error: 'Nome obrigatório' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const slug = (formData.get('slug') as string) || name.toLowerCase().replace(/\s+/g, '-')

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({ name: name.trim(), slug, plan: 'free', max_members: 5 })
    .select()
    .single()

  if (orgError) {
    return {
      error: orgError.message.includes('unique')
        ? 'Esse nome já está em uso. Tente outro.'
        : orgError.message,
    }
  }

  await supabase.from('organization_members').insert({
    org_id: org.id,
    user_id: user.id,
    role: 'owner',
  })

  redirect(`/${org.slug}/dashboard`)
}

export async function createOrganizationWithProfile(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const name = formData.get('name') as string
  const slug = formData.get('slug') as string
  const company_type = formData.get('company_type') as string
  const company_size = formData.get('company_size') as string
  const segment = formData.get('segment') as string
  const full_name = formData.get('full_name') as string
  const role_title = formData.get('role_title') as string
  const phone = formData.get('phone') as string

  if (!name?.trim() || !slug?.trim()) return { error: 'Dados da empresa incompletos' }
  if (!full_name?.trim()) return { error: 'Nome obrigatório' }

  // Cria a organização
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({
      name: name.trim(),
      slug: slug.trim(),
      plan: 'free',
      max_members: 5,
      company_type,
      company_size,
      segment,
    })
    .select()
    .single()

  if (orgError) {
    return {
      error: orgError.message.includes('unique')
        ? 'Esse nome de empresa já está em uso. Volte e tente outro.'
        : orgError.message,
    }
  }

  // Adiciona como owner
  await supabase.from('organization_members').insert({
    org_id: org.id,
    user_id: user.id,
    role: 'owner',
  })

  // Atualiza o perfil do usuário
  await supabase
    .from('profiles')
    .update({ full_name: full_name.trim(), role_title, phone: phone || null })
    .eq('id', user.id)

  redirect(`/${org.slug}/dashboard`)
}
