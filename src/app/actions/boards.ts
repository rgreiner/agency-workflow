'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { emptyMap } from '@/types/mindmap'

export async function createBoard(
  orgSlug: string, orgId: string, title: string, workspaceId?: string,
  kind: 'quadro' | 'mapa' = 'quadro',
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const clean = title.trim() || (kind === 'mapa' ? 'Mapa sem título' : 'Quadro sem título')
  // Mapa nasce com a raiz já criada (o blob `data` muda de formato conforme o kind).
  const data0 = kind === 'mapa' ? emptyMap(clean) : { elements: [], arrows: [] }

  const { data, error } = await supabase
    .from('visual_boards')
    .insert({
      org_id:       orgId,
      title:        clean,
      workspace_id: workspaceId || null,
      created_by:   user.id,
      kind,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data:         data0 as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
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
