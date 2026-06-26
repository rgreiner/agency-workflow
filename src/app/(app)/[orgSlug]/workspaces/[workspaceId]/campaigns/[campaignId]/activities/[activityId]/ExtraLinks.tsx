'use client'

import { useState, useTransition } from 'react'
import { ExternalLink, Plus, Trash2, Pencil, Check, Loader2, Link2 } from 'lucide-react'
import { setActivityExtraLinks } from '@/app/actions/activity'
import { ensureHttp as href } from '@/lib/url'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface LinkItem { label: string; url: string }

export function ExtraLinks({ path, activityId, links, canEdit }: {
  path: string
  activityId: string
  links: LinkItem[]
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<LinkItem[]>(links)
  const [isPending, startTransition] = useTransition()

  function start() { setDraft(links.length ? links : [{ label: '', url: '' }]); setEditing(true) }
  const setRow = (i: number, k: keyof LinkItem, v: string) => setDraft(d => d.map((r, idx) => idx === i ? { ...r, [k]: v } : r))
  const addRow = () => setDraft(d => [...d, { label: '', url: '' }])
  const delRow = (i: number) => setDraft(d => d.filter((_, idx) => idx !== i))

  function save() {
    const clean = draft.map(r => ({ label: r.label.trim(), url: r.url.trim() })).filter(r => r.url)
    startTransition(async () => {
      const r = await setActivityExtraLinks(path, activityId, clean)
      if (r?.error) toast.error(r.error)
      else { toast.success('Links salvos.'); setEditing(false) }
    })
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Links</p>
        {canEdit && !editing && (
          <button onClick={start} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
            <Pencil className="w-3.5 h-3.5" /> {links.length ? 'Editar' : 'Adicionar'}
          </button>
        )}
      </div>

      {editing ? (
        <div className="border border-gray-200 rounded-xl p-3 space-y-2">
          {draft.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={r.label} onChange={e => setRow(i, 'label', e.target.value)} placeholder="Rótulo (ex.: Planejamento, Boletos)"
                className="w-40 shrink-0 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <input value={r.url} onChange={e => setRow(i, 'url', e.target.value)} placeholder="https://…"
                className="flex-1 min-w-0 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button aria-label="Remover" onClick={() => delRow(i)} className="text-gray-300 hover:text-red-500 transition-colors shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <button onClick={addRow} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Adicionar link
            </button>
            <div className="flex items-center gap-2">
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancelar</button>
              <button onClick={save} disabled={isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-[#fff] hover:bg-indigo-700 disabled:opacity-50 transition">
                {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Salvar
              </button>
            </div>
          </div>
        </div>
      ) : links.length ? (
        <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
          {links.map((l, i) => (
            <a key={i} href={href(l.url)} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-50/60 transition-colors group">
              <Link2 className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-sm text-gray-700 shrink-0 max-w-[40%] truncate">{l.label || 'Link'}</span>
              <span className="flex-1 min-w-0 truncate text-xs text-indigo-600 group-hover:underline">{l.url.replace(/^https?:\/\//, '')}</span>
              <ExternalLink className="w-3.5 h-3.5 text-gray-300 shrink-0" />
            </a>
          ))}
        </div>
      ) : (
        <p className={cn('text-sm text-gray-400', canEdit && 'hidden')}>Nenhum link.</p>
      )}
    </div>
  )
}
