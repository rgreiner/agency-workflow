'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { BoardElement, BoardData, Arrow, BoardElementType, ImageElement } from '@/types/board'
import { createElement } from '@/types/board'
import { updateBoardTitle, deleteBoard } from '@/app/actions/boards'
import { createClient } from '@/lib/supabase/client'
import { uploadFile } from '@/lib/storage/upload-client'
import { downscaleImage, extForType } from '@/lib/image-resize'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { NoteEl } from './elements/NoteEl'
import { TextEl } from './elements/TextEl'
import { ImageEl } from './elements/ImageEl'
import {
  ChevronLeft, Check, Loader2,
  MousePointer2, StickyNote, Type, ImageIcon, ArrowRight,
  Trash2, ZoomIn, ZoomOut, Maximize2, Pencil, X,
} from 'lucide-react'
import Link from 'next/link'

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_SCALE = 0.15
const MAX_SCALE = 4.0
const GRID_SIZE = 24

type Tool       = 'select' | 'note' | 'text' | 'image' | 'arrow'
type SaveStatus = 'idle' | 'saving' | 'saved'
type Port       = 'top' | 'right' | 'bottom' | 'left'
type Pt         = { x: number; y: number }

interface Props {
  boardId:      string
  orgSlug:      string
  initialTitle: string
  initialData:  BoardData
}

// ── Arrow geometry ─────────────────────────────────────────────────────────────

function portPt(el: BoardElement, port: Port): Pt {
  switch (port) {
    case 'top':    return { x: el.x + el.w / 2, y: el.y }
    case 'right':  return { x: el.x + el.w,     y: el.y + el.h / 2 }
    case 'bottom': return { x: el.x + el.w / 2, y: el.y + el.h }
    case 'left':   return { x: el.x,             y: el.y + el.h / 2 }
  }
}

function bestPorts(src: BoardElement, tgt: BoardElement): [Port, Port] {
  const dx = (tgt.x + tgt.w / 2) - (src.x + src.w / 2)
  const dy = (tgt.y + tgt.h / 2) - (src.y + src.h / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

function buildArrowPath(src: BoardElement, tgt: BoardElement) {
  const [sp, tp] = bestPorts(src, tgt)
  const s = portPt(src, sp)
  const t = portPt(tgt, tp)
  const dist = Math.hypot(t.x - s.x, t.y - s.y)
  const ctrl = Math.min(dist * 0.45, 160)

  const c1: Pt = sp === 'right'  ? { x: s.x + ctrl, y: s.y }
               : sp === 'left'   ? { x: s.x - ctrl, y: s.y }
               : sp === 'bottom' ? { x: s.x, y: s.y + ctrl }
               :                   { x: s.x, y: s.y - ctrl }

  const c2: Pt = tp === 'left'   ? { x: t.x - ctrl, y: t.y }
               : tp === 'right'  ? { x: t.x + ctrl, y: t.y }
               : tp === 'top'    ? { x: t.x, y: t.y - ctrl }
               :                   { x: t.x, y: t.y + ctrl }

  // midpoint of cubic bezier at t=0.5
  const mid: Pt = {
    x: (s.x + 3 * c1.x + 3 * c2.x + t.x) / 8,
    y: (s.y + 3 * c1.y + 3 * c2.y + t.y) / 8,
  }

  return { d: `M ${s.x} ${s.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${t.x} ${t.y}`, mid }
}

function tempPath(sx: number, sy: number, cx: number, cy: number) {
  const dx = cx - sx, dy = cy - sy
  const dist = Math.hypot(dx, dy)
  const cp = Math.min(dist * 0.4, 80)
  return `M ${sx} ${sy} Q ${sx + dx / 2} ${sy + dy / 2 - cp * 0.3} ${cx} ${cy}`
}

// ── Canvas element wrapper ─────────────────────────────────────────────────────

interface CanvasElProps {
  el:           BoardElement
  selected:     boolean
  editing:      boolean
  scale:        number
  isArrowTool:  boolean
  isHovered:    boolean
  onSelect:     () => void
  onStartEdit:  () => void
  onUpdate:     (u: Partial<BoardElement>) => void
  onDelete:     () => void
  onArrowStart: (e: React.PointerEvent) => void
  onHoverEnter: () => void
  onHoverLeave: () => void
  children:     React.ReactNode
}

function CanvasEl({
  el, selected, editing, scale, isArrowTool, isHovered,
  onSelect, onStartEdit, onUpdate, onDelete, onArrowStart,
  onHoverEnter, onHoverLeave, children,
}: CanvasElProps) {
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // ── Drag ────────────────────────────────────────────────────────────────────
  const dragging    = useRef(false)
  const dragOrigin  = useRef({ mx: 0, my: 0, ex: 0, ey: 0 })

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (editing) return
    e.stopPropagation()

    if (isArrowTool) { onArrowStart(e); return }

    onSelect()
    dragging.current = true
    dragOrigin.current = { mx: e.clientX, my: e.clientY, ex: el.x, ey: el.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    const s = scaleRef.current
    onUpdate({
      x: dragOrigin.current.ex + (e.clientX - dragOrigin.current.mx) / s,
      y: dragOrigin.current.ey + (e.clientY - dragOrigin.current.my) / s,
    })
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragging.current) { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId) }
  }

  // ── Resize ───────────────────────────────────────────────────────────────────
  const resizing     = useRef(false)
  const resizeOrigin = useRef({ mx: 0, my: 0, ow: 0, oh: 0 })

  function handleResizeDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation(); e.preventDefault()
    resizing.current = true
    resizeOrigin.current = { mx: e.clientX, my: e.clientY, ow: el.w, oh: el.h }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handleResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing.current) return
    const s = scaleRef.current
    onUpdate({
      w: Math.max(100, resizeOrigin.current.ow + (e.clientX - resizeOrigin.current.mx) / s),
      h: Math.max(50,  resizeOrigin.current.oh + (e.clientY - resizeOrigin.current.my) / s),
    })
  }

  function handleResizeUp(e: React.PointerEvent<HTMLDivElement>) {
    if (resizing.current) { resizing.current = false; e.currentTarget.releasePointerCapture(e.pointerId) }
  }

  // Port dot positions (shown when arrow tool + hovering)
  const PORT_DOTS: { style: React.CSSProperties }[] = [
    { style: { top: '-7px',  left: '50%',              transform: 'translateX(-50%)' } }, // top
    { style: { right: '-7px', top: '50%',              transform: 'translateY(-50%)' } }, // right
    { style: { bottom: '-7px', left: '50%',            transform: 'translateX(-50%)' } }, // bottom
    { style: { left: '-7px',  top: '50%',              transform: 'translateY(-50%)' } }, // left
  ]

  return (
    <div
      style={{
        position: 'absolute',
        left: el.x, top: el.y, width: el.w, height: el.h,
        outline: selected
          ? '2px solid #6366f1'
          : isHovered && !editing
          ? '2px dashed #818cf8'
          : 'none',
        outlineOffset: 2,
        borderRadius: 10,
        cursor: isArrowTool ? 'crosshair' : editing ? 'default' : 'grab',
        userSelect: editing ? 'text' : 'none',
        zIndex: selected ? 100 : 1,
        overflow: 'visible',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerEnter={onHoverEnter}
      onPointerLeave={onHoverLeave}
      onDoubleClick={e => { if (!isArrowTool) { e.stopPropagation(); onStartEdit() } }}
    >
      {children}

      {/* ── Connection port dots (aparecem no hover, em qualquer ferramenta) ── */}
      {isHovered && !editing && PORT_DOTS.map((dot, i) => (
        <div
          key={i}
          onPointerDown={e => { e.stopPropagation(); onArrowStart(e) }}
          style={{
            position: 'absolute',
            width: 12, height: 12,
            backgroundColor: '#6366f1',
            borderRadius: '50%',
            border: '2.5px solid #fff',
            boxShadow: '0 0 0 2px #6366f1',
            cursor: 'crosshair',
            zIndex: 300,
            ...dot.style,
          }}
        />
      ))}

      {/* ── Delete button ── */}
      {selected && !editing && !isArrowTool && (
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onDelete() }}
          title="Excluir (Del)"
          style={{
            position: 'absolute', top: -36, right: 0,
            width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: '#1f2937', borderRadius: 7, border: 'none',
            cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.2)', zIndex: 200,
          }}
        >
          <Trash2 size={12} color="#f87171" />
        </button>
      )}

      {/* ── Resize handle ── */}
      {selected && !editing && !isArrowTool && (
        <div
          style={{
            position: 'absolute', right: -5, bottom: -5,
            width: 12, height: 12,
            backgroundColor: '#6366f1', borderRadius: 3,
            cursor: 'se-resize', zIndex: 200,
            border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
        />
      )}
    </div>
  )
}

// ── Toolbar ────────────────────────────────────────────────────────────────────

const TOOLS = [
  { id: 'select', icon: MousePointer2, label: 'Selecionar  (V)' },
  { id: 'note',   icon: StickyNote,    label: 'Nota  (N)'       },
  { id: 'text',   icon: Type,          label: 'Texto  (T)'      },
  { id: 'image',  icon: ImageIcon,     label: 'Imagem  (I)'     },
  { id: 'arrow',  icon: ArrowRight,    label: 'Seta  (A)'       },
] as const

function CanvasToolbar({ tool, onTool }: { tool: Tool; onTool: (t: Tool) => void }) {
  return (
    <div style={{
      width: 52, height: '100%', backgroundColor: '#111827',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: 12, gap: 4, flexShrink: 0, borderRight: '1px solid #1f2937',
    }}>
      {TOOLS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => onTool(id as Tool)}
          title={label}
          style={{
            width: 36, height: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 8,
            backgroundColor: tool === id ? '#4f46e5' : 'transparent',
            border: 'none', cursor: 'pointer', transition: 'background-color 0.1s',
          }}
        >
          <Icon size={17} color={tool === id ? '#ffffff' : '#6b7280'} />
        </button>
      ))}

      <div style={{ width: 24, height: 1, backgroundColor: '#1f2937', margin: '4px 0' }} />

      {tool !== 'select' && (
        <div style={{
          position: 'absolute', left: 60, top: 8,
          backgroundColor: '#1f2937', borderRadius: 8,
          padding: '6px 10px', fontSize: 11, color: '#9ca3af',
          whiteSpace: 'nowrap', pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 300,
        }}>
          {tool === 'arrow'
            ? 'Clique em um elemento para conectar'
            : 'Clique no canvas para adicionar'}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function BoardCanvas({ boardId, orgSlug, initialTitle, initialData }: Props) {
  const supabase = createClient()

  const [title, setTitle]               = useState(initialTitle)
  const [editingTitle, setEditingTitle]  = useState(false)
  const [titleDraft, setTitleDraft]     = useState(initialTitle)
  const [elements, setElements]         = useState<BoardElement[]>(initialData.elements ?? [])
  const [arrows, setArrows]             = useState<Arrow[]>(initialData.arrows ?? [])
  const [tool, setTool]                 = useState<Tool>('select')
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const [editingId, setEditingId]       = useState<string | null>(null)
  const [selectedArrowId, setSelectedArrowId] = useState<string | null>(null)
  const [hoveredElId, setHoveredElId]   = useState<string | null>(null)
  const [drawingArrow, setDrawingArrow] = useState<{
    fromId: string; srcX: number; srcY: number; curX: number; curY: number
  } | null>(null)
  const [pan, setPan]                   = useState({ x: 0, y: 0 })
  const [scale, setScale]               = useState(1)
  const [saveStatus, setSaveStatus]     = useState<SaveStatus>('idle')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting]         = useState(false)

  const canvasRef       = useRef<HTMLDivElement>(null)
  const panRef          = useRef(pan)
  const scaleRef        = useRef(scale)
  const saveTimer       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const elementsRef     = useRef(elements)
  const arrowsRef       = useRef(arrows)
  const hoveredElIdRef  = useRef(hoveredElId)
  const drawingArrowRef = useRef(drawingArrow)

  useEffect(() => { panRef.current   = pan },          [pan])
  useEffect(() => { scaleRef.current = scale },        [scale])
  useEffect(() => { elementsRef.current = elements },  [elements])
  useEffect(() => { arrowsRef.current   = arrows },    [arrows])
  useEffect(() => { hoveredElIdRef.current  = hoveredElId },  [hoveredElId])
  useEffect(() => { drawingArrowRef.current = drawingArrow }, [drawingArrow])

  // ── Auto-save ────────────────────────────────────────────────────────────────
  // scheduleSave reads from refs so it always has the latest data
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    saveTimer.current = setTimeout(async () => {
      await supabase
        .from('visual_boards')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ data: { elements: elementsRef.current, arrows: arrowsRef.current } as any, updated_at: new Date().toISOString() })
        .eq('id', boardId)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }, 1200)
  }, [boardId, supabase])

  // ── Element CRUD ─────────────────────────────────────────────────────────────
  function updateEl(id: string, updates: Partial<BoardElement>) {
    setElements(prev => {
      const next = prev.map(el => el.id === id ? { ...el, ...updates } as BoardElement : el)
      elementsRef.current = next
      scheduleSave()
      return next
    })
  }

  function deleteEl(id: string) {
    setElements(prev => {
      const next = prev.filter(el => el.id !== id)
      elementsRef.current = next
      return next
    })
    setArrows(prev => {
      const next = prev.filter(a => a.fromId !== id && a.toId !== id)
      arrowsRef.current = next
      return next
    })
    setSelectedId(null)
    setEditingId(null)
    scheduleSave()
  }

  function addElement(type: BoardElementType, screenX: number, screenY: number) {
    const rect = canvasRef.current!.getBoundingClientRect()
    const wx = (screenX - rect.left - panRef.current.x) / scaleRef.current
    const wy = (screenY - rect.top  - panRef.current.y) / scaleRef.current
    const el = createElement(type, wx - (type === 'note' ? 100 : type === 'image' ? 120 : 160), wy - 75)
    setElements(prev => {
      const next = [...prev, el]
      elementsRef.current = next
      scheduleSave()
      return next
    })
    setSelectedId(el.id)
    setEditingId(el.id)
    setTool('select')
  }

  // Cria um elemento de imagem a partir de um arquivo (arrastar-soltar / colar):
  // faz downscale, sobe pro volume e posiciona no ponto (screenX, screenY).
  async function dropImageFile(file: File, screenX: number, screenY: number) {
    if (!file.type.startsWith('image/') || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const wx = (screenX - rect.left - panRef.current.x) / scaleRef.current
    const wy = (screenY - rect.top  - panRef.current.y) / scaleRef.current
    setSaveStatus('saving')
    try {
      const small = await downscaleImage(file)
      const url = await uploadFile('boards', `${crypto.randomUUID()}.${extForType(small.type)}`, small)
      const el = createElement('image', wx - 120, wy - 100) as ImageElement
      el.url = url
      setElements(prev => {
        const next = [...prev, el]
        elementsRef.current = next
        scheduleSave()
        return next
      })
      setSelectedId(el.id)
    } catch {
      setSaveStatus('idle')
    }
  }

  // ── Arrow CRUD ───────────────────────────────────────────────────────────────
  function addArrow(fromId: string, toId: string) {
    if (fromId === toId) return
    if (arrowsRef.current.some(a => a.fromId === fromId && a.toId === toId)) return
    const arrow: Arrow = { id: crypto.randomUUID(), fromId, toId }
    setArrows(prev => {
      const next = [...prev, arrow]
      arrowsRef.current = next
      scheduleSave()
      return next
    })
    setSelectedArrowId(arrow.id)
  }

  function deleteArrow(id: string) {
    setArrows(prev => {
      const next = prev.filter(a => a.id !== id)
      arrowsRef.current = next
      scheduleSave()
      return next
    })
    setSelectedArrowId(null)
  }

  // ── Arrow drawing ─────────────────────────────────────────────────────────────
  function startDrawingArrow(fromId: string, clientX: number, clientY: number) {
    const rect = canvasRef.current!.getBoundingClientRect()
    const wx = (clientX - rect.left - panRef.current.x) / scaleRef.current
    const wy = (clientY - rect.top  - panRef.current.y) / scaleRef.current
    const el = elementsRef.current.find(e => e.id === fromId)
    if (!el) return
    setDrawingArrow({ fromId, srcX: el.x + el.w / 2, srcY: el.y + el.h / 2, curX: wx, curY: wy })
    setSelectedId(null)
    setSelectedArrowId(null)
  }

  // Global pointer tracking while drawing an arrow
  useEffect(() => {
    if (!drawingArrow) return

    function onMove(e: PointerEvent) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const wx = (e.clientX - rect.left - panRef.current.x) / scaleRef.current
      const wy = (e.clientY - rect.top  - panRef.current.y) / scaleRef.current
      setDrawingArrow(prev => prev ? { ...prev, curX: wx, curY: wy } : null)
    }

    function onUp() {
      const toId = hoveredElIdRef.current
      const from = drawingArrowRef.current
      if (toId && from && toId !== from.fromId) addArrow(from.fromId, toId)
      setDrawingArrow(null)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup',   onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup',   onUp)
    }
  }, [!!drawingArrow]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Canvas panning ────────────────────────────────────────────────────────────
  const isPanning = useRef(false)
  const panStart  = useRef({ mx: 0, my: 0, px: 0, py: 0 })

  function onCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (drawingArrowRef.current) return
    if (tool !== 'select') {
      if (tool !== 'arrow') addElement(tool as BoardElementType, e.clientX, e.clientY)
      return
    }
    setSelectedId(null); setEditingId(null); setSelectedArrowId(null)
    isPanning.current = true
    panStart.current = { mx: e.clientX, my: e.clientY, px: panRef.current.x, py: panRef.current.y }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.style.cursor = 'grabbing'
  }

  function onCanvasPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isPanning.current) return
    setPan({ x: panStart.current.px + (e.clientX - panStart.current.mx), y: panStart.current.py + (e.clientY - panStart.current.my) })
  }

  function onCanvasPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (isPanning.current) {
      isPanning.current = false
      e.currentTarget.releasePointerCapture(e.pointerId)
      e.currentTarget.style.cursor = tool === 'select' ? 'default' : 'crosshair'
    }
  }

  // ── Wheel zoom ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.12 : 0.89
      const rect = canvas!.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const cur = scaleRef.current, p = panRef.current
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cur * factor))
      const wx = (mx - p.x) / cur, wy = (my - p.y) / cur
      setPan({ x: mx - wx * ns, y: my - wy * ns })
      setScale(ns)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editingId) {
        if (selectedId) { deleteEl(selectedId); return }
        if (selectedArrowId) { deleteArrow(selectedArrowId); return }
      }
      if (e.key === 'Escape') {
        setSelectedId(null); setEditingId(null)
        setSelectedArrowId(null); setDrawingArrow(null)
      }
      if (e.key === 'v' || e.key === 'V') setTool('select')
      if (e.key === 'n' || e.key === 'N') setTool('note')
      if (e.key === 't' || e.key === 'T') setTool('text')
      if (e.key === 'i' || e.key === 'I') setTool('image')
      if (e.key === 'a' || e.key === 'A') setTool('arrow')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedId, selectedArrowId, editingId]) // eslint-disable-line

  // Colar imagem (Ctrl/Cmd+V) → cria elemento de imagem no centro do canvas.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (!file) return
      const rect = canvasRef.current?.getBoundingClientRect()
      dropImageFile(file, rect ? rect.left + rect.width / 2 : 0, rect ? rect.top + rect.height / 2 : 0)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zoom helpers ──────────────────────────────────────────────────────────────
  function zoomTo(ns: number) {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const mx = rect.width / 2, my = rect.height / 2
    const wx = (mx - panRef.current.x) / scaleRef.current
    const wy = (my - panRef.current.y) / scaleRef.current
    setPan({ x: mx - wx * ns, y: my - wy * ns })
    setScale(ns)
  }

  function fitToView() {
    if (elements.length === 0) { setPan({ x: 0, y: 0 }); setScale(1); return }
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const margin = 80
    const minX = Math.min(...elements.map(e => e.x))
    const minY = Math.min(...elements.map(e => e.y))
    const maxX = Math.max(...elements.map(e => e.x + e.w))
    const maxY = Math.max(...elements.map(e => e.y + e.h))
    const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE,
      Math.min((rect.width - margin * 2) / (maxX - minX), (rect.height - margin * 2) / (maxY - minY), 1.5)
    ))
    setPan({ x: (rect.width - (maxX - minX) * ns) / 2 - minX * ns, y: (rect.height - (maxY - minY) * ns) / 2 - minY * ns })
    setScale(ns)
  }

  // ── Title save ────────────────────────────────────────────────────────────────
  async function saveTitle() {
    if (!titleDraft.trim()) return
    setTitle(titleDraft.trim()); setEditingTitle(false)
    await updateBoardTitle(boardId, titleDraft.trim())
  }

  // ── Board delete ──────────────────────────────────────────────────────────────
  async function handleDeleteBoard() {
    setDeleting(true)
    await deleteBoard(boardId, orgSlug) // redireciona para /boards
  }

  // ── Canvas background ─────────────────────────────────────────────────────────
  const dotSpacing = GRID_SIZE * scale
  const bgStyle = {
    backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
    backgroundSize: `${dotSpacing}px ${dotSpacing}px`,
    backgroundPosition: `${pan.x % dotSpacing}px ${pan.y % dotSpacing}px`,
  }

  const cursorStyle = tool !== 'select' ? 'crosshair' : 'default'

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>

      <CanvasToolbar tool={tool} onTool={t => { setTool(t); setSelectedId(null); setDrawingArrow(null) }} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── Top bar ── */}
        <div style={{
          height: 48, backgroundColor: '#ffffff', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', paddingLeft: 12, paddingRight: 16,
          gap: 12, flexShrink: 0, zIndex: 10,
        }}>
          <Link
            href={`/${orgSlug}/boards`}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 7, color: '#6b7280', textDecoration: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f3f4f6')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            title="Voltar para quadros"
          >
            <ChevronLeft size={18} />
          </Link>

          {editingTitle ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              <input
                type="text" value={titleDraft} autoFocus
                onChange={e => setTitleDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setTitleDraft(title); setEditingTitle(false) } }}
                onBlur={saveTitle}
                style={{ fontSize: 14, fontWeight: 600, color: '#111827', border: '1.5px solid #6366f1', borderRadius: 7, padding: '3px 8px', outline: 'none', backgroundColor: '#fafafa', fontFamily: 'inherit', maxWidth: 400 }}
              />
              <button onClick={saveTitle} style={iconBtnStyle}><Check size={16} /></button>
              <button onClick={() => { setTitleDraft(title); setEditingTitle(false) }} style={iconBtnStyle}><X size={16} /></button>
            </div>
          ) : (
            <button
              onClick={() => { setTitleDraft(title); setEditingTitle(true) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', borderRadius: 7, fontSize: 14, fontWeight: 600, color: '#111827', fontFamily: 'inherit' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f3f4f6')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              {title}
              <Pencil size={12} color="#9ca3af" />
            </button>
          )}

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9ca3af', minWidth: 80 }}>
            {saveStatus === 'saving' && <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Salvando…</>}
            {saveStatus === 'saved'  && <><Check size={13} color="#22c55e" /> Salvo</>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => zoomTo(Math.max(MIN_SCALE, scaleRef.current * 0.8))} style={zoomBtnStyle} title="Diminuir zoom"><ZoomOut size={14} color="#6b7280" /></button>
            <button onClick={() => zoomTo(1)} style={{ ...zoomBtnStyle, minWidth: 48, fontSize: 11, fontWeight: 600, color: '#6b7280', fontFamily: 'inherit' }} title="Zoom 100%">{Math.round(scale * 100)}%</button>
            <button onClick={() => zoomTo(Math.min(MAX_SCALE, scaleRef.current * 1.2))} style={zoomBtnStyle} title="Aumentar zoom"><ZoomIn size={14} color="#6b7280" /></button>
            <button onClick={fitToView} style={{ ...zoomBtnStyle, marginLeft: 2 }} title="Ajustar à tela"><Maximize2 size={14} color="#6b7280" /></button>
          </div>

          {/* Delete board */}
          <button
            onClick={() => setConfirmDelete(true)}
            title="Excluir quadro"
            style={{ ...zoomBtnStyle, marginLeft: 6 }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#fef2f2'; e.currentTarget.style.borderColor = '#fecaca' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#ffffff'; e.currentTarget.style.borderColor = '#e5e7eb' }}
          >
            <Trash2 size={14} color="#ef4444" />
          </button>
        </div>

        {/* ── Canvas viewport ── */}
        <div
          ref={canvasRef}
          style={{ flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#f8fafc', cursor: cursorStyle, ...bgStyle }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onDragOver={e => { e.preventDefault() }}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) dropImageFile(f, e.clientX, e.clientY) }}
        >
          {/* World transform container */}
          <div style={{
            position: 'absolute', top: 0, left: 0,
            transformOrigin: '0 0',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            width: 0, height: 0,
          }}>

            {/* ── SVG arrow overlay ── */}
            <svg
              style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'visible' }}
              // SVG pointer events handled per-path below
            >
              <defs>
                {/* Default arrowhead */}
                <marker id="ah-def" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
                </marker>
                {/* Selected / active arrowhead */}
                <marker id="ah-sel" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1" />
                </marker>
              </defs>

              {/* Persistent arrows */}
              {arrows.map(arrow => {
                const src = elements.find(e => e.id === arrow.fromId)
                const tgt = elements.find(e => e.id === arrow.toId)
                if (!src || !tgt) return null
                const { d, mid } = buildArrowPath(src, tgt)
                const isSel = selectedArrowId === arrow.id
                return (
                  <g key={arrow.id}>
                    {/* Invisible wide hit area */}
                    <path
                      d={d}
                      stroke="transparent"
                      strokeWidth={18}
                      fill="none"
                      style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                      onClick={() => { setSelectedArrowId(arrow.id); setSelectedId(null) }}
                    />
                    {/* Visible curve */}
                    <path
                      d={d}
                      stroke={isSel ? '#6366f1' : '#94a3b8'}
                      strokeWidth={isSel ? 2.5 : 1.5}
                      fill="none"
                      markerEnd={isSel ? 'url(#ah-sel)' : 'url(#ah-def)'}
                      style={{ pointerEvents: 'none' }}
                    />
                    {/* Delete button at bezier midpoint */}
                    {isSel && (
                      <g
                        transform={`translate(${mid.x}, ${mid.y})`}
                        style={{ cursor: 'pointer', pointerEvents: 'all' }}
                        onClick={e => { e.stopPropagation(); deleteArrow(arrow.id) }}
                      >
                        <circle r={11} fill="#1f2937" />
                        <line x1="-4" y1="-4" x2="4" y2="4" stroke="#f87171" strokeWidth={1.8} strokeLinecap="round" />
                        <line x1="4" y1="-4" x2="-4" y2="4" stroke="#f87171" strokeWidth={1.8} strokeLinecap="round" />
                      </g>
                    )}
                  </g>
                )
              })}

              {/* Temporary arrow while drawing */}
              {drawingArrow && (
                <path
                  d={tempPath(drawingArrow.srcX, drawingArrow.srcY, drawingArrow.curX, drawingArrow.curY)}
                  stroke="#6366f1"
                  strokeWidth={2}
                  strokeDasharray="7 4"
                  fill="none"
                  markerEnd="url(#ah-sel)"
                  style={{ pointerEvents: 'none' }}
                />
              )}
            </svg>

            {/* Elements */}
            {elements.map(el => (
              <CanvasEl
                key={el.id}
                el={el}
                selected={selectedId === el.id}
                editing={editingId === el.id}
                scale={scale}
                isArrowTool={tool === 'arrow'}
                isHovered={hoveredElId === el.id}
                onSelect={() => { setSelectedId(el.id); setSelectedArrowId(null) }}
                onStartEdit={() => setEditingId(el.id)}
                onUpdate={updates => updateEl(el.id, updates)}
                onDelete={() => deleteEl(el.id)}
                onArrowStart={e => startDrawingArrow(el.id, e.clientX, e.clientY)}
                onHoverEnter={() => setHoveredElId(el.id)}
                onHoverLeave={() => setHoveredElId(null)}
              >
                {el.type === 'note' && (
                  <NoteEl
                    el={el}
                    selected={selectedId === el.id}
                    editing={editingId === el.id}
                    onUpdate={u => updateEl(el.id, u)}
                    onStopEdit={content => { updateEl(el.id, { content }); setEditingId(null) }}
                  />
                )}
                {el.type === 'text' && (
                  <TextEl
                    el={el}
                    selected={selectedId === el.id}
                    editing={editingId === el.id}
                    onUpdate={u => updateEl(el.id, u)}
                    onStopEdit={content => { updateEl(el.id, { content }); setEditingId(null) }}
                  />
                )}
                {el.type === 'image' && (
                  <ImageEl
                    el={el}
                    selected={selectedId === el.id}
                    editing={editingId === el.id}
                    onUpdate={u => updateEl(el.id, u)}
                    onStopEdit={() => setEditingId(null)}
                  />
                )}
              </CanvasEl>
            ))}
          </div>

          {/* Empty state */}
          {elements.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#94a3b8', margin: 0 }}>Canvas vazio</p>
              <p style={{ fontSize: 13, color: '#cbd5e1', marginTop: 6, textAlign: 'center' }}>
                Escolha uma ferramenta e clique aqui — ou arraste/cole uma imagem direto no canvas
              </p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Excluir este quadro?"
        description={`"${title}" e todo o seu conteúdo serão removidos permanentemente. Essa ação não pode ser desfeita.`}
        confirmLabel="Excluir quadro"
        loading={deleting}
        onConfirm={handleDeleteBoard}
        onCancel={() => setConfirmDelete(false)}
      />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Shared styles ──────────────────────────────────────────────────────────────

const zoomBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: 28, minWidth: 28, borderRadius: 6,
  border: '1px solid #e5e7eb', backgroundColor: '#ffffff',
  cursor: 'pointer', padding: '0 4px',
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: '#6366f1', display: 'flex', alignItems: 'center',
}
