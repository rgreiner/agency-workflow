'use client'

import { useState, useEffect, useRef } from 'react'
import type { NoteElement } from '@/types/board'
import { NOTE_COLORS } from '@/types/board'

interface Props {
  el: NoteElement
  editing: boolean
  selected: boolean
  onUpdate: (updates: Partial<NoteElement>) => void
  onStopEdit: (content: string) => void
}

export function NoteEl({ el, editing, selected, onUpdate, onStopEdit }: Props) {
  const [draft, setDraft] = useState(el.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: el.color,
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'visible',
        position: 'relative',
      }}
    >
      {/* ── Color picker (floats above) ── */}
      {selected && !editing && (
        <div
          style={{
            position: 'absolute',
            top: -40,
            left: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 8px',
            backgroundColor: '#1f2937',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 200,
            whiteSpace: 'nowrap',
          }}
          onPointerDown={e => e.stopPropagation()}
        >
          {NOTE_COLORS.map(({ bg, label }) => (
            <button
              key={bg}
              title={label}
              onClick={() => onUpdate({ color: bg })}
              style={{
                width: 16,
                height: 16,
                backgroundColor: bg,
                border: el.color === bg ? '2.5px solid #818cf8' : '1.5px solid rgba(255,255,255,0.25)',
                borderRadius: 4,
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'transform 0.1s',
              }}
            />
          ))}
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
          }}
          placeholder="Escreva uma nota…"
          style={{
            flex: 1,
            backgroundColor: 'transparent',
            border: 'none',
            resize: 'none',
            padding: '12px 14px',
            fontSize: 13,
            lineHeight: 1.6,
            color: '#1e293b',
            outline: 'none',
            fontFamily: 'inherit',
            borderRadius: 10,
          }}
        />
      ) : (
        <div
          style={{
            flex: 1,
            padding: '12px 14px',
            fontSize: 13,
            lineHeight: 1.6,
            color: el.content ? '#1e293b' : '#94a3b8',
            overflow: 'hidden',
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            fontStyle: el.content ? 'normal' : 'italic',
          }}
        >
          {el.content || 'Duplo clique para editar…'}
        </div>
      )}
    </div>
  )
}
