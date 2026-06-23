'use client'

import { useState } from 'react'
import type { ColorElement } from '@/types/board'

/** Luminância → texto claro/escuro pra contraste sobre a cor. */
function contrastText(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length < 6) return '#ffffff'
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1f2937' : '#ffffff'
}

interface Props {
  el: ColorElement
  selected: boolean
  onUpdate: (u: Partial<ColorElement>) => void
}

export function ColorEl({ el, selected, onUpdate }: Props) {
  const [name, setName] = useState(el.name)
  const txt = contrastText(el.color)

  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: 10, overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)',
      border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff',
    }}>
      <div style={{ flex: 1, backgroundColor: el.color, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: txt, fontSize: 13, fontWeight: 600, fontFamily: 'ui-monospace, monospace', letterSpacing: 0.3 }}>
          {el.color.toUpperCase()}
        </span>
        {selected && (
          <input
            type="color"
            value={el.color}
            onChange={e => onUpdate({ color: e.target.value })}
            onPointerDown={e => e.stopPropagation()}
            title="Trocar cor"
            style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
          />
        )}
      </div>
      <div style={{ padding: '6px 10px', borderTop: '1px solid #f1f5f9' }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => onUpdate({ name })}
          onKeyDown={e => { if (e.key === 'Enter') { onUpdate({ name }); (e.target as HTMLInputElement).blur() } }}
          onPointerDown={e => e.stopPropagation()}
          placeholder="Nome da cor"
          style={{ width: '100%', border: 'none', outline: 'none', fontSize: 11, color: '#475569', backgroundColor: 'transparent', fontFamily: 'inherit' }}
        />
      </div>
    </div>
  )
}
