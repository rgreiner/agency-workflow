import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { notFound } from 'next/navigation'
import { BoardCanvas } from './BoardCanvas'
import { MindMapCanvas } from './MindMapCanvas'
import type { BoardData } from '@/types/board'
import { emptyMap, type MindMapData } from '@/types/mindmap'

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
    .select('id, title, data, kind')
    .eq('id', boardId)
    .single()

  if (!board) notFound()

  // kind='mapa' → editor de árvore (layout calculado); senão o canvas livre de sempre.
  if ((board as { kind?: string }).kind === 'mapa') {
    const raw = board.data as unknown as Partial<MindMapData> | null
    const mapData: MindMapData = raw?.root ? (raw as MindMapData) : emptyMap(board.title)
    return (
      <div className="h-full overflow-hidden">
        <MindMapCanvas boardId={boardId} orgSlug={orgSlug} initialTitle={board.title} initialData={mapData} />
      </div>
    )
  }

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
