'use client'

import { useState, useRef, useEffect } from 'react'
import type { LinkElement } from '@/types/board'
import { Link2, ExternalLink } from 'lucide-react'
import { ensureHttp as href, domainOf } from '@/lib/url'

interface Props {
  el: LinkElement
  editing: boolean
  selected: boolean
  onUpdate: (u: Partial<LinkElement>) => void
  onStopEdit: () => void
}

export function LinkEl({ el, editing, onUpdate, onStopEdit }: Props) {
  const [urlDraft, setUrlDraft] = useState(el.url)
  const [titleDraft, setTitleDraft] = useState(el.title)
  const [editingTitle, setEditingTitle] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing && !el.url) requestAnimationFrame(() => inputRef.current?.focus()) }, [editing, el.url])

  function submitUrl() {
    const u = urlDraft.trim()
    if (u) onUpdate({ url: u, title: el.title || domainOf(u) })
    onStopEdit()
  }

  const dom = domainOf(el.url)
  const showForm = editing || !el.url

  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: 10,
      boxShadow: '0 2px 8px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)',
      border: '1px solid #e2e8f0', backgroundColor: '#ffffff',
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', overflow: 'hidden', position: 'relative',
    }}>
      {showForm ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
          <Link2 size={16} color="#94a3b8" style={{ flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="url"
            value={urlDraft}
            onChange={e => setUrlDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitUrl(); if (e.key === 'Escape') onStopEdit() }}
            onBlur={submitUrl}
            onPointerDown={e => e.stopPropagation()}
            placeholder="Cole um link (https://…)"
            style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 6, padding: '5px 8px', fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
          />
        </div>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://www.google.com/s2/favicons?domain=${dom}&sz=64`}
            alt=""
            width={28}
            height={28}
            style={{ width: 28, height: 28, borderRadius: 6, flexShrink: 0, backgroundColor: '#f1f5f9' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingTitle ? (
              <input
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={() => { onUpdate({ title: titleDraft }); setEditingTitle(false) }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { onUpdate({ title: titleDraft }); setEditingTitle(false) } }}
                onPointerDown={e => e.stopPropagation()}
                autoFocus
                style={{ width: '100%', border: 'none', outline: 'none', fontSize: 13, fontWeight: 600, color: '#1f2937', fontFamily: 'inherit' }}
              />
            ) : (
              <p
                onDoubleClick={e => { e.stopPropagation(); setTitleDraft(el.title); setEditingTitle(true) }}
                style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {el.title || dom}
              </p>
            )}
            <p style={{ margin: 0, fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dom}</p>
          </div>
          <a
            href={href(el.url)}
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
            title="Abrir link"
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, color: '#f97316' }}
          >
            <ExternalLink size={15} />
          </a>
        </>
      )}
    </div>
  )
}
