'use client'

/**
 * Entrada de tags livres com sugestão do que a org já usa.
 *
 * Lista livre só funciona se o vocabulário convergir sozinho — sem a sugestão, em uma
 * semana existiriam "brinde", "brindes" e "Brindes" como três coisas diferentes. Por
 * isso a sugestão aparece já na primeira letra, e o dedupe é por texto normalizado
 * (sem acento, sem caixa): digitar "Grafica" quando já existe "Gráfica" reaproveita a
 * que existe em vez de criar uma irmã.
 */
import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

export function TagInput({
  value, onChange, sugestoes = [], placeholder = 'Digite e tecle Enter…', className,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  /** Tags já usadas na org, para o autocomplete. */
  sugestoes?: string[]
  placeholder?: string
  className?: string
}) {
  const [texto, setTexto] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const disponiveis = useMemo(() => {
    const jaTem = new Set(value.map(norm))
    const q = norm(texto)
    return sugestoes
      .filter(s => !jaTem.has(norm(s)))
      .filter(s => (q ? norm(s).includes(q) : true))
      .slice(0, 8)
  }, [sugestoes, value, texto])

  function add(bruta: string) {
    const t = bruta.trim()
    if (!t) return
    // Reaproveita a grafia que já existe na org, se for a mesma coisa.
    const existente = sugestoes.find(s => norm(s) === norm(t))
    const final = existente ?? t
    if (value.some(v => norm(v) === norm(final))) { setTexto(''); return }
    onChange([...value, final])
    setTexto('')
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-2 bg-gray-100 border border-transparent rounded-xl focus-within:ring-2 focus-within:ring-orange-500">
        {value.map(t => (
          <span key={t} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg bg-white border border-gray-200 text-xs font-medium text-gray-700">
            {t}
            <button type="button" onClick={() => onChange(value.filter(v => v !== t))}
              className="p-0.5 rounded text-gray-400 hover:text-red-600 transition-colors" aria-label={`Remover ${t}`}>
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => {
            // Vírgula também fecha a tag: é como as pessoas escrevem lista.
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(texto) }
            // Backspace no campo vazio apaga a última — padrão de campo de tag.
            else if (e.key === 'Backspace' && !texto && value.length) onChange(value.slice(0, -1))
          }}
          onBlur={() => add(texto)}
          placeholder={value.length ? '' : placeholder}
          className="flex-1 min-w-[8rem] bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none px-1"
        />
      </div>

      {disponiveis.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {disponiveis.map(s => (
            <button key={s} type="button" onClick={() => { add(s); inputRef.current?.focus() }}
              className={cn('px-2 py-0.5 rounded-lg text-xs font-medium border transition-colors active:scale-[0.97]',
                'bg-white text-gray-600 border-gray-200 hover:border-orange-300 hover:text-orange-700')}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
