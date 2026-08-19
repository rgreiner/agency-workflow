'use client'

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAnchoredPanel } from './Select'
import { chaveNome, filtraSugestoes } from '@/lib/nomes'

/**
 * Campo de texto LIVRE com sugestão de nome já existente (fornecedor/cliente).
 *
 * Não é o `Combobox`: ali a lista é fechada e o valor é uma opção. Aqui a pessoa
 * pode digitar um nome que ainda não existe — é assim que fornecedor novo entra.
 * A sugestão só torna fácil reusar a grafia que já está em uso.
 *
 * O aviso de grafia é o motivo de existir: digitar "É O AMOR" quando já existe
 * "É o Amor" criava um segundo cliente na Análise. Quando o que foi digitado bate
 * com um nome existente ignorando caixa e acento, o painel diz isso na cara e
 * oferece a grafia cadastrada.
 */
export function InputSugestao({
  value, onChange, sugestoes, placeholder, className, disabled = false, minChars = 2, id,
}: {
  value: string
  onChange: (v: string) => void
  sugestoes: string[]
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Sugere a partir de N letras digitadas. */
  minChars?: number
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const pos = useAnchoredPanel(open, triggerRef, panelRef, 'left', () => setOpen(false))
  // O painel vai num portal (fora do input no DOM) — o `aria-controls` é o que liga
  // os dois para o leitor de tela.
  const painelId = `${id ?? 'sug'}-painel`

  const filtradas = useMemo(
    () => (value.trim().length >= minChars ? filtraSugestoes(sugestoes, value) : []),
    [sugestoes, value, minChars],
  )

  // Mesma grafia? então não há o que sugerir. Grafia DIFERENTE com a mesma chave é
  // exatamente o caso que parte o cliente em dois na Análise.
  const divergente = useMemo(() => {
    const t = value.trim()
    if (!t) return null
    const k = chaveNome(t)
    const igual = sugestoes.find(s => chaveNome(s) === k)
    return igual && igual !== t ? igual : null
  }, [sugestoes, value])

  const lista = useMemo(
    () => (divergente ? [divergente, ...filtradas.filter(s => s !== divergente)] : filtradas),
    [divergente, filtradas],
  )
  const mostrar = open && lista.length > 0

  function escolher(nome: string) {
    onChange(nome)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!mostrar) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, lista.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') {
      // Enter só captura quando há um item destacado — senão o form segue seu curso.
      const nome = lista[activeIdx]
      if (nome) { e.preventDefault(); escolher(nome) }
    }
  }

  return (
    <div className={cn('relative', className)} ref={ref}>
      <input
        id={id}
        ref={triggerRef}
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={mostrar}
        aria-controls={painelId}
        aria-autocomplete="list"
        onChange={e => { onChange(e.target.value); setActiveIdx(0); setOpen(true) }}
        onFocus={() => setOpen(true)}
        // Espera o onMouseDown da opção rodar antes de fechar.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        className={cn(
          'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400',
          'focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent',
          disabled && 'opacity-60',
        )}
      />

      {mostrar && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          id={painelId}
          role="listbox"
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, minWidth: pos?.minWidth, visibility: pos ? 'visible' : 'hidden' }}
          className="pop-in z-[100] max-h-72 overflow-y-auto bg-white rounded-2xl border border-gray-200 shadow-xl py-1.5"
        >
          {divergente && (
            <p className="px-3 pt-1 pb-2 text-[11px] text-gray-500 leading-snug border-b border-gray-100 mb-1">
              Já existe como <strong className="text-gray-800">{divergente}</strong>. Use a mesma grafia
              para não virar dois cadastros na Análise.
            </p>
          )}
          {lista.map((nome, i) => {
            const ativo = i === activeIdx
            return (
              <button
                key={nome}
                type="button"
                role="option"
                aria-selected={ativo}
                // onMouseDown (não onClick): dispara antes do onBlur fechar o painel.
                onMouseDown={e => { e.preventDefault(); escolher(nome) }}
                onMouseMove={() => setActiveIdx(i)}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                  ativo ? 'bg-orange-50 text-orange-900' : 'text-gray-700',
                )}
              >
                <span className="truncate">{nome}</span>
                {ativo && <CornerDownLeft className="w-3.5 h-3.5 text-orange-400 shrink-0" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
