'use client'

import { useState, useRef, useEffect } from 'react'
import type { ImageElement } from '@/types/board'
import { ImageIcon, Link2 } from 'lucide-react'

interface Props {
  el: ImageElement
  editing: boolean
  selected: boolean
  onUpdate: (updates: Partial<ImageElement>) => void
  onStopEdit: () => void
}

export function ImageEl({ el, editing, selected, onUpdate, onStopEdit }: Props) {
  const [urlDraft, setUrlDraft] = useState(el.url)
  const [captionDraft, setCaptionDraft] = useState(el.caption)
  const [editingCaption, setEditingCaption] = useState(false)
  const [imgError, setImgError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus URL input when editing starts (new image, no URL yet)
  useEffect(() => {
    if (editing && !el.url) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [editing, el.url])

  useEffect(() => { setImgError(false) }, [el.url])

  // Save URL when editing ends without explicit submit (blur didn't fire)
  const urlDraftRef = useRef(urlDraft)
  useEffect(() => { urlDraftRef.current = urlDraft }, [urlDraft])
  const wasEditingRef = useRef(false)
  useEffect(() => {
    if (!editing && wasEditingRef.current) {
      const url = urlDraftRef.current.trim()
      if (url && url !== el.url) onUpdate({ url })
    }
    wasEditingRef.current = editing
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  function submitUrl() {
    const url = urlDraft.trim()
    if (url) onUpdate({ url })
    onStopEdit()
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#ffffff',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        position: 'relative',
      }}
    >
      {/* ── Image area ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#f8fafc' }}>
        {el.url && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={el.url}
            alt={el.caption || 'imagem'}
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: '100%', height: '100%',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 8, padding: 16,
            }}
          >
            <div
              style={{
                width: 40, height: 40,
                backgroundColor: '#e2e8f0',
                borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <ImageIcon size={20} color="#94a3b8" />
            </div>
            {(editing || !el.url) ? (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>Cole uma URL de imagem</p>
                <div style={{ display: 'flex', width: '100%', maxWidth: 200, gap: 4 }}>
                  <input
                    ref={inputRef}
                    type="url"
                    value={urlDraft}
                    onChange={e => setUrlDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') submitUrl()
                      if (e.key === 'Escape') onStopEdit()
                    }}
                    onBlur={submitUrl}
                    onPointerDown={e => e.stopPropagation()}
                    placeholder="https://..."
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      fontSize: 11,
                      outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                  <button
                    onClick={submitUrl}
                    onPointerDown={e => e.stopPropagation()}
                    style={{
                      padding: '5px 8px',
                      borderRadius: 6,
                      backgroundColor: '#4f46e5',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <Link2 size={11} color="#fff" />
                  </button>
                </div>
                {imgError && (
                  <p style={{ fontSize: 10, color: '#ef4444', margin: 0 }}>URL inválida ou imagem inacessível</p>
                )}
              </div>
            ) : (
              <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>Duplo clique para inserir imagem</p>
            )}
          </div>
        )}

        {/* Replace image button when selected & URL exists */}
        {selected && el.url && !editing && !imgError && (
          <div
            style={{
              position: 'absolute', bottom: 6, right: 6,
              zIndex: 10,
            }}
          >
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={() => { setUrlDraft(''); onUpdate({ url: '' }) }}
              style={{
                padding: '3px 8px',
                backgroundColor: 'rgba(15,23,42,0.7)',
                color: '#fff',
                fontSize: 10,
                borderRadius: 5,
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Trocar imagem
            </button>
          </div>
        )}
      </div>

      {/* ── Caption ── */}
      {(el.caption || selected) && (
        <div
          style={{
            padding: '6px 10px',
            borderTop: '1px solid #f1f5f9',
            backgroundColor: '#ffffff',
            minHeight: 28,
          }}
        >
          {editingCaption ? (
            <input
              type="text"
              value={captionDraft}
              onChange={e => setCaptionDraft(e.target.value)}
              onBlur={() => { onUpdate({ caption: captionDraft }); setEditingCaption(false) }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === 'Escape') { onUpdate({ caption: captionDraft }); setEditingCaption(false) }
              }}
              onPointerDown={e => e.stopPropagation()}
              placeholder="Legenda…"
              autoFocus
              style={{
                width: '100%', border: 'none', outline: 'none',
                fontSize: 11, color: '#475569',
                backgroundColor: 'transparent', fontFamily: 'inherit',
              }}
            />
          ) : (
            <p
              style={{
                fontSize: 11, color: el.caption ? '#475569' : '#cbd5e1',
                margin: 0, fontStyle: el.caption ? 'normal' : 'italic',
                cursor: selected ? 'text' : 'default',
              }}
              onDoubleClick={e => { e.stopPropagation(); setEditingCaption(true) }}
            >
              {el.caption || (selected ? 'Legenda…' : '')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
