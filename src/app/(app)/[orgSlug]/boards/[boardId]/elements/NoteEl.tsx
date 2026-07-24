'use client'

import type { NoteElement } from '@/types/board'
import { effectiveFontSize } from '@/types/board'
import { RichTextArea } from '../RichTextArea'

interface Props {
  el: NoteElement
  editing: boolean
  selected: boolean
  onUpdate: (updates: Partial<NoteElement>) => void
  onStopEdit: (content: string) => void
}

export function NoteEl({ el, editing, onStopEdit }: Props) {
  const base: React.CSSProperties = {
    fontSize:   effectiveFontSize(el),
    lineHeight: 1.4,
    color:      el.textColor ?? '#1e293b',
    fontWeight: el.bold ? 700 : 400,
    fontStyle:  el.italic ? 'italic' : 'normal',
    textAlign:  (el.align ?? 'left') as 'left' | 'center' | 'right',
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: el.color,
        border: '1px solid rgba(15,23,42,0.06)',
        borderRadius: 12,
        boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 6px 16px rgba(15,23,42,0.08)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <RichTextArea
        html={el.content}
        editing={editing}
        placeholder="Escreva uma nota…"
        onStopEdit={onStopEdit}
        style={{
          flex: 1,
          padding: '11px 13px',
          outline: 'none',
          overflow: editing ? 'auto' : 'hidden',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
          cursor: editing ? 'text' : 'inherit',
          ...base,
        }}
      />
    </div>
  )
}
