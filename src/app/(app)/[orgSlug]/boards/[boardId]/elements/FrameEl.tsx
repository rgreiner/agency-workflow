'use client'

import { useState, useEffect, useRef } from 'react'
import type { FrameElement } from '@/types/board'

interface Props {
  el: FrameElement
  editing: boolean
  selected: boolean
  onUpdate: (u: Partial<FrameElement>) => void
  onStopEdit: () => void
}

/** Caixa de organização (frame): título + região translúcida; os cards ficam por cima. */
export function FrameEl({ el, editing, selected, onUpdate, onStopEdit }: Props) {
  const [draft, setDraft] = useState(el.title)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) requestAnimationFrame(() => ref.current?.select()) }, [editing])

  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: 12,
      border: `2px solid ${el.color}`,
      backgroundColor: selected ? 'rgba(99,102,241,0.05)' : 'rgba(148,163,184,0.05)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        padding: '6px 12px', borderBottom: `1px solid ${el.color}40`,
        backgroundColor: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(2px)',
      }}>
        {editing ? (
          <input
            ref={ref}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { onUpdate({ title: draft }); onStopEdit() }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { onUpdate({ title: draft }); onStopEdit() } }}
            onPointerDown={e => e.stopPropagation()}
            placeholder="Nome do grupo"
            style={{ width: '100%', border: 'none', outline: 'none', fontSize: 13, fontWeight: 700, color: '#334155', backgroundColor: 'transparent', fontFamily: 'inherit' }}
          />
        ) : (
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {el.title || 'Grupo'}
          </p>
        )}
      </div>
    </div>
  )
}
