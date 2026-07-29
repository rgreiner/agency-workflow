'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { updateBoardTitle, deleteBoard } from '@/app/actions/boards'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { cn } from '@/lib/utils'
import { BoardAccessControl } from './BoardAccessControl'
import type { MemberRole } from '@/types'
import {
  ChevronLeft, Check, Loader2, Pencil, X, Trash2, ZoomIn, ZoomOut,
  FileDown, Printer, Plus, Palette, Crosshair, LayoutGrid, ArrowLeftRight,
  Bold, Italic, Type, Maximize2, Minus,
} from 'lucide-react'
import {
  type MindNode, type MindMapData, type LaidNode, MIND_COLORS, TEXT_COLORS,
  LINE_H, PAD_X, newNode, layoutMap, edgePath, underlinePath, branchWidth, nodeBox, addChild, addSibling,
  removeNode, updateNode, findParent, findNode, toMarkdown, slugify,
  clearOffsets, hasOffsets, countNodes,
} from '@/types/mindmap'

const Z_MIN = 0.2
const Z_MAX = 3
const clampZ = (z: number) => Math.min(Z_MAX, Math.max(Z_MIN, z))

/** Câmera do canvas: o mapa inteiro é um `translate + scale`, não um scroll. */
interface View { x: number; y: number; z: number }

export function MindMapCanvas({ boardId, orgSlug, initialTitle, initialData, viewerRole, initialMinRole }: {
  boardId: string; orgSlug: string; initialTitle: string; initialData: MindMapData
  viewerRole: MemberRole; initialMinRole: MemberRole
}) {
  const supabase = createClient()
  const [title, setTitle] = useState(initialTitle)
  const [titleDraft, setTitleDraft] = useState(initialTitle)
  const [editingTitle, setEditingTitle] = useState(false)
  const [root, setRoot] = useState<MindNode>(initialData.root)
  const [selId, setSelId] = useState(initialData.root.id)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 })
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pop, setPop] = useState<null | 'no' | 'texto'>(null)
  const [panning, setPanning] = useState(false)

  const rootRef = useRef(root)
  useEffect(() => { rootRef.current = root }, [root])
  const pending = useRef<MindNode | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  const layout = useMemo(() => layoutMap(root), [root])
  const posById = useMemo(() => new Map(layout.nodes.map(n => [n.node.id, n])), [layout])
  const layoutRef = useRef(layout)
  useEffect(() => { layoutRef.current = layout }, [layout])
  const viewRef = useRef(view)
  useEffect(() => { viewRef.current = view }, [view])

  // Arrasto do nó: guarda a base no pointerdown pra o delta não acumular erro.
  const dragRef = useRef<{ id: string; sx: number; sy: number; dx0: number; dy0: number; base: MindNode; moved: boolean } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // O click dispara depois do pointerup: sem esta trava, terminar um arrasto
  // sobre o nó selecionado abriria a edição.
  const justDragged = useRef(false)
  // Arrasto do fundo: move a câmera, não o conteúdo.
  const panRef = useRef<{ sx: number; sy: number; x0: number; y0: number } | null>(null)

  // ── Câmera ────────────────────────────────────────────────────────────────
  /** Zoom ancorado num ponto da tela: o que está sob o cursor não escapa dele. */
  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setView(v => {
      const z = clampZ(v.z * factor)
      const k = z / v.z
      return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
    })
  }, [])

  /** Zoom pelos botões/teclado: âncora no meio da tela. */
  const zoomCenter = useCallback((factor: number) => {
    const el = viewportRef.current
    if (!el) return
    zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor)
  }, [zoomAt])

  /** Põe a raiz no meio da tela, mantendo o zoom atual. */
  const centerView = useCallback(() => {
    const el = viewportRef.current
    const r = layoutRef.current.nodes.find(n => n.side === 'root')
    if (!el || !r) return
    setView(v => ({
      ...v,
      x: el.clientWidth / 2 - (r.x + r.w / 2) * v.z,
      y: el.clientHeight / 2 - (r.y + r.h / 2) * v.z,
    }))
  }, [])

  /** Ajusta o zoom pro mapa inteiro caber na tela. */
  const fitView = useCallback(() => {
    const el = viewportRef.current
    const L = layoutRef.current
    if (!el) return
    const z = clampZ(Math.min(el.clientWidth / L.width, el.clientHeight / L.height, 1))
    setView({ z, x: (el.clientWidth - L.width * z) / 2, y: (el.clientHeight - L.height * z) / 2 })
  }, [])

  // No load: raiz centralizada (o mapa cresce a partir do centro) e canvas focado —
  // sem o foco o teclado só "liga" depois do primeiro clique.
  useEffect(() => {
    centerView()
    viewportRef.current?.focus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll do mouse = zoom (ctrl/⌘ + scroll também, que é o pinch do trackpad).
  // Precisa ser listener nativo não-passivo: o React registra wheel como passivo
  // e o preventDefault seria ignorado (a página inteira rolaria junto).
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Shift+scroll = deslocar na horizontal, como em qualquer canvas.
        setView(v => ({ ...v, x: v.x - e.deltaY }))
        return
      }
      zoomAt(cx, cy, Math.exp(-e.deltaY * 0.0015))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

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
  // O teclado vive no viewport (tabIndex=0): toda vez que a edição acaba o foco TEM
  // que voltar pra cá, senão some pro body e Tab/Enter param de responder.
  function focusCanvas() { viewportRef.current?.focus() }
  function startEdit(id: string) { setEditingId(id) }
  function stopEdit() { setEditingId(null); focusCanvas() }

  // ── Entrar em edição com o cursor onde a pessoa clicou ─────────────────────
  // Sem isso a edição começa sempre no fim do texto e corrigir uma palavra no
  // meio vira tentativa e erro. O offset é lido do <span> AINDA montado (antes
  // do React trocar por <textarea>) e aplicado no textarea quando ele monta.
  const pendingCaret = useRef<number | null>(null)
  // O textarea re-renderiza a cada tecla (o texto é salvo direto); sem esta
  // marca o ref reposicionaria o cursor no fim a cada caractere digitado.
  const caretAppliedRef = useRef<HTMLTextAreaElement | null>(null)

  function caretOffsetFromPoint(clientX: number, clientY: number): number | null {
    const d = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
    let node: Node | null = null
    let offset = 0
    if (d.caretRangeFromPoint) {
      const r = d.caretRangeFromPoint(clientX, clientY)
      if (!r) return null
      node = r.startContainer; offset = r.startOffset
    } else if (d.caretPositionFromPoint) {
      const p = d.caretPositionFromPoint(clientX, clientY)
      if (!p) return null
      node = p.offsetNode; offset = p.offset
    }
    // Só serve se caiu direto no texto do nó (nó vazio mostra o placeholder).
    return node && node.nodeType === Node.TEXT_NODE ? offset : null
  }

  function beginEditAt(id: string, clientX?: number, clientY?: number) {
    pendingCaret.current = clientX != null && clientY != null ? caretOffsetFromPoint(clientX, clientY) : null
    setSelId(id)
    startEdit(id)
  }
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
    const node = findNode(r, id)
    const kids = node ? countNodes(node) - 1 : 0
    commit(removeNode(r, id))
    setSelId(parent?.id ?? r.id)
    // Apagar um ramo leva a subárvore junto: sempre dá pra voltar.
    toast(kids > 0 ? `Ramo excluído (${kids + 1} tópicos)` : 'Tópico excluído', {
      action: { label: 'Desfazer', onClick: () => { commit(r); setSelId(id) } },
    })
  }
  function toggleCollapse(id: string) {
    const n = findNode(rootRef.current, id)
    if (!n?.children.length) return
    commit(updateNode(rootRef.current, id, { collapsed: !n.collapsed }))
  }
  function patchSel(patch: Partial<MindNode>) {
    commit(updateNode(rootRef.current, selId, patch))
  }
  function toggleMark(key: 'bold' | 'italic') {
    const n = findNode(rootRef.current, selId)
    if (!n) return
    patchSel(key === 'bold' ? { bold: !n.bold } : { italic: !n.italic })
  }
  function flipSide(id: string) {
    const cur = posById.get(id)?.side
    commit(updateNode(rootRef.current, id, { side: cur === 'left' ? 'right' : 'left' }))
  }
  function reorganizar() {
    commit(clearOffsets(rootRef.current))
    toast.success('Layout automático restaurado.')
  }

  // ── Arrastar nó: posição livre; a subárvore acompanha (dx/dy é offset do auto) ──
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
    const dx = (e.clientX - d.sx) / viewRef.current.z
    const dy = (e.clientY - d.sy) / viewRef.current.z
    // Tolerância: sem isso um clique com 1px de tremida já viraria arrasto.
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    if (!d.moved) { d.moved = true; setDraggingId(d.id) }
    commit(updateNode(d.base, d.id, { dx: Math.round(d.dx0 + dx), dy: Math.round(d.dy0 + dy) }))
  }
  function onNodeUp(e: React.PointerEvent) {
    const d = dragRef.current
    dragRef.current = null
    if (d?.moved) {
      justDragged.current = true
      setDraggingId(null)
      e.stopPropagation()
      pinSideAfterDrag(d.id)
    }
  }

  /**
   * Ao soltar um ramo de nível 1, grava o lado onde ele ficou. Sem isso o
   * balanceamento automático continua mandando e o nó volta/abre pro lado
   * errado. Ao trocar de lado, o dx/dy é recalculado pro nó ficar EXATAMENTE
   * onde foi solto — mudar de lado não pode empurrar nada.
   */
  function pinSideAfterDrag(id: string) {
    const r = rootRef.current
    if (findParent(r, id)?.id !== r.id) return   // só nível 1 tem lado
    const L = layoutRef.current
    const ln = L.nodes.find(n => n.node.id === id)
    const rootLn = L.nodes.find(n => n.side === 'root')
    if (!ln || !rootLn) return

    const side: 'left' | 'right' =
      ln.x + ln.w / 2 < rootLn.x + rootLn.w / 2 ? 'left' : 'right'
    if (ln.side === side) {
      // Mesmo lado: só fixa, nada se move.
      if (findNode(r, id)?.side !== side) commit(updateNode(r, id, { side }))
      return
    }

    // Trocou de lado: mede a posição automática do outro lado (dx/dy zerados) e
    // devolve o deslocamento que mantém o nó no lugar em que foi solto.
    // Coordenadas relativas à raiz porque cada layout normaliza a origem.
    const probe = layoutMap(updateNode(r, id, { side, dx: 0, dy: 0 }))
    const pn = probe.nodes.find(n => n.node.id === id)
    const pr = probe.nodes.find(n => n.side === 'root')
    if (!pn || !pr) { commit(updateNode(r, id, { side })); return }
    const dx = Math.round((ln.x - rootLn.x) - (pn.x - pr.x))
    const dy = Math.round((ln.y - rootLn.y) - (pn.y - pr.y))
    commit(updateNode(r, id, { side, dx, dy }))
  }

  // ── Arrastar o fundo = mover o mapa inteiro ────────────────────────────────
  function onBgDown(e: React.PointerEvent) {
    // Botão do meio arrasta de qualquer lugar; o esquerdo só a partir do fundo.
    if (e.button !== 0 && e.button !== 1) return
    if (e.button === 0 && (e.target as HTMLElement).closest('[data-node]')) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    panRef.current = { sx: e.clientX, sy: e.clientY, x0: viewRef.current.x, y0: viewRef.current.y }
    setPanning(true)
    setPop(null)
    focusCanvas()
  }
  function onBgMove(e: React.PointerEvent) {
    const p = panRef.current
    if (!p) return
    setView(v => ({ ...v, x: p.x0 + (e.clientX - p.sx), y: p.y0 + (e.clientY - p.sy) }))
  }
  function onBgUp() { panRef.current = null; setPanning(false) }

  // ── Teclado: é o que faz mapa mental valer a pena ──────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    // Zoom por teclado funciona mesmo durante a edição de texto.
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomCenter(1.2); return }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomCenter(1 / 1.2); return }
      if (e.key === '0')                  { e.preventDefault(); setView(v => ({ ...v, z: 1 })); centerView(); return }
    }
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
    else if (e.key === ' ') { e.preventDefault(); toggleCollapse(sel) }
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
          <button onClick={fitView} title="Ajustar o mapa inteiro à tela" aria-label="Ajustar à tela"
            className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50"><Maximize2 className="w-3.5 h-3.5 text-gray-500" /></button>
          <button onClick={reorganizar} disabled={!hasOffsets(root)}
            title={hasOffsets(root) ? 'Reorganizar: volta tudo ao layout automático' : 'Nada foi movido à mão'}
            aria-label="Reorganizar"
            className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"><LayoutGrid className="w-3.5 h-3.5 text-gray-500" /></button>
          <button onClick={() => zoomCenter(1 / 1.15)} aria-label="Diminuir zoom" className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50"><ZoomOut className="w-3.5 h-3.5 text-gray-500" /></button>
          <button onClick={() => { setView(v => ({ ...v, z: 1 })); centerView() }} title="Zoom 100%"
            className="px-2 py-1.5 text-[11px] font-semibold text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 min-w-[44px]">{Math.round(view.z * 100)}%</button>
          <button onClick={() => zoomCenter(1.15)} aria-label="Aumentar zoom" className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50"><ZoomIn className="w-3.5 h-3.5 text-gray-500" /></button>
        </div>

        <div className="w-px h-5 bg-gray-200 mx-0.5" />

        <BoardAccessControl boardId={boardId} initialMinRole={initialMinRole} viewerRole={viewerRole} />

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
        <button onClick={() => toggleCollapse(selId)} disabled={!selNode?.children.length}
          title={selNode?.collapsed ? 'Expandir daqui em diante' : 'Ocultar daqui em diante'}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition">
          {selNode?.collapsed ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          {selNode?.collapsed ? 'Expandir' : 'Ocultar'} <kbd className="text-[10px] text-gray-400">Espaço</kbd>
        </button>

        <span className="text-gray-200">|</span>

        {/* Formatação do nó selecionado */}
        <button onClick={() => toggleMark('bold')} title="Negrito" aria-pressed={!!selNode?.bold}
          className={cn('p-1.5 rounded-lg border transition', selNode?.bold ? 'border-orange-300 bg-orange-50 text-orange-600' : 'border-gray-200 hover:bg-gray-50')}>
          <Bold className="w-3 h-3" />
        </button>
        <button onClick={() => toggleMark('italic')} title="Itálico" aria-pressed={!!selNode?.italic}
          className={cn('p-1.5 rounded-lg border transition', selNode?.italic ? 'border-orange-300 bg-orange-50 text-orange-600' : 'border-gray-200 hover:bg-gray-50')}>
          <Italic className="w-3 h-3" />
        </button>

        <div className="relative">
          <button onClick={() => setPop(p => (p === 'no' ? null : 'no'))}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 transition">
            <Palette className="w-3 h-3" /> Cor do nó
          </button>
          {pop === 'no' && (
            <ColorPop colors={MIND_COLORS} current={selNode?.color}
              onPick={c => { patchSel({ color: c }); setPop(null) }} onClose={() => setPop(null)} />
          )}
        </div>
        <div className="relative">
          <button onClick={() => setPop(p => (p === 'texto' ? null : 'texto'))}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 transition">
            <Type className="w-3 h-3" /> Cor do texto
          </button>
          {pop === 'texto' && (
            <ColorPop colors={TEXT_COLORS} current={selNode?.textColor}
              onPick={c => { patchSel({ textColor: c }); setPop(null) }}
              onReset={() => { patchSel({ textColor: undefined }); setPop(null) }}
              onClose={() => setPop(null)} />
          )}
        </div>

        {posById.get(selId)?.depth === 1 && (
          <button onClick={() => flipSide(selId)} title="Joga o ramo pro outro lado da raiz"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 transition">
            <ArrowLeftRight className="w-3 h-3" /> Trocar de lado
          </button>
        )}
        <span className="text-gray-300">·</span>
        <span className="truncate max-w-[220px]">Selecionado: <strong className="text-gray-600">{selNode?.text || '(vazio)'}</strong></span>
        <div className="flex-1" />
        <span className="text-gray-400 hidden xl:block">F2 renomeia · arraste o fundo pra mover · scroll dá zoom · ⌘+ / ⌘−</span>
      </div>

      {/* Canvas: câmera por transform (nada de scrollbar) */}
      <div
        ref={viewportRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onBgDown}
        onPointerMove={onBgMove}
        onPointerUp={onBgUp}
        onPointerCancel={onBgUp}
        className={cn(
          'flex-1 relative overflow-hidden outline-none touch-none',
          panning ? 'cursor-grabbing' : 'cursor-grab',
        )}
        style={{
          // Malha de pontos: dá noção de deslocamento ao arrastar o fundo.
          backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
          backgroundSize: `${24 * view.z}px ${24 * view.z}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        <div
          style={{
            position: 'absolute', top: 0, left: 0,
            width: layout.width, height: layout.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
            transformOrigin: '0 0',
          }}
        >
          <svg width={layout.width} height={layout.height} className="absolute inset-0 pointer-events-none overflow-visible">
            {/* Traço do ramo: chega na base do filho e segue no sublinhado —
                um único gesto do centro até a folha, afinando com a profundidade. */}
            {layout.edges.map(e => {
              const from = posById.get(e.fromId), to = posById.get(e.toId)
              if (!from || !to) return null
              return (
                <path key={`${e.fromId}-${e.toId}`} d={edgePath(from, to)} fill="none"
                  stroke={to.color} strokeWidth={branchWidth(to.depth)} strokeLinecap="round" />
              )
            })}
            {layout.nodes.map(ln => (
              ln.side === 'root' ? null : (
                <path key={`u-${ln.node.id}`} d={underlinePath(ln)} fill="none"
                  stroke={ln.color} strokeWidth={branchWidth(ln.depth)} strokeLinecap="round" />
              )
            ))}
          </svg>

          {layout.nodes.map(ln => {
            const isSel = ln.node.id === selId
            const isRoot = ln.node.id === root.id
            const isLeft = ln.side === 'left'
            const editing = editingId === ln.node.id
            const kids = ln.node.children.length
            const { lines } = nodeBox(ln.node)
            // Sem caixa, o texto é o elemento — cor escura legível, nunca sobre cor.
            const textColor = ln.node.textColor ?? (isRoot ? '#ffffff' : '#1f2937')
            return (
              <div key={ln.node.id} data-node className="absolute group" style={{ left: ln.x, top: ln.y, width: ln.w, height: ln.h }}>
                <div
                  onPointerDown={e => onNodeDown(e, ln)}
                  onPointerMove={onNodeMove}
                  onPointerUp={onNodeUp}
                  onPointerCancel={() => { dragRef.current = null; setDraggingId(null) }}
                  // 1º clique seleciona; clicar de novo entra na edição com o
                  // cursor onde se clicou (como em qualquer editor de texto).
                  onClick={e => {
                    e.stopPropagation()
                    if (justDragged.current) { justDragged.current = false; return }
                    if (isSel && !editing) { beginEditAt(ln.node.id, e.clientX, e.clientY); return }
                    setSelId(ln.node.id); focusCanvas()
                  }}
                  onDoubleClick={e => { e.stopPropagation(); beginEditAt(ln.node.id, e.clientX, e.clientY) }}
                  className={cn(
                    'w-full h-full flex items-center select-none touch-none transition-colors',
                    // Só a raiz mantém caixa (é o centro do mapa); os ramos são texto puro.
                    isRoot ? 'rounded-xl justify-center' : 'rounded-md',
                    draggingId === ln.node.id ? 'cursor-grabbing' : 'cursor-grab',
                  )}
                  style={{
                    paddingLeft: PAD_X,
                    paddingRight: PAD_X,
                    backgroundColor: isRoot ? ln.color : isSel ? `${ln.color}1f` : undefined,
                    // Seleção sem contorno pesado: leve véu na cor do ramo.
                    boxShadow: isSel && !isRoot ? `0 0 0 2px ${ln.color}59` : isRoot && isSel ? `0 0 0 3px ${ln.color}40` : undefined,
                  }}
                >
                  {editing ? (
                    <textarea
                      // Ao montar: cursor onde a pessoa clicou (ou no fim, se veio
                      // do F2/nó novo). Nunca seleciona tudo — digitar não apaga o texto.
                      ref={el => {
                        if (!el || el === caretAppliedRef.current) return
                        caretAppliedRef.current = el
                        const p = pendingCaret.current
                        pendingCaret.current = null
                        el.focus()
                        const at = Math.min(p ?? el.value.length, el.value.length)
                        el.setSelectionRange(at, at)
                      }}
                      value={ln.node.text}
                      onChange={e => setText(ln.node.id, e.target.value)}
                      // Só encerra se a edição ainda for DESTE nó: ao criar o próximo,
                      // o blur do antigo chegaria depois e mataria a edição do novo.
                      onBlur={() => setEditingId(cur => (cur === ln.node.id ? null : cur))}
                      onKeyDown={e => {
                        e.stopPropagation()
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addSiblingTo(ln.node.id) }
                        else if (e.key === 'Tab')             { e.preventDefault(); addChildTo(ln.node.id) }
                        else if (e.key === 'Escape')          { e.preventDefault(); stopEdit() }
                      }}
                      placeholder="Novo tópico"
                      rows={lines.length}
                      className="flex-1 min-w-0 bg-transparent text-[13px] leading-[19px] resize-none outline-none placeholder:text-gray-400"
                      style={{ color: textColor, fontWeight: ln.node.bold ? 700 : isRoot ? 600 : 500, fontStyle: ln.node.italic ? 'italic' : undefined, height: lines.length * LINE_H }}
                    />
                  ) : (
                    // `whitespace-pre` com as linhas do layout: a caixa e o texto
                    // quebram exatamente igual — nada é cortado com reticências.
                    <span className="flex-1 min-w-0 text-[13px] leading-[19px] whitespace-pre"
                      style={{ color: textColor, fontWeight: ln.node.bold ? 700 : isRoot ? 600 : 500, fontStyle: ln.node.italic ? 'italic' : undefined }}>
                      {ln.node.text ? lines.join('\n') : <span className="opacity-50">Novo tópico</span>}
                    </span>
                  )}

                </div>

                {/* + fora do nó (não há mais caixa p/ abrigá-lo): fica do lado em
                    que o ramo abre. Aparece no hover ou quando selecionado. */}
                {!editing && (
                  <button
                    data-nodrag
                    onClick={e => { e.stopPropagation(); setSelId(ln.node.id); addChildTo(ln.node.id) }}
                    title="Novo nó filho (Tab)"
                    aria-label="Novo nó filho"
                    className={cn(
                      'absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center transition-opacity shadow-sm',
                      isLeft ? '-left-7' : '-right-7',
                      isSel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    )}
                    style={{ backgroundColor: `${ln.color}26`, color: ln.color }}
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}

                {/* Contador = botão de ocultar/expandir daquele nó em diante.
                    Fica do lado em que o ramo abre e mostra quantos estão escondidos. */}
                {kids > 0 && (
                  <button
                    data-nodrag
                    onClick={e => { e.stopPropagation(); toggleCollapse(ln.node.id) }}
                    title={ln.node.collapsed ? `Expandir ${kids} nó(s) escondido(s)` : 'Ocultar daqui em diante'}
                    aria-label={ln.node.collapsed ? 'Expandir ramo' : 'Ocultar ramo'}
                    className={cn(
                      // Sobre a ponta do sublinhado — é dali que o ramo continua.
                      'absolute bottom-0 translate-y-1/2 w-5 h-5 rounded-full text-[10px] font-bold text-[#fff] flex items-center justify-center border-2 border-white shadow-sm hover:scale-125 transition-all',
                      isLeft ? '-left-2.5' : '-right-2.5',
                      ln.node.collapsed || isSel ? 'opacity-100' : 'opacity-60 group-hover:opacity-100',
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

/** Paleta ancorada no botão. O backdrop fecha no clique-fora sem roubar o foco. */
function ColorPop({ colors, current, onPick, onReset, onClose }: {
  colors: readonly string[]; current?: string
  onPick: (c: string) => void; onReset?: () => void; onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-10" onPointerDown={onClose} />
      <div className="absolute top-full left-0 mt-1 z-20 flex items-center gap-1 p-1.5 bg-white border border-gray-200 rounded-xl shadow-lg pop-in">
        {colors.map(c => (
          <button key={c} onClick={() => onPick(c)} aria-label={`Cor ${c}`}
            className={cn(
              'w-5 h-5 rounded-full border hover:scale-110 transition-transform active:scale-[0.97]',
              current === c ? 'border-gray-900 border-2' : 'border-black/10',
            )}
            style={{ backgroundColor: c }} />
        ))}
        {onReset && (
          <button onClick={onReset} title="Voltar ao padrão"
            className="ml-0.5 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 rounded-md hover:bg-gray-100 transition-colors">
            padrão
          </button>
        )}
      </div>
    </>
  )
}
