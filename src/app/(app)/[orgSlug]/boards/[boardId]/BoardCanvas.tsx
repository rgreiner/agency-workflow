'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import type { BoardElement, BoardData, Arrow, BoardElementType } from '@/types/board'
import { createElement } from '@/types/board'
import { updateBoardTitle } from '@/app/actions/boards'
import { createClient } from '@/lib/supabase/client'
import { NoteEl } from './elements/NoteEl'
import { TextEl } from './elements/TextEl'
import { ImageEl } from './elements/ImageEl'
import {
  ChevronLeft, Check, Loader2,
  MousePointer2, StickyNote, Type, ImageIcon,
  Trash2, ZoomIn, ZoomOut, Maximize2, Pencil, X,
} from 'lucide-react'
import Link from 'next/link'

// ── Constants ─────────────────────────────────────────────────────────────────
const MIN_SCALE = 0.15
const MAX_SCALE = 4.0
const GRID_SIZE = 24

type Tool = 'select' | 'note' | 'text' | 'image'
type SaveStatus = 'idle' | 'saving' | 'saved'

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  boardId: string
  orgSlug: string
  initialTitle: string
  initialData: BoardData
}

// ── Canvas element wrapper ────────────────────────────────────────────────────
function CanvasEl({
  el, selected, editing, scale,
  onSelect, onStartEdit, onUpdate, onDelete,
  children,
}: {
  el: BoardElement
  selected: boolean
  editing: boolean
  scale: number
  onSelect: () => void
  onStartEdit: () => void
  onUpdate: (u: Partial<BoardElement>) => void
  onDelete: () => void
  children: React.ReactNode
}) {
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // ── Drag ──────────────────────────────────────────────────────────────────
  const dragging = useRef(false)
  const dragOrigin = useRef({ mx: 0, my: 0, ex: 0, ey: 0 })

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (editing) return
    e.stopPropagation()
    onSelect()
    dragging.current = true
    dragOrigin.current = { mx: e.clientX, my: e.clientY, ex: el.x, ey: el.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    const s = scaleRef.current
    const dx = (e.clientX - dragOrigin.current.mx) / s
    const dy = (e.clientY - dragOrigin.current.my) / s
    onUpdate({ x: dragOrigin.current.ex + dx, y: dragOrigin.current.ey + dy })
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragging.current) {
      dragging.current = false
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  // ── Resize ────────────────────────────────────────────────────────────────
  const resizing = useRef(false)
  const resizeOrigin = useRef({ mx: 0, my: 0, ow: 0, oh: 0 })

  function handleResizeDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation()
    e.preventDefault()
    resizing.current = true
    resizeOrigin.current = { mx: e.clientX, my: e.clientY, ow: el.w, oh: el.h }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handleResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing.current) return
    const s = scaleRef.current
    const dw = (e.clientX - resizeOrigin.current.mx) / s
    const dh = (e.clientY - resizeOrigin.current.my) / s
    onUpdate({
      w: Math.max(100, resizeOrigin.current.ow + dw),
      h: Math.max(50,  resizeOrigin.current.oh + dh),
    })
  }

  function handleResizeUp(e: React.PointerEvent<HTMLDivElement>) {
    if (resizing.current) {
      resizing.current = false
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div
      style={{
        position:  'absolute',
        left:       el.x,
        top:        el.y,
        width:      el.w,
        height:     el.h,
        outline:    selected ? '2px solid #6366f1' : 'none',
        outlineOffset: 2,
        borderRadius: 10,
        cursor:     editing ? 'default' : dragging.current ? 'grabbing' : 'grab',
        userSelect: editing ? 'text' : 'none',
        zIndex:     selected ? 100 : 1,
        overflow: 'visible',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={e => { e.stopPropagation(); onStartEdit() }}
    >
      {children}

      {/* Delete button */}
      {selected && !editing && (
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onDelete() }}
          style={{
            position: 'absolute', top: -36, right: 0,
            width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: '#1f2937',
            borderRadius: 7,
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            zIndex: 200,
          }}
          title="Excluir (Del)"
        >
          <Trash2 size={12} color="#f87171" />
        </button>
      )}

      {/* Resize handle — bottom-right */}
      {selected && !editing && (
        <div
          style={{
            position: 'absolute', right: -5, bottom: -5,
            width: 12, height: 12,
            backgroundColor: '#6366f1',
            borderRadius: 3,
            cursor: 'se-resize',
            zIndex: 200,
            border: '2px solid #fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
        />
      )}
    </div>
  )
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
const TOOLS = [
  { id: 'select', icon: MousePointer2, label: 'Selecionar  (V)' },
  { id: 'note',   icon: StickyNote,    label: 'Nota  (N)'       },
  { id: 'text',   icon: Type,          label: 'Texto  (T)'      },
  { id: 'image',  icon: ImageIcon,     label: 'Imagem  (I)'     },
] as const

function CanvasToolbar({ tool, onTool }: { tool: Tool; onTool: (t: Tool) => void }) {
  return (
    <div
      style={{
        width: 52,
        height: '100%',
        backgroundColor: '#111827',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 12,
        gap: 4,
        flexShrink: 0,
        borderRight: '1px solid #1f2937',
      }}
    >
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
            border: 'none',
            cursor: 'pointer',
            transition: 'background-color 0.1s',
          }}
        >
          <Icon size={17} color={tool === id ? '#ffffff' : '#6b7280'} />
        </button>
      ))}

      {/* Separator */}
      <div style={{ width: 24, height: 1, backgroundColor: '#1f2937', margin: '4px 0' }} />

      {/* Tool hint */}
      {tool !== 'select' && (
        <div style={{
          position: 'absolute',
          left: 60,
          top: 8,
          backgroundColor: '#1f2937',
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 11,
          color: '#9ca3af',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          zIndex: 300,
        }}>
          Clique no canvas para adicionar
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function BoardCanvas({ boardId, orgSlug, initialTitle, initialData }: Props) {
  const supabase = createClient()

  const [title, setTitle]           = useState(initialTitle)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(initialTitle)
  const [elements, setElements]     = useState<BoardElement[]>(initialData.elements ?? [])
  const [arrows]                    = useState<Arrow[]>(initialData.arrows ?? [])
  const [tool, setTool]             = useState<Tool>('select')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [pan, setPan]               = useState({ x: 0, y: 0 })
  const [scale, setScale]           = useState(1)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  const canvasRef  = useRef<HTMLDivElement>(null)
  const panRef     = useRef(pan)
  const scaleRef   = useRef(scale)
  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const elementsRef = useRef(elements)

  useEffect(() => { panRef.current = pan }, [pan])
  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { elementsRef.current = elements }, [elements])

  // ── Auto-save ──────────────────────────────────────────────────────────────
  const scheduleSave = useCallback((els: BoardElement[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    saveTimer.current = setTimeout(async () => {
      await supabase
        .from('visual_boards')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ data: { elements: els, arrows } as any, updated_at: new Date().toISOString() })
        .eq('id', boardId)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }, 1200)
  }, [boardId, arrows, supabase])

  // ── Element CRUD ───────────────────────────────────────────────────────────
  function updateEl(id: string, updates: Partial<BoardElement>) {
    setElements(prev => {
      const next = prev.map(el => el.id === id ? { ...el, ...updates } as BoardElement : el)
      scheduleSave(next)
      return next
    })
  }

  function deleteEl(id: string) {
    setElements(prev => {
      const next = prev.filter(el => el.id !== id)
      scheduleSave(next)
      return next
    })
    setSelectedId(null)
    setEditingId(null)
  }

  function addElement(type: BoardElementType, screenX: number, screenY: number) {
    const rect = canvasRef.current!.getBoundingClientRect()
    const worldX = (screenX - rect.left - panRef.current.x) / scaleRef.current
    const worldY = (screenY - rect.top  - panRef.current.y) / scaleRef.current
    const el = createElement(type, worldX - (type === 'note' ? 100 : type === 'image' ? 120 : 160), worldY - 75)
    setElements(prev => {
      const next = [...prev, el]
      scheduleSave(next)
      return next
    })
    setSelectedId(el.id)
    if (type !== 'image') setEditingId(el.id)
    else setEditingId(el.id) // image: show URL input
    setTool('select')
  }

  // ── Canvas panning ─────────────────────────────────────────────────────────
  const isPanning = useRef(false)
  const panStart  = useRef({ mx: 0, my: 0, px: 0, py: 0 })

  function onCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Only fires when clicking directly on the canvas background
    if (tool !== 'select') {
      addElement(tool as BoardElementType, e.clientX, e.clientY)
      return
    }
    // Deselect
    setSelectedId(null)
    setEditingId(null)
    // Pan
    isPanning.current = true
    panStart.current = { mx: e.clientX, my: e.clientY, px: panRef.current.x, py: panRef.current.y }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.style.cursor = 'grabbing'
  }

  function onCanvasPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isPanning.current) return
    const dx = e.clientX - panStart.current.mx
    const dy = e.clientY - panStart.current.my
    setPan({ x: panStart.current.px + dx, y: panStart.current.py + dy })
  }

  function onCanvasPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (isPanning.current) {
      isPanning.current = false
      e.currentTarget.releasePointerCapture(e.pointerId)
      e.currentTarget.style.cursor = tool === 'select' ? 'default' : 'crosshair'
    }
  }

  // ── Wheel zoom ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.12 : 0.89
      const rect = canvas!.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const cur = scaleRef.current
      const pan = panRef.current
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cur * factor))
      const worldX = (mx - pan.x) / cur
      const worldY = (my - pan.y) / cur
      setPan({ x: mx - worldX * newScale, y: my - worldY * newScale })
      setScale(newScale)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        deleteEl(selectedId)
      }
      if (e.key === 'Escape') { setSelectedId(null); setEditingId(null) }
      if (e.key === 'v' || e.key === 'V') setTool('select')
      if (e.key === 'n' || e.key === 'N') setTool('note')
      if (e.key === 't' || e.key === 'T') setTool('text')
      if (e.key === 'i' || e.key === 'I') setTool('image')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedId, editingId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zoom helpers ───────────────────────────────────────────────────────────
  function zoomTo(newScale: number) {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const mx = rect.width / 2
    const my = rect.height / 2
    const worldX = (mx - panRef.current.x) / scaleRef.current
    const worldY = (my - panRef.current.y) / scaleRef.current
    setPan({ x: mx - worldX * newScale, y: my - worldY * newScale })
    setScale(newScale)
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
    const contentW = maxX - minX
    const contentH = maxY - minY
    const newScale = Math.min(
      (rect.width  - margin * 2) / contentW,
      (rect.height - margin * 2) / contentH,
      1.5
    )
    const clampedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale))
    setPan({
      x: (rect.width  - contentW * clampedScale) / 2 - minX * clampedScale,
      y: (rect.height - contentH * clampedScale) / 2 - minY * clampedScale,
    })
    setScale(clampedScale)
  }

  // ── Title save ─────────────────────────────────────────────────────────────
  async function saveTitle() {
    if (!titleDraft.trim()) return
    setTitle(titleDraft.trim())
    setEditingTitle(false)
    await updateBoardTitle(boardId, titleDraft.trim())
  }

  // ── Canvas background ──────────────────────────────────────────────────────
  const dotSpacing = GRID_SIZE * scale
  const bgStyle = {
    backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
    backgroundSize:  `${dotSpacing}px ${dotSpacing}px`,
    backgroundPosition: `${pan.x % dotSpacing}px ${pan.y % dotSpacing}px`,
  }

  const cursorStyle = tool !== 'select' ? 'crosshair' : 'default'

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>

      {/* ── Left toolbar ── */}
      <CanvasToolbar tool={tool} onTool={t => { setTool(t); setSelectedId(null) }} />

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── Top bar ── */}
        <div style={{
          height: 48,
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 12,
          paddingRight: 16,
          gap: 12,
          flexShrink: 0,
          zIndex: 10,
        }}>
          <Link
            href={`/${orgSlug}/boards`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, borderRadius: 7,
              color: '#6b7280', textDecoration: 'none',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f3f4f6')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            title="Voltar para quadros"
          >
            <ChevronLeft size={18} />
          </Link>

          {/* Title */}
          {editingTitle ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
              <input
                type="text"
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setTitleDraft(title); setEditingTitle(false) } }}
                onBlur={saveTitle}
                autoFocus
                style={{
                  fontSize: 14, fontWeight: 600, color: '#111827',
                  border: '1.5px solid #6366f1', borderRadius: 7,
                  padding: '3px 8px', outline: 'none',
                  backgroundColor: '#fafafa', fontFamily: 'inherit',
                  maxWidth: 400,
                }}
              />
              <button onClick={saveTitle} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6366f1', display: 'flex' }}>
                <Check size={16} />
              </button>
              <button onClick={() => { setTitleDraft(title); setEditingTitle(false) }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex' }}>
                <X size={16} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setTitleDraft(title); setEditingTitle(true) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '3px 6px', borderRadius: 7,
                fontSize: 14, fontWeight: 600, color: '#111827',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f3f4f6')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              {title}
              <Pencil size={12} color="#9ca3af" />
            </button>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Save status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9ca3af', minWidth: 80 }}>
            {saveStatus === 'saving' && <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Salvando…</>}
            {saveStatus === 'saved'  && <><Check size={13} color="#22c55e" /> Salvo</>}
          </div>

          {/* Zoom controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button onClick={() => zoomTo(Math.max(MIN_SCALE, scaleRef.current * 0.8))} title="Diminuir zoom"
              style={zoomBtnStyle}>
              <ZoomOut size={14} color="#6b7280" />
            </button>
            <button
              onClick={() => zoomTo(1)}
              title="Zoom 100%"
              style={{ ...zoomBtnStyle, minWidth: 48, fontSize: 11, fontWeight: 600, color: '#6b7280', fontFamily: 'inherit' }}
            >
              {Math.round(scale * 100)}%
            </button>
            <button onClick={() => zoomTo(Math.min(MAX_SCALE, scaleRef.current * 1.2))} title="Aumentar zoom"
              style={zoomBtnStyle}>
              <ZoomIn size={14} color="#6b7280" />
            </button>
            <button onClick={fitToView} title="Ajustar à tela"
              style={{ ...zoomBtnStyle, marginLeft: 2 }}>
              <Maximize2 size={14} color="#6b7280" />
            </button>
          </div>
        </div>

        {/* ── Canvas ── */}
        <div
          ref={canvasRef}
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: '#f8fafc',
            cursor: cursorStyle,
            ...bgStyle,
          }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
        >
          {/* World transform */}
          <div
            style={{
              position: 'absolute',
              top: 0, left: 0,
              transformOrigin: '0 0',
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              width: 0, height: 0, // intrinsic size doesn't matter; elements are absolute
            }}
          >
            {elements.map(el => (
              <CanvasEl
                key={el.id}
                el={el}
                selected={selectedId === el.id}
                editing={editingId === el.id}
                scale={scale}
                onSelect={() => setSelectedId(el.id)}
                onStartEdit={() => setEditingId(el.id)}
                onUpdate={updates => updateEl(el.id, updates)}
                onDelete={() => deleteEl(el.id)}
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

          {/* Empty state hint */}
          {elements.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
            }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#94a3b8', margin: 0 }}>Canvas vazio</p>
              <p style={{ fontSize: 13, color: '#cbd5e1', marginTop: 6, textAlign: 'center' }}>
                Selecione uma ferramenta na barra lateral e clique aqui para começar
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Keyframe for spin */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const zoomBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: 28, minWidth: 28,
  borderRadius: 6,
  border: '1px solid #e5e7eb',
  backgroundColor: '#ffffff',
  cursor: 'pointer',
  transition: 'background-color 0.1s',
  padding: '0 4px',
}
