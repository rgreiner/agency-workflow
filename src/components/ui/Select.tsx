'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
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
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.value === value)

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [open])

  // Ao abrir, posiciona o destaque no item selecionado
  useEffect(() => {
    if (open) setActiveIdx(Math.max(0, options.findIndex(o => o.value === value)))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mantém o item ativo visível
  useEffect(() => {
    if (open) listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  function choose(v: string) {
    onChange(v)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(true) }
      return
    }
    if (e.key === 'ArrowDown')      { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, options.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter')     { e.preventDefault(); const o = options[activeIdx]; if (o) choose(o.value) }
    else if (e.key === 'Escape')    { e.preventDefault(); setOpen(false) }
  }

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center justify-between gap-2 w-full rounded-lg border bg-white text-gray-700 transition',
          size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm',
          open ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-gray-300'
        )}
      >
        <span className={cn('truncate', !selected && 'text-gray-400')}>{selected?.label ?? placeholder}</span>
        <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform duration-200 shrink-0', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          className={cn(
            'absolute z-30 mt-1.5 min-w-full max-h-72 overflow-y-auto bg-white rounded-xl border border-gray-200 shadow-lg py-1.5',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {options.map((o, i) => {
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
                  active ? 'bg-indigo-50 text-indigo-900' : 'text-gray-700'
                )}
              >
                <span className="truncate">{o.label}</span>
                {isSel && <Check className="w-3.5 h-3.5 text-indigo-500 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
