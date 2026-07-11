'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

// Normaliza p/ busca: sem acento, minúsculo (ex.: "São" casa com "sao").
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
// Acima disso o painel ganha campo de busca por digitação.
const SEARCH_THRESHOLD = 7

/**
 * Posiciona um painel flutuante (position:fixed) ancorado no gatilho, com flip
 * vertical quando falta espaço embaixo. Usado pelo Select/MultiSelect p/ o menu
 * escapar de containers com overflow (ex.: tabelas com overflow-x-auto, que
 * cortavam o dropdown). Fecha no scroll/resize p/ não descolar do gatilho.
 */
export function useAnchoredPanel(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  panelRef: React.RefObject<HTMLElement | null>,
  align: 'left' | 'right',
  onClose: () => void,
) {
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null)
  // onClose é recriado a cada render; guardar em ref p/ não re-disparar o efeito
  // de posição (senão setPos com objeto novo + dep instável = loop de render).
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    if (!open) return
    const t = triggerRef.current, p = panelRef.current
    if (t && p) {
      const r = t.getBoundingClientRect()
      const ph = p.offsetHeight, pw = p.offsetWidth, gap = 6
      const openUp = r.bottom + gap + ph > window.innerHeight && r.top - gap - ph >= 0
      let left = align === 'right' ? r.right - pw : r.left
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8))
      setPos({ top: openUp ? r.top - gap - ph : r.bottom + gap, left, minWidth: r.width })
    }
    const close = () => closeRef.current()
    // scroll dentro do próprio painel (lista com overflow) NÃO fecha — só o scroll
    // de um container de fundo, que descolaria o painel do gatilho.
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return
      closeRef.current()
    }
    window.addEventListener('scroll', onScroll, true)  // capture: pega scroll de qualquer container
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
      setPos(null)  // limpa ao fechar (no cleanup, sem cascata de render)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align])

  return pos
}

interface Props {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  align?: 'left' | 'right'
  size?: 'sm' | 'md'
}

/**
 * Dropdown padrão do app (substitui o <select> nativo). Visual consistente com os
 * menus de "Colunas"/status: trigger branco com chevron, painel arredondado,
 * opção selecionada com check, navegação por teclado (↑↓, Enter, Esc).
 */
export function Select({
  value, onChange, options, placeholder = 'Selecionar', className, align = 'left', size = 'md',
}: Props) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value)
  const searchable = options.length > SEARCH_THRESHOLD
  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    return q ? options.filter(o => normalize(o.label).includes(q)) : options
  }, [options, query])
  const pos = useAnchoredPanel(open, triggerRef, listRef, align, () => setOpen(false))

  // Fecha ao clicar fora (checa gatilho E painel — o painel vive num portal)
  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) {
      const t = e.target as Node
      if (ref.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [open])

  // Ao abrir: limpa a busca, destaca o selecionado e foca o campo de busca.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIdx(Math.max(0, options.findIndex(o => o.value === value)))
    if (searchable) setTimeout(() => searchRef.current?.focus(), 0)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mantém o item ativo visível
  useEffect(() => {
    if (open) listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  function choose(v: string) {
    onChange(v)
    setOpen(false)
  }

  // Navegação por teclado (compartilhada entre gatilho e campo de busca).
  function navKeys(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown')      { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter')     { e.preventDefault(); const o = filtered[activeIdx]; if (o) choose(o.value) }
    else if (e.key === 'Escape')    { e.preventDefault(); setOpen(false) }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(true) }
      return
    }
    navKeys(e)
  }

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center justify-between gap-2 w-full rounded-xl border border-transparent bg-gray-100 text-gray-700 transition',
          size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2.5 text-sm',
          open ? 'bg-white ring-2 ring-orange-200' : 'hover:bg-gray-200/60'
        )}
      >
        <span className={cn('truncate', !selected && 'text-gray-400')}>{selected?.label ?? placeholder}</span>
        <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform duration-200 shrink-0', open && 'rotate-180')} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={listRef}
          role="listbox"
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, minWidth: pos?.minWidth, visibility: pos ? 'visible' : 'hidden' }}
          className="pop-in z-[100] max-h-72 overflow-y-auto bg-white rounded-2xl border border-gray-200 shadow-xl py-1.5"
        >
          {searchable && (
            <div className="sticky top-0 z-10 bg-white px-1.5 pt-0.5 pb-1.5 mb-1 border-b border-gray-100">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-100 rounded-lg">
                <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
                  onKeyDown={navKeys}
                  placeholder="Buscar…"
                  className="w-full bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none"
                />
              </div>
            </div>
          )}
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-400">Nenhum resultado</p>
          ) : filtered.map((o, i) => {
            const isSel = o.value === value
            const active = i === activeIdx
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isSel}
                data-active={active}
                onClick={() => choose(o.value)}
                onMouseMove={() => setActiveIdx(i)}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                  active ? 'bg-orange-50 text-orange-900' : 'text-gray-700'
                )}
              >
                <span className="truncate">{o.label}</span>
                {isSel && <Check className="w-3.5 h-3.5 text-orange-500 shrink-0" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}

interface MultiProps {
  values: string[]
  onChange: (values: string[]) => void
  options: SelectOption[]
  /** Texto do trigger quando nada está selecionado (= sem filtro). */
  allLabel: string
  className?: string
  align?: 'left' | 'right'
  size?: 'sm' | 'md'
}

/**
 * Versão multi-seleção do Select (mesmo visual). Cada opção alterna dentro/fora;
 * o painel fica aberto para marcar vários. Vazio = sem filtro (mostra allLabel).
 */
export function MultiSelect({
  values, onChange, options, allLabel, className, align = 'left', size = 'md',
}: MultiProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const pos = useAnchoredPanel(open, triggerRef, panelRef, align, () => setOpen(false))

  const searchable = options.length > SEARCH_THRESHOLD
  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    return q ? options.filter(o => normalize(o.label).includes(q)) : options
  }, [options, query])

  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) {
      const t = e.target as Node
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onOut)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onOut); document.removeEventListener('keydown', onEsc) }
  }, [open])

  function toggle(v: string) {
    onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v])
  }

  const label =
    values.length === 0 ? allLabel
    : values.length === 1 ? (options.find(o => o.value === values[0])?.label ?? '1 selecionado')
    : `${values.length} selecionados`

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { setQuery(''); setOpen(o => !o) }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center justify-between gap-2 w-full rounded-xl border border-transparent bg-gray-100 transition',
          values.length ? 'text-gray-800' : 'text-gray-700',
          size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2.5 text-sm',
          open ? 'bg-white ring-2 ring-orange-200' : 'hover:bg-gray-200/60'
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform duration-200 shrink-0', open && 'rotate-180')} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, minWidth: pos?.minWidth, visibility: pos ? 'visible' : 'hidden' }}
          className="pop-in z-[100] max-h-72 overflow-y-auto bg-white rounded-2xl border border-gray-200 shadow-xl py-1.5"
        >
          {searchable && (
            <div className="sticky top-0 z-10 bg-white px-1.5 pt-0.5 pb-1.5 mb-1 border-b border-gray-100">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-100 rounded-lg">
                <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <input
                  ref={searchRef}
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar…"
                  className="w-full bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none"
                />
              </div>
            </div>
          )}
          {values.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition border-b border-gray-100 mb-1"
            >
              Limpar seleção
            </button>
          )}
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-400">Nenhum resultado</p>
          ) : filtered.map(o => {
            const isSel = values.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isSel}
                onClick={() => toggle(o.value)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-gray-50 transition"
              >
                <span className={cn(
                  'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                  isSel ? 'bg-orange-600 border-orange-600' : 'border-gray-300'
                )}>
                  {isSel && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </span>
                <span className="truncate text-gray-700">{o.label}</span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
