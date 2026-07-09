'use client'

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAnchoredPanel, type SelectOption } from './Select'

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

interface Props {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  size?: 'sm' | 'md'
  align?: 'left' | 'right'
  className?: string
  /** Só mostra sugestões depois de N letras digitadas (default 3). */
  minChars?: number
}

/**
 * Select COM BUSCA (typeahead): digite p/ filtrar as opções carregadas. Mesmo
 * visual do Select; o painel vai num portal (escapa de overflow) e ancora no
 * gatilho. Feito p/ listas grandes (ex.: fornecedores) onde escolher por scroll
 * é ruim. Filtragem é client-side (ignora acento/caixa).
 */
export function Combobox({
  value, onChange, options, placeholder = 'Buscar…', size = 'md', align = 'left', className, minChars = 3,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const pos = useAnchoredPanel(open, triggerRef, panelRef, align, () => close())

  const selected = options.find(o => o.value === value)

  const filtered = useMemo(() => {
    const q = norm(query)
    if (q.length < minChars) return []
    return options.filter(o => norm(o.label).includes(q)).slice(0, 12)
  }, [query, options, minChars])

  function close() { setOpen(false); setQuery('') }
  function choose(v: string) { onChange(v); close() }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { close(); return }
    if (!filtered.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[activeIdx]; if (o) choose(o.value) }
  }

  const q = norm(query)
  const showHint = open && q.length < minChars

  return (
    <div className={cn('relative', className)} ref={ref}>
      <div
        className={cn(
          'inline-flex items-center gap-1 w-full rounded-xl border border-transparent bg-gray-100 transition',
          size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2.5 text-sm',
          open ? 'bg-white ring-2 ring-orange-200' : 'hover:bg-gray-200/60',
        )}
      >
        <input
          ref={triggerRef}
          value={open ? query : (selected?.label ?? '')}
          placeholder={selected ? selected.label : placeholder}
          onChange={e => { setQuery(e.target.value); setActiveIdx(0); if (!open) setOpen(true) }}
          onFocus={() => { setOpen(true); setQuery('') }}
          onBlur={() => setTimeout(close, 120)}  // deixa o onClick da opção rodar antes de fechar
          onKeyDown={onKeyDown}
          className={cn('flex-1 min-w-0 bg-transparent outline-none placeholder-gray-400', selected && !open ? 'text-gray-700' : 'text-gray-900')}
        />
        <ChevronDown className={cn('w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200', open && 'rotate-180')} />
      </div>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, minWidth: pos?.minWidth, visibility: pos ? 'visible' : 'hidden' }}
          className="pop-in z-[100] max-h-72 overflow-y-auto bg-white rounded-2xl border border-gray-200 shadow-xl py-1.5"
        >
          {showHint ? (
            <p className="px-3 py-2 text-xs text-gray-400">Digite {minChars} letras para buscar…</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">Nenhum resultado.</p>
          ) : (
            filtered.map((o, i) => {
              const isSel = o.value === value
              const active = i === activeIdx
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  // onMouseDown (não onClick): dispara antes do onBlur do input fechar o painel
                  onMouseDown={e => { e.preventDefault(); choose(o.value) }}
                  onMouseMove={() => setActiveIdx(i)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                    active ? 'bg-orange-50 text-orange-900' : 'text-gray-700',
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {isSel && <Check className="w-3.5 h-3.5 text-orange-500 shrink-0" />}
                </button>
              )
            })
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
