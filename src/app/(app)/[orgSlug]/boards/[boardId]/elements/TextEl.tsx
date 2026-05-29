'use client'

import { useState, useEffect, useRef } from 'react'
import type { TextElement } from '@/types/board'
import { Bold, Italic, AlignLeft, AlignCenter, AlignRight } from 'lucide-react'

interface Props {
  el: TextElement
  editing: boolean
  selected: boolean
  onUpdate: (updates: Partial<TextElement>) => void
  onStopEdit: (content: string) => void
}

const SIZE_OPTIONS = [
  { value: 'h1',   label: 'H1', style: { fontSize: 28, fontWeight: 700, lineHeight: 1.2 } },
  { value: 'h2',   label: 'H2', style: { fontSize: 20, fontWeight: 600, lineHeight: 1.3 } },
  { value: 'body', label: 'Aa', style: { fontSize: 14, fontWeight: 400, lineHeight: 1.6 } },
] as const

export function TextEl({ el, editing, selected, onUpdate, onStopEdit }: Props) {
  const [draft, setDraft] = useState(el.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sizeCfg = SIZE_OPTIONS.find(s => s.value === el.size)!

  useEffect(() => {
    if (editing) {
      setDraft(el.content)
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        const len = textareaRef.current?.value.length ?? 0
        textareaRef.current?.setSelectionRange(len, len)
      })
    }
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-grow height while editing
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [draft, editing])

  const textStyle = {
    fontSize:   sizeCfg.style.fontSize,
    fontWeight: el.bold ? 700 : sizeCfg.style.fontWeight,
    lineHeight: sizeCfg.style.lineHeight,
    fontStyle:  el.italic ? 'italic' : 'normal',
    textAlign:  el.align as 'left' | 'center' | 'right',
    color:      el.content ? '#0f172a' : '#94a3b8',
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'visible' }}>

      {/* ── Floating toolbar (above element) ── */}
      {selected && !editing && (
        <div
          style={{
            position: 'absolute',
            top: -40,
            left: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: '4px 6px',
            backgroundColor: '#1f2937',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 200,
            whiteSpace: 'nowrap',
          }}
          onPointerDown={e => e.stopPropagation()}
        >
          {/* Size */}
          {SIZE_OPTIONS.map(s => (
            <button
              key={s.value}
              onClick={() => onUpdate({ size: s.value })}
              title={s.label}
              style={{
                minWidth: 28,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 5,
                backgroundColor: el.size === s.value ? '#4f46e5' : 'transparent',
                color: el.size === s.value ? '#fff' : '#9ca3af',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                border: 'none',
                padding: '0 6px',
              }}
            >
              {s.label}
            </button>
          ))}

          <div style={{ width: 1, height: 16, backgroundColor: '#374151', margin: '0 2px' }} />

          {/* Bold */}
          <button
            onClick={() => onUpdate({ bold: !el.bold })}
            title="Negrito"
            style={{
              width: 26, height: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 5,
              backgroundColor: el.bold ? '#4f46e5' : 'transparent',
              color: el.bold ? '#fff' : '#9ca3af',
              cursor: 'pointer', border: 'none',
            }}
          >
            <Bold size={12} />
          </button>

          {/* Italic */}
          <button
            onClick={() => onUpdate({ italic: !el.italic })}
            title="Itálico"
            style={{
              width: 26, height: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 5,
              backgroundColor: el.italic ? '#4f46e5' : 'transparent',
              color: el.italic ? '#fff' : '#9ca3af',
              cursor: 'pointer', border: 'none',
            }}
          >
            <Italic size={12} />
          </button>

          <div style={{ width: 1, height: 16, backgroundColor: '#374151', margin: '0 2px' }} />

          {/* Alignment */}
          {(['left', 'center', 'right'] as const).map(align => {
            const Icon = align === 'left' ? AlignLeft : align === 'center' ? AlignCenter : AlignRight
            return (
              <button
                key={align}
                onClick={() => onUpdate({ align })}
                title={align}
                style={{
                  width: 26, height: 24,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 5,
                  backgroundColor: el.align === align ? '#4f46e5' : 'transparent',
                  color: el.align === align ? '#fff' : '#9ca3af',
                  cursor: 'pointer', border: 'none',
                }}
              >
                <Icon size={12} />
              </button>
            )
          })}
        </div>
      )}

      {/* ── Content ── */}
      {editing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => onStopEdit(draft)}
          onPointerDown={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); onStopEdit(draft) }
            if (e.key === 'Enter' && el.size !== 'body') { e.preventDefault(); onStopEdit(draft) }
          }}
          placeholder="Digite um texto…"
          style={{
            width: '100%',
            minHeight: 40,
            backgroundColor: 'transparent',
            border: 'none',
            resize: 'none',
            padding: 0,
            outline: 'none',
            fontFamily: 'inherit',
            color: '#0f172a',
            fontStyle:  el.italic ? 'italic' : 'normal',
            textAlign:  el.align as 'left' | 'center' | 'right',
            fontSize:   textStyle.fontSize,
            fontWeight: textStyle.fontWeight,
            lineHeight: textStyle.lineHeight,
            overflow: 'hidden',
          }}
        />
      ) : (
        <div
          style={{
            ...textStyle,
            minHeight: 40,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            fontStyle:  el.italic ? 'italic' : 'normal',
            color: el.content ? '#0f172a' : '#94a3b8',
          }}
        >
          {el.content || 'Duplo clique para editar…'}
        </div>
      )}
    </div>
  )
}
