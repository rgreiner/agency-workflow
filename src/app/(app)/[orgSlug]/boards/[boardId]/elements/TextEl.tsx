'use client'

import { useState, useEffect, useRef } from 'react'
import type { TextElement } from '@/types/board'

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

export function TextEl({ el, editing, onStopEdit }: Props) {
  const [draft, setDraft] = useState(el.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sizeCfg = SIZE_OPTIONS.find(s => s.value === el.size)!

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
  const wasEditingRef = useRef(false)
  useEffect(() => {
    if (!editing && wasEditingRef.current) {
      onStopEdit(draftRef.current)
    }
    wasEditingRef.current = editing
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
