'use client'

import type { TextElement } from '@/types/board'
import { effectiveFontSize } from '@/types/board'
import { RichTextArea } from '../RichTextArea'

interface Props {
  el: TextElement
  editing: boolean
  selected: boolean
  onUpdate: (updates: Partial<TextElement>) => void
  onStopEdit: (content: string) => void
}

const SIZE_LINE: Record<TextElement['size'], number> = { h1: 1.15, h2: 1.25, body: 1.4 }
const SIZE_WEIGHT: Record<TextElement['size'], number> = { h1: 700, h2: 600, body: 400 }

export function TextEl({ el, editing, onStopEdit }: Props) {
  const base: React.CSSProperties = {
    fontSize:   effectiveFontSize(el),
    fontWeight: el.bold ? 700 : SIZE_WEIGHT[el.size],
    lineHeight: SIZE_LINE[el.size],
    fontStyle:  el.italic ? 'italic' : 'normal',
    textAlign:  (el.align ?? 'left') as 'left' | 'center' | 'right',
    color:      el.textColor ?? '#0f172a',
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <RichTextArea
        html={el.content}
        editing={editing}
        placeholder="Digite um texto…"
        onStopEdit={onStopEdit}
        style={{
          width: '100%',
          minHeight: 40,
          outline: 'none',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
          cursor: editing ? 'text' : 'inherit',
          ...base,
        }}
      />
    </div>
  )
}
