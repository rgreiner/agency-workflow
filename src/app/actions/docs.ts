'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function createDocument(orgId: string, orgSlug: string, workspaceId?: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      org_id: orgId,
      workspace_id: workspaceId ?? null,
      title: 'Sem título',
      content: { type: 'doc', content: [] },
      visibility: 'org',
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  redirect(`/${orgSlug}/docs/${data.id}`)
}

export async function updateDocumentVisibility(
  docId: string,
  orgSlug: string,
  visibility: 'org' | 'custom',
  memberIds: string[]
) {
  const supabase = await createClient()

  const { error: visError } = await supabase
    .from('documents')
    .update({ visibility })
    .eq('id', docId)

  if (visError) return { error: visError.message }

  const { error: delError } = await supabase
    .from('document_members')
    .delete()
    .eq('document_id', docId)

  if (delError) return { error: delError.message }

  if (visibility === 'custom' && memberIds.length > 0) {
    const { error } = await supabase
      .from('document_members')
      .insert(memberIds.map(userId => ({ document_id: docId, user_id: userId })))

    if (error) return { error: error.message }
  }

  revalidatePath(`/${orgSlug}/docs/${docId}`)
  return {}
}

export async function deleteDocument(docId: string, orgSlug: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('documents').delete().eq('id', docId)
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/docs`)
  redirect(`/${orgSlug}/docs`)
}
