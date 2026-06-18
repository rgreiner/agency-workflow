'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function createDocument(orgId: string, orgSlug: string, workspaceId?: string | null) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: newId, error } = await supabase.rpc('create_document', {
    p_user_id: user.id,
    p_org_id: orgId,
    p_workspace_id: workspaceId ?? null,
  })

  if (error) return { error: error.message }
  redirect(`/${orgSlug}/docs/${newId}`)
}

export async function updateDocumentVisibility(
  docId: string,
  orgSlug: string,
  visibility: 'org' | 'custom',
  memberIds: string[]
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('set_document_visibility', {
    p_user_id: user.id,
    p_doc_id: docId,
    p_visibility: visibility,
    p_member_ids: memberIds,
  })
  if (error) return { error: error.message }

  revalidatePath(`/${orgSlug}/docs/${docId}`)
  return {}
}

export async function setDocumentWorkspace(docId: string, orgSlug: string, workspaceId: string | null) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('set_document_workspace', {
    p_user_id: user.id,
    p_doc_id: docId,
    p_workspace_id: workspaceId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/docs/${docId}`)
  revalidatePath(`/${orgSlug}/docs`)
  return {}
}

export async function deleteDocument(docId: string, orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('delete_document', { p_user_id: user.id, p_doc_id: docId })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/docs`)
  redirect(`/${orgSlug}/docs`)
}
