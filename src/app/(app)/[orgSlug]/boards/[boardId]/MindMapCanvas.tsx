'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { updateBoardTitle, deleteBoard } from '@/app/actions/boards'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { cn } from '@/lib/utils'
import {
  ChevronLeft, Check, Loader2, Pencil, X, Trash2, ZoomIn, ZoomOut,
  FileDown, Printer, Plus, Palette, Crosshair, LayoutGrid, ArrowLeftRight,
} from 'lucide-react'
import {
  type MindNode, type MindMapData, type LaidNode, MIND_COLORS, NODE_H,
  newNode, layoutMap, edgePath, addChild, addSibling, removeNode, updateNode,
  findParent, findNode, toMarkdown, slugify, clearOffsets, hasOffsets,
} from '@/types/mindmap'

export function MindMapCanvas({ boardId, orgSlug, initialTitle, initialData }: {
  boardId: string; orgSlug: string; initialTitle: string; initialData: MindMapData
}) {
  const supabase = createClient()
  const [title, setTitle] = useState(initialTitle)
  const [titleDraft, setTitleDraft] = useState(initialTitle)
  const [editingTitle, setEditingTitle] = useState(false)
  const [root, setRoot] = useState<MindNode>(initialData.root)
  const [selId, setSelId] = useState(initialData.root.id)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showPalette, setShowPalette] = useState(false)

  const rootRef = useRef(root)
  useEffect(() => { rootRef.current = root }, [root])
  const pending = useRef<MindNode | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const layout = useMemo(() => layoutMap(root), [root])
  const posById = useMemo(() => new Map(layout.nodes.map(n => [n.node.id, n])), [layout])
  const layoutRef = useRef(layout)
  useEffect(() => { layoutRef.current = layout }, [layout])

  // Arrasto livre: guarda a base no pointerdown pra o delta não acumular erro.
  const dragRef = useRef<{ id: string; sx: number; sy: number; dx0: number; dy0: number; base: MindNode; moved: boolean } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  /** Rola o canvas até a raiz ficar no meio da tela. */
  const centerView = useCallback(() => {
    const el = canvasRef.current
    const r = layoutRef.current.nodes.find(n => n.side === 'root')
    if (!el || !r) return
    el.scrollLeft = (r.x + r.w / 2) * zoom - el.clientWidth / 2
    el.scrollTop = (r.y + NODE_H / 2) * zoom - el.clientHeight / 2
  }, [zoom])
  // No load: raiz centralizada (o mapa cresce a partir do centro) e canvas focado —
  // sem o foco o teclado só "liga" depois do primeiro clique.
  useEffect(() => {
    centerView()
    canvasRef.current?.focus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave: mesmo padrão do Quadro (debounce 1200ms), gravando { root }.
  const scheduleSave = useCallback((next: MindNode) => {
    pending.current = next
    setSaveStatus('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('visual_boards')
        .update({ data: { root: pending.current }, updated_at: new Date().toISOString() })
        .eq('id', boardId)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }, 1200)
  }, [boardId, supabase])

  const commit = useCallback((next: MindNode) => { setRoot(next); scheduleSave(next) }, [scheduleSave])

  // ── Operações ──────────────────────────────────────────────────────────────
  // O teclado vive no canvas (tabIndex=0): toda vez que a edição acaba o foco TEM
  // que voltar pra cá, senão some pro body e Tab/Enter param de responder.
  function focusCanvas() { canvasRef.current?.focus() }
  function startEdit(id: string) { setEditingId(id) }
  function stopEdit() { setEditingId(null); focusCanvas() }
  /** Texto salvo ao digitar — sem rascunho, sem commit no blur (era o que dava corrida). */
  function setText(id: string, text: string) { commit(updateNode(rootRef.current, id, { text })) }

  function addChildTo(id: string) {
    const n = newNode('')
    commit(addChild(rootRef.current, id, n))
    setSelId(n.id); startEdit(n.id)
  }
  function addSiblingTo(id: string) {
    const r = rootRef.current
    if (id === r.id) { addChildTo(id); return }   // a raiz não tem irmão
    const n = newNode('')
    commit(addSibling(r, id, n))
    setSelId(n.id); startEdit(n.id)
  }
  function del(id: string) {
    const r = rootRef.current
    if (id === r.id) { toast.error('O tema central não pode ser removido.'); return }
    const parent = findParent(r, id)
    commit(removeNode(r, id))
    setSelId(parent?.id ?? r.id)
  }
  function toggleCollapse(id: string) {
    const n = findNode(rootRef.current, id)
    if (!n?.children.length) return
    commit(updateNode(rootRef.current, id, { collapsed: !n.collapsed }))
  }
  function paint(color: string) {
    commit(updateNode(rootRef.current, selId, { color }))
    setShowPalette(false)
  }
  function flipSide(id: string) {
    const cur = posById.get(id)?.side
    commit(updateNode(rootRef.current, id, { side: cur === 'left' ? 'right' : 'left' }))
  }
  function reorganizar() {
    commit(clearOffsets(rootRef.current))
    toast.success('Layout automático restaurado.')
  }

  // ── Arrastar: posição livre; a subárvore acompanha (dx/dy é offset do auto) ──
  function onNodeDown(e: React.PointerEvent, ln: LaidNode) {
    if (editingId === ln.node.id) return
    if ((e.target as HTMLElement).closest('[data-nodrag]')) return
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragRef.current = {
      id: ln.node.id, sx: e.clientX, sy: e.clientY,
      dx0: ln.node.dx ?? 0, dy0: ln.node.dy ?? 0, base: rootRef.current, moved: false,
    }
    setSelId(ln.node.id)
    focusCanvas()
  }
  function onNodeMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    const dx = (e.clientX - d.sx) / zoom
    const dy = (e.clientY - d.sy) / zoom
    // Tolerância: sem isso um clique com 1px de tremida já viraria arrasto.
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    if (!d.moved) { d.moved = true; setDraggingId(d.id) }
    commit(updateNode(d.base, d.id, { dx: Math.round(d.dx0 + dx), dy: Math.round(d.dy0 + dy) }))
  }
  function onNodeUp(e: React.PointerEvent) {
    const d = dragRef.current
    dragRef.current = null
    if (d?.moved) { setDraggingId(null); e.stopPropagation() }
  }

  // ── Teclado: é o que faz mapa mental valer a pena ──────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    if (editingId) return
    const r = rootRef.current
    const sel = selId
    const parent = findParent(r, sel)
    const node = findNode(r, sel)
    if (!node) return

    if (e.key === 'Tab') { e.preventDefault(); addChildTo(sel) }
    else if (e.key === 'Enter') { e.preventDefault(); addSiblingTo(sel) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(sel) }
    else if (e.key === 'F2') { e.preventDefault(); startEdit(sel) }
    else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (node.collapsed) toggleCollapse(sel)
      else if (node.children[0]) setSelId(node.children[0].id)
    }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (parent) setSelId(parent.id) }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (!parent) return
      const i = parent.children.findIndex(c => c.id === sel)
      const next = parent.children[i + (e.key === 'ArrowDown' ? 1 : -1)]
      if (next) setSelId(next.id)
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function exportMd() {
    const blob = new Blob([toMarkdown(rootRef.current)], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${slugify(title)}.md`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.success('Markdown exportado.')
  }

  async function saveTitle() {
    setTitle(titleDraft)
    setEditingTitle(false)
    await updateBoardTitle(boardId, titleDraft)
  }

  const selNode = findNode(root, selId)

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <Link href={`/${orgSlug}/boards`} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition" aria-label="Voltar">
          <ChevronLeft className="w-4 h-4" />
        </Link>

        {editingTitle ? (
          <div className="flex items-center gap-1">
            <input value={titleDraft} onChange={e => setTitleDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setTitleDraft(title); setEditingTitle(false) } }}
              className="h-8 px-2 text-sm font-semibold bg-gray-100 border border-transparent rounded-lg focus:bg-white focus:border-orange-300 outline-none" autoFocus />
            <button onClick={saveTitle} aria-label="Salvar título" className="p-1.5 text-gray-400 hover:text-emerald-600"><Check className="w-4 h-4" /></button>
            <button onClick={() => { setTitleDraft(title); setEditingTitle(false) }} aria-label="Cancelar" className="p-1.5 text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <button onClick={() => { setTitleDraft(title); setEditingTitle(true) }}
            className="inline-flex items-center gap-1.5 px-1.5 py-1 rounded-lg text-sm font-semibold text-gray-900 hover:bg-gray-100 transition">
            {title} <Pencil className="w-3 h-3 text-gray-400" />
          </button>
        )}
        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700">mapa mental</span>

        <div className="flex-1" />

        <span className="text-xs text-gray-400 min-w-[70px] inline-flex items-center gap-1">
          {saveStatus === 'saving' && <><Loader2 className="w-3 h-3 animate-spin" /> Salvando…</>}
          {saveStatus === 'saved' && <><Check className="w-3 h-3 text-emerald-500" /> Salvo</>}
        </span>

        <button onClick={exportMd} title="Exportar markdown (.md)"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
          <FileDown className="w-3.5 h-3.5" /> .md
        </button>
        <Link href={`/${orgSlug}/boards/${boardId}/print`} target="_blank" title="Abrir versão de impressão (Salvar como PDF)"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
          <Printer className="w-3.5 h-3.5" /> PDF
        </Link>

        <div className="flex items-center gap-1 ml-1">
          <button onClick={centerView} title="Centralizar o mapa na tela" aria-label="Centralizar"
            className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50"><Crosshair className="w-3.5 h-3.5 text-gray-500" /></button>
          <button onClick={reorganizar} disabled={!hasOffsets(root)}
            title={hasOffsets(root) ? 'Reorganizar: volta tudo ao layout automático' : 'Nada foi movido à mão'}
            aria-label="Reorganizar"
            className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"><LayoutGrid className="w-3.5 h-3.5 text-gray-500" /></button>
          <button onClick={() => setZoom(z => Math.max(0.3, z * 0.85))} aria-label="Diminuir zoom" className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50"><ZoomOut className="w-3.5 h-3.5 text-gray-500" /></button>
          <button onClick={() => setZoom(1)} className="px-2 py-1.5 text-[11px] font-semibold text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 min-w-[44px]">{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom(z => Math.min(2, z * 1.15))} aria-label="Aumentar zoom" className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50"><ZoomIn className="w-3.5 h-3.5 text-gray-500" /></button>
        </div>

        <button onClick={() => setConfirmDelete(true)} aria-label="Excluir mapa" className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Barra do nó selecionado */}
      <div className="flex items-center gap-2 px-4 py-1.5 bg-white border-b border-gray-100 shrink-0 text-xs text-gray-500">
        <button onClick={() => addChildTo(selId)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 transition">
          <Plus className="w-3 h-3" /> Filho <kbd className="text-[10px] text-gray-400">Tab</kbd>
        </button>
        <button onClick={() => addSiblingTo(selId)} disabled={selId === root.id}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition">
          <Plus className="w-3 h-3" /> Irmão <kbd className="text-[10px] text-gray-400">Enter</kbd>
        </button>
        <div className="relative">
          <button onClick={() => setShowPalette(s => !s)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 transition">
            <Palette className="w-3 h-3" /> Cor
          </button>
          {showPalette && (
            <div className="absolute top-full left-0 mt-1 z-20 flex gap-1 p-1.5 bg-white border border-gray-200 rounded-lg shadow-lg">
              {MIND_COLORS.map(c => (
                <button key={c} onClick={() => paint(c)} aria-label={`Cor ${c}`}
                  className="w-5 h-5 rounded-full border border-black/10 hover:scale-110 transition-transform" style={{ backgroundColor: c }} />
              ))}
            </div>
          )}
        </div>
        {posById.get(selId)?.depth === 1 && (
          <button onClick={() => flipSide(selId)} title="Joga o ramo pro outro lado da raiz"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 transition">
            <ArrowLeftRight className="w-3 h-3" /> Trocar de lado
          </button>
        )}
        <span className="text-gray-300">·</span>
        <span className="truncate">Selecionado: <strong className="text-gray-600">{selNode?.text || '(vazio)'}</strong></span>
        <div className="flex-1" />
        <span className="text-gray-400 hidden lg:block">F2 renomeia · ↑↓←→ navega · Del apaga · arraste pra posicionar</span>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClick={() => canvasRef.current?.focus()}
        className="flex-1 overflow-auto outline-none"
      >
        <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})`, transformOrigin: '0 0', position: 'relative' }}>
            <svg width={layout.width} height={layout.height} className="absolute inset-0 pointer-events-none">
              {layout.edges.map(e => {
                const from = posById.get(e.fromId), to = posById.get(e.toId)
                if (!from || !to) return null
                return <path key={`${e.fromId}-${e.toId}`} d={edgePath(from, to)} fill="none" stroke={to.color} strokeWidth={2} strokeOpacity={0.55} />
              })}
            </svg>

            {layout.nodes.map(ln => {
              const isSel = ln.node.id === selId
              const isRoot = ln.node.id === root.id
              const isLeft = ln.side === 'left'
              const editing = editingId === ln.node.id
              const kids = ln.node.children.length
              return (
                <div key={ln.node.id} className="absolute group" style={{ left: ln.x, top: ln.y, width: ln.w, height: NODE_H }}>
                  <div
                    onPointerDown={e => onNodeDown(e, ln)}
                    onPointerMove={onNodeMove}
                    onPointerUp={onNodeUp}
                    onPointerCancel={() => { dragRef.current = null; setDraggingId(null) }}
                    onClick={e => { e.stopPropagation(); setSelId(ln.node.id); focusCanvas() }}
                    onDoubleClick={e => { e.stopPropagation(); setSelId(ln.node.id); startEdit(ln.node.id) }}
                    className={cn(
                      'w-full h-full flex items-center gap-1 rounded-xl border-2 transition-shadow select-none touch-none',
                      // O ramo esquerdo cresce pra esquerda: o "+" acompanha o lado.
                      isLeft ? 'flex-row-reverse pl-1.5 pr-3' : 'pl-3 pr-1.5',
                      draggingId === ln.node.id ? 'cursor-grabbing' : 'cursor-grab',
                      !isSel && 'hover:shadow-sm',
                    )}
                    style={{
                      backgroundColor: isRoot ? ln.color : `${ln.color}14`,
                      borderColor: isSel ? ln.color : `${ln.color}66`,
                      // Halo na cor do nó — seleção que se enxerga de longe.
                      boxShadow: isSel ? `0 0 0 3px ${ln.color}40, 0 2px 8px ${ln.color}30` : undefined,
                    }}
                  >
                    {editing ? (
                      <input
                        value={ln.node.text}
                        onChange={e => setText(ln.node.id, e.target.value)}
                        // Só encerra se a edição ainda for DESTE nó: ao criar o próximo,
                        // o blur do antigo chegaria depois e mataria a edição do novo.
                        onBlur={() => setEditingId(cur => (cur === ln.node.id ? null : cur))}
                        onKeyDown={e => {
                          e.stopPropagation()
                          if (e.key === 'Enter')       { e.preventDefault(); addSiblingTo(ln.node.id) }
                          else if (e.key === 'Tab')    { e.preventDefault(); addChildTo(ln.node.id) }
                          else if (e.key === 'Escape') { e.preventDefault(); stopEdit() }
                        }}
                        placeholder="Novo tópico"
                        className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-gray-400"
                        style={{ color: isRoot ? '#fff' : '#1f2937' }}
                        autoFocus
                      />
                    ) : (
                      <span className={cn('flex-1 min-w-0 text-sm truncate', isRoot && 'font-semibold')}
                        style={{ color: isRoot ? '#fff' : '#1f2937' }}>
                        {ln.node.text || <span className="opacity-50">Novo tópico</span>}
                      </span>
                    )}

                    {/* + no fim da caixa = mesmo que Tab. Aparece no hover ou quando selecionado. */}
                    {!editing && (
                      <button
                        data-nodrag
                        onClick={e => { e.stopPropagation(); setSelId(ln.node.id); addChildTo(ln.node.id) }}
                        title="Novo nó filho (Tab)"
                        aria-label="Novo nó filho"
                        className={cn(
                          'shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-opacity',
                          isSel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                        )}
                        style={{
                          backgroundColor: isRoot ? '#ffffff33' : `${ln.color}22`,
                          color: isRoot ? '#fff' : ln.color,
                        }}
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Contador = botão de recolher/expandir. Fica do lado em que o ramo abre.
                      Recolhido mostra quantos filhos estão escondidos (e fica sempre visível). */}
                  {kids > 0 && (
                    <button
                      data-nodrag
                      onClick={e => { e.stopPropagation(); toggleCollapse(ln.node.id) }}
                      title={ln.node.collapsed ? `Expandir ${kids} nó(s) escondido(s)` : 'Recolher ramo'}
                      aria-label={ln.node.collapsed ? 'Expandir ramo' : 'Recolher ramo'}
                      className={cn(
                        'absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-[10px] font-bold text-[#fff] flex items-center justify-center border-2 border-white shadow-sm hover:scale-125 transition-all',
                        isLeft ? '-left-2.5' : '-right-2.5',
                        ln.node.collapsed || isSel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      )}
                      style={{ backgroundColor: ln.color }}
                    >
                      {ln.node.collapsed ? kids : '−'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Excluir este mapa mental?"
        description={`"${title}" e todos os seus ramos serão removidos permanentemente. Essa ação não pode ser desfeita.`}
        confirmLabel="Excluir mapa"
        loading={deleting}
        onConfirm={async () => { setDeleting(true); await deleteBoard(boardId, orgSlug) }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
