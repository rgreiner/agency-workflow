'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function createBoard(orgSlug: string, orgId: string, title: string, workspaceId?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const { data, error } = await supabase
    .from('visual_boards')
    .insert({
      org_id:       orgId,
      title:        title.trim() || 'Quadro sem título',
      workspace_id: workspaceId || null,
      created_by:   user.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  redirect(`/${orgSlug}/boards/${data.id}`)
}

export async function updateBoardTitle(boardId: string, title: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('visual_boards')
    .update({ title: title.trim() || 'Quadro sem título', updated_at: new Date().toISOString() })
    .eq('id', boardId)

  if (error) return { error: error.message }
  return { success: true }
}

export async function deleteBoard(boardId: string, orgSlug: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('visual_boards')
    .delete()
    .eq('id', boardId)

  if (error) return { error: error.message }

  revalidatePath(`/${orgSlug}/boards`)
  redirect(`/${orgSlug}/boards`)
}
