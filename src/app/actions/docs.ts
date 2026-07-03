'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function createDocument(
  orgId: string,
  orgSlug: string,
  workspaceId?: string | null,
  parentId?: string | null,
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: newId, error } = await supabase.rpc('create_document', {
    p_user_id: user.id,
    p_org_id: orgId,
    p_workspace_id: workspaceId ?? null,
    p_parent_id: parentId ?? null,
  })

  if (error) return { error: error.message }
  redirect(`/${orgSlug}/docs/${newId}`)
}

export async function createFolder(orgId: string, orgSlug: string, workspaceId: string | null, name: string, parentId: string | null = null) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { data: newId, error } = await supabase.rpc('create_folder', {
    p_user_id: user.id,
    p_org_id: orgId,
    p_workspace_id: workspaceId,
    p_name: name,
    p_parent_id: parentId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/docs`)
  return { id: newId as string }
}

export async function renameDocument(docId: string, orgSlug: string, title: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('update_document_title', { p_user_id: user.id, p_doc_id: docId, p_title: title })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/docs`)
  return {}
}

export async function moveDocument(docId: string, orgSlug: string, parentId: string | null, workspaceId: string | null) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('move_document', {
    p_user_id: user.id, p_doc_id: docId, p_parent_id: parentId, p_workspace_id: workspaceId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/docs`)
  return {}
}

/** Exclui sem redirecionar (usado na árvore da sidebar). */
export async function removeDocument(docId: string, orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase.rpc('delete_document', { p_user_id: user.id, p_doc_id: docId })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/docs`)
  return {}
}

/** Info de compartilhamento de um documento/pasta (p/ abrir o ShareModal fora da tela do doc). */
export async function getDocShareInfo(orgId: string, docId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [{ data: doc }, { data: dm }, { data: mem }] = await Promise.all([
    sb.from('documents').select('visibility').eq('id', docId).single(),
    sb.from('document_members').select('user_id').eq('document_id', docId),
    sb.from('organization_members').select('user_id, profiles!user_id(full_name, email)').eq('org_id', orgId),
  ])
  if (!doc) return { error: 'Documento não encontrado' as const }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = (mem ?? []).map((m: any) => ({
    userId: m.user_id as string,
    fullName: (m.profiles?.full_name ?? null) as string | null,
    email: (m.profiles?.email ?? '') as string,
  }))
  return {
    visibility: (doc.visibility as 'org' | 'custom'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    memberIds: ((dm ?? []) as any[]).map(x => x.user_id as string),
    members,
    currentUserId: user.id as string,
  }
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
