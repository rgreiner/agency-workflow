'use client'

import { useState, useEffect, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { FileText, Plus, Building2, PanelLeftClose, PanelLeft, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createDocument } from '@/app/actions/docs'

interface Doc {
  id: string
  title: string
  visibility: string
  workspace_id: string | null
  workspaces?: { name: string } | null
}

const STORAGE_KEY = 'docs-sidebar-collapsed'

export function DocsSidebar({ orgSlug, orgId, currentDocId, docs }: {
  orgSlug: string
  orgId: string
  currentDocId: string
  docs: Doc[]
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [pending, start] = useTransition()

  useEffect(() => {
    try { if (localStorage.getItem(STORAGE_KEY) === '1') setCollapsed(true) } catch {}
  }, [])

  function toggle() {
    setCollapsed(c => {
      const n = !c
      try { localStorage.setItem(STORAGE_KEY, n ? '1' : '0') } catch {}
      return n
    })
  }

  function novo() {
    start(async () => { await createDocument(orgId, orgSlug, null) })
  }

  if (collapsed) {
    return (
      <div className="hidden md:flex shrink-0 border-r border-gray-100 bg-gray-50/40 flex-col items-center pt-3">
        <button onClick={toggle} title="Mostrar documentos"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
          <PanelLeft className="w-4 h-4" />
        </button>
      </div>
    )
  }

  const orgDocs = docs.filter(d => !d.workspace_id)
  const wsGroups = docs.filter(d => d.workspace_id).reduce<Record<string, { name: string; docs: Doc[] }>>((acc, d) => {
    const id = d.workspace_id!
    const name = d.workspaces?.name ?? 'Cliente'
    if (!acc[id]) acc[id] = { name, docs: [] }
    acc[id].docs.push(d)
    return acc
  }, {})

  return (
    <aside className="hidden md:flex w-64 shrink-0 border-r border-gray-100 bg-gray-50/40 flex-col h-full">
      <div className="flex items-center justify-between px-3 py-3 border-b border-gray-100 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Documentos</span>
        <div className="flex items-center gap-0.5">
          <button onClick={novo} disabled={pending} title="Novo documento"
            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-gray-100 transition disabled:opacity-50">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </button>
          <button onClick={toggle} title="Ocultar lista"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {docs.length === 0 && (
          <p className="px-3 py-4 text-xs text-gray-400">Nenhum documento ainda.</p>
        )}

        {orgDocs.length > 0 && (
          <Section icon={<Building2 className="w-3 h-3" />} label="Organização">
            {orgDocs.map(d => <DocItem key={d.id} doc={d} orgSlug={orgSlug} active={d.id === currentDocId} />)}
          </Section>
        )}

        {Object.entries(wsGroups).map(([id, g]) => (
          <Section key={id} dot label={g.name}>
            {g.docs.map(d => <DocItem key={d.id} doc={d} orgSlug={orgSlug} active={d.id === currentDocId} />)}
          </Section>
        ))}
      </div>
    </aside>
  )
}

function Section({ label, icon, dot, children }: { label: string; icon?: ReactNode; dot?: boolean; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {dot ? <span className="w-2 h-2 rounded-sm bg-indigo-400 shrink-0" /> : icon}
        <span className="truncate">{label}</span>
      </div>
      {children}
    </div>
  )
}

function DocItem({ doc, orgSlug, active }: { doc: Doc; orgSlug: string; active: boolean }) {
  return (
    <Link
      href={`/${orgSlug}/docs/${doc.id}`}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 mx-1 rounded-lg text-sm transition',
        active ? 'bg-indigo-100 text-indigo-800 font-medium' : 'text-gray-600 hover:bg-gray-100'
      )}
    >
      <FileText className={cn('w-3.5 h-3.5 shrink-0', active ? 'text-indigo-500' : 'text-gray-400')} />
      <span className="truncate">{doc.title || 'Sem título'}</span>
    </Link>
  )
}
