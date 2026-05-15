'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

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

  // Cria org + membro via função no banco (SECURITY DEFINER, bypassa RLS)
  const { data: orgId, error: fnError } = await supabase.rpc('create_org_for_user', {
    p_user_id: user.id,
    p_name: name.trim(),
    p_slug: slug.trim(),
    p_type: company_type,
    p_size: company_size,
    p_segment: segment,
  })

  if (fnError) {
    return {
      error: fnError.message.includes('unique')
        ? 'Esse nome de empresa já está em uso. Volte e tente outro.'
        : fnError.message,
    }
  }

  // Atualiza o perfil do usuário
  await supabase
    .from('profiles')
    .update({ full_name: full_name.trim(), role_title, phone: phone || null })
    .eq('id', user.id)

  // Busca o slug para redirecionar
  const { data: org } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', orgId)
    .single()

  redirect(`/${org?.slug ?? slug}/dashboard`)
}
