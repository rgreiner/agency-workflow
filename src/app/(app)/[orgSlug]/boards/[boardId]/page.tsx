import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { notFound } from 'next/navigation'
import { BoardCanvas } from './BoardCanvas'
import type { BoardData } from '@/types/board'

export default async function BoardPage({
  params,
}: {
  params: Promise<{ orgSlug: string; boardId: string }>
}) {
  const { orgSlug, boardId } = await params
  const supabase = await createClient()

  const user = await getUsuario()
  if (!user) return null

  const { data: board } = await supabase
    .from('visual_boards')
    .select('id, title, data')
    .eq('id', boardId)
    .single()

  if (!board) notFound()

  const initialData = (board.data ?? { elements: [], arrows: [] }) as unknown as BoardData

  return (
    <div className="h-full overflow-hidden">
      <BoardCanvas
        boardId={boardId}
        orgSlug={orgSlug}
        initialTitle={board.title}
        initialData={initialData}
      />
    </div>
  )
}
