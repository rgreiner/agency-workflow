import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { notFound } from 'next/navigation'
import { BoardCanvas } from './BoardCanvas'
import { MindMapCanvas } from './MindMapCanvas'
import type { BoardData } from '@/types/board'
import { emptyMap, type MindMapData } from '@/types/mindmap'
import type { MemberRole } from '@/types'

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
    .select('id, title, data, kind, org_id, min_role')
    .eq('id', boardId)
    .single()

  if (!board) notFound()

  // Cargo do usuário na org do quadro → limita os níveis de acesso ofertados.
  const b = board as typeof board & { org_id: string; min_role?: MemberRole }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase as any)
    .from('organization_members').select('role')
    .eq('org_id', b.org_id).eq('user_id', user.id).single()
  const viewerRole = (membership?.role ?? 'viewer') as MemberRole
  const minRole = (b.min_role ?? 'member') as MemberRole

  // kind='mapa' → editor de árvore (layout calculado); senão o canvas livre de sempre.
  if ((board as { kind?: string }).kind === 'mapa') {
    const raw = board.data as unknown as Partial<MindMapData> | null
    const mapData: MindMapData = raw?.root ? (raw as MindMapData) : emptyMap(board.title)
    return (
      <div className="h-full overflow-hidden">
        <MindMapCanvas boardId={boardId} orgSlug={orgSlug} initialTitle={board.title} initialData={mapData}
          viewerRole={viewerRole} initialMinRole={minRole} />
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
        viewerRole={viewerRole}
        initialMinRole={minRole}
      />
    </div>
  )
}
