'use client'

import { useState, useEffect, useRef } from 'react'
import type { NoteElement } from '@/types/board'

interface Props {
  el: NoteElement
  editing: boolean
  selected: boolean
  onUpdate: (updates: Partial<NoteElement>) => void
  onStopEdit: (content: string) => void
}

export function NoteEl({ el, editing, onStopEdit }: Props) {
  const [draft, setDraft] = useState(el.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Keep draft accessible in effects without stale closure
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])

  // Focus when editing starts
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

  // Save when editing ends — handles cases where blur doesn't fire
  // (React 18 concurrent mode can unmount the textarea before blur fires)
  const wasEditingRef = useRef(false)
  useEffect(() => {
    if (!editing && wasEditingRef.current) {
      onStopEdit(draftRef.current)
    }
    wasEditingRef.current = editing
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const fontWeight = el.bold ? 700 : 400
  const fontStyle  = el.italic ? 'italic' : 'normal'
  const textAlign  = (el.align ?? 'left') as 'left' | 'center' | 'right'

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: el.color,
        border: '1px solid rgba(15,23,42,0.06)',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'visible',
        position: 'relative',
      }}
    >
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
            fontWeight,
            fontStyle,
            textAlign,
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
            fontWeight,
            fontStyle: el.content ? fontStyle : 'italic',
            textAlign,
          }}
        >
          {el.content || 'Duplo clique para editar…'}
        </div>
      )}
    </div>
  )
}
