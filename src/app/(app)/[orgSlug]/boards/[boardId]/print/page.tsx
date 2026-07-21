import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { notFound } from 'next/navigation'
import { PrintToolbar } from '@/components/ui/PrintToolbar'
import { layoutMap, edgePath, nodeBox, emptyMap, LINE_H, PAD_X, PAD_Y, type MindMapData } from '@/types/mindmap'

/**
 * Versão de impressão do mapa mental → "Salvar como PDF" do navegador.
 * O layout é função pura, então o SVG sai pronto do servidor: PDF vetorial
 * (texto continua texto, dá zoom sem borrar) sem nenhuma lib de PDF.
 */
export default async function MapaPrintPage({
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

  if (!board || (board as { kind?: string }).kind !== 'mapa') notFound()

  const raw = board.data as unknown as Partial<MindMapData> | null
  const map: MindMapData = raw?.root ? (raw as MindMapData) : emptyMap(board.title)
  const L = layoutMap(map.root)
  const rootId = map.root.id

  return (
    <div className="min-h-screen bg-gray-200">
      {/* Mapa é largo: paisagem cabe muito mais ramo por página. */}
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm } }`}</style>
      <PrintToolbar backHref={`/${orgSlug}/boards/${boardId}`} />

      <div className="py-6 flex justify-center">
        <div id="print-doc" className="bg-white shadow-sm w-[277mm] max-w-full p-[12mm] text-gray-800">
          <h1 className="text-lg font-semibold mb-1">{board.title}</h1>
          <p className="text-[11px] text-gray-400 mb-4">
            {L.nodes.length} tópico{L.nodes.length !== 1 ? 's' : ''} · exportado do Flow
          </p>

          {/* viewBox faz o SVG encolher pra largura da página sem perder nitidez */}
          <svg viewBox={`0 0 ${L.width} ${L.height}`} style={{ width: '100%', height: 'auto' }}
            xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`Mapa mental: ${board.title}`}>
            {L.edges.map(e => {
              const from = L.nodes.find(n => n.node.id === e.fromId)
              const to = L.nodes.find(n => n.node.id === e.toId)
              if (!from || !to) return null
              return (
                <path key={`${e.fromId}-${e.toId}`} d={edgePath(from, to)}
                  fill="none" stroke={to.color} strokeWidth={2} strokeOpacity={0.55} />
              )
            })}
            {L.nodes.map(n => {
              const isRoot = n.node.id === rootId
              const badgeX = n.side === 'left' ? n.x : n.x + n.w
              const { lines } = nodeBox(n.node)
              // Bloco de texto centralizado na vertical: mesma conta do canvas.
              const top = n.y + (n.h - lines.length * LINE_H) / 2
              return (
                <g key={n.node.id}>
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={10}
                    fill={isRoot ? n.color : `${n.color}14`}
                    stroke={isRoot ? n.color : `${n.color}66`} strokeWidth={2} />
                  <text x={n.x + PAD_X} fontSize={13}
                    fontWeight={n.node.bold || isRoot ? 600 : 400}
                    fontStyle={n.node.italic ? 'italic' : undefined}
                    fill={n.node.textColor ?? (isRoot ? '#ffffff' : '#1f2937')}>
                    {lines.map((l, i) => (
                      <tspan key={i} x={n.x + PAD_X} y={top + i * LINE_H + LINE_H - PAD_Y / 2}>
                        {l || ' '}
                      </tspan>
                    ))}
                  </text>
                  {n.node.collapsed && n.node.children.length > 0 && (
                    <>
                      <circle cx={badgeX} cy={n.y + n.h / 2} r={9} fill={n.color} />
                      <text x={badgeX} y={n.y + n.h / 2 + 3.5} fontSize={10} fontWeight={700}
                        fill="#ffffff" textAnchor="middle">{n.node.children.length}</text>
                    </>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      </div>
    </div>
  )
}
