'use client'

import { useEffect, useRef } from 'react'
import type { ChecklistElement, ChecklistItem } from '@/types/board'
import { Check, Plus, X } from 'lucide-react'

interface Props {
  el: ChecklistElement
  editing: boolean
  selected: boolean
  onUpdate: (u: Partial<ChecklistElement>) => void
  onStopEdit: () => void
}

/** Card de checklist (to-do): título + itens com caixa de marcar. */
export function ChecklistEl({ el, editing, onUpdate, onStopEdit }: Props) {
  const titleRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const focusId  = useRef<string | null>(null)

  // Foca o título ao entrar em edição
  useEffect(() => { if (editing) requestAnimationFrame(() => titleRef.current?.focus()) }, [editing])

  // Foca um item recém-criado (após Enter)
  useEffect(() => {
    if (focusId.current) {
      const node = itemRefs.current.get(focusId.current)
      node?.focus()
      focusId.current = null
    }
  })

  const items = el.items
  const doneCount = items.filter(i => i.done).length

  function patchItem(id: string, patch: Partial<ChecklistItem>) {
    onUpdate({ items: items.map(it => (it.id === id ? { ...it, ...patch } : it)) })
  }

  function addItem(afterId?: string) {
    const nid = crypto.randomUUID()
    const next = [...items]
    const idx = afterId ? next.findIndex(i => i.id === afterId) : next.length - 1
    next.splice(idx + 1, 0, { id: nid, text: '', done: false })
    focusId.current = nid
    onUpdate({ items: next })
  }

  function removeItem(id: string) {
    const idx = items.findIndex(i => i.id === id)
    const prev = items[idx - 1]
    if (prev) focusId.current = prev.id
    onUpdate({ items: items.filter(i => i.id !== id) })
  }

  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: 10,
      boxShadow: '0 2px 8px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)',
      border: '1px solid #e2e8f0', backgroundColor: '#ffffff',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* ── Cabeçalho: título + contador ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderBottom: '1px solid #f1f5f9',
      }}>
        {editing ? (
          <input
            ref={titleRef}
            value={el.title}
            onChange={e => onUpdate({ title: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); if (items[0]) itemRefs.current.get(items[0].id)?.focus(); else addItem() }
              if (e.key === 'Escape') onStopEdit()
            }}
            onPointerDown={e => e.stopPropagation()}
            placeholder="Título"
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 13, fontWeight: 700, color: '#1f2937', backgroundColor: 'transparent', fontFamily: 'inherit' }}
          />
        ) : (
          <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 13, fontWeight: 700, color: '#1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {el.title || 'Checklist'}
          </p>
        )}
        {items.length > 0 && (
          <span style={{
            flexShrink: 0, fontSize: 11, fontWeight: 600,
            color: doneCount === items.length ? '#16a34a' : '#94a3b8',
            backgroundColor: doneCount === items.length ? '#dcfce7' : '#f1f5f9',
            borderRadius: 999, padding: '1px 7px',
          }}>
            {doneCount}/{items.length}
          </span>
        )}
      </div>

      {/* ── Itens ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {items.length === 0 && !editing && (
          <p style={{ margin: 0, padding: '6px 4px', fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
            Duplo clique para editar…
          </p>
        )}
        {items.map(it => (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px' }}>
            {/* Caixa de marcar — sempre clicável */}
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={() => patchItem(it.id, { done: !it.done })}
              title={it.done ? 'Desmarcar' : 'Marcar como feito'}
              style={{
                flexShrink: 0, width: 17, height: 17, borderRadius: 5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', padding: 0,
                border: it.done ? '1.5px solid #6366f1' : '1.5px solid #cbd5e1',
                backgroundColor: it.done ? '#6366f1' : '#ffffff',
                transition: 'background-color 0.12s, border-color 0.12s',
              }}
            >
              {it.done && <Check size={11} color="#fff" strokeWidth={3} />}
            </button>

            {/* Texto do item */}
            {editing ? (
              <input
                ref={node => { if (node) itemRefs.current.set(it.id, node); else itemRefs.current.delete(it.id) }}
                value={it.text}
                onChange={e => patchItem(it.id, { text: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Enter')     { e.preventDefault(); addItem(it.id) }
                  if (e.key === 'Escape')    onStopEdit()
                  if (e.key === 'Backspace' && it.text === '' && items.length > 1) { e.preventDefault(); removeItem(it.id) }
                }}
                onPointerDown={e => e.stopPropagation()}
                placeholder="Item…"
                style={{
                  flex: 1, minWidth: 0, border: 'none', outline: 'none',
                  fontSize: 12.5, color: '#334155', backgroundColor: 'transparent', fontFamily: 'inherit',
                  textDecoration: it.done ? 'line-through' : 'none',
                }}
              />
            ) : (
              <span style={{
                flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.5,
                color: it.done ? '#94a3b8' : it.text ? '#334155' : '#cbd5e1',
                textDecoration: it.done ? 'line-through' : 'none',
                wordBreak: 'break-word',
              }}>
                {it.text || '—'}
              </span>
            )}

            {/* Remover (só em edição) */}
            {editing && (
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={() => removeItem(it.id)}
                title="Remover item"
                style={{ flexShrink: 0, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'none', cursor: 'pointer', color: '#cbd5e1', padding: 0 }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ── Adicionar item (só em edição) ── */}
      {editing && (
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={() => addItem()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', border: 'none', borderTop: '1px solid #f1f5f9',
            background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            color: '#6366f1', fontFamily: 'inherit',
          }}
        >
          <Plus size={14} /> Adicionar item
        </button>
      )}
    </div>
  )
}
