'use client'

import { useState, useEffect, useRef, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FileText, Plus, Building2, PanelLeftClose, PanelLeft, Loader2,
  Folder, FolderOpen, ChevronRight, MoreHorizontal, Pencil, Trash2,
  FolderPlus, FilePlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { createDocument, createFolder, renameDocument, moveDocument, removeDocument } from '@/app/actions/docs'

interface Doc {
  id: string
  title: string
  visibility: string
  workspace_id: string | null
  parent_id: string | null
  is_folder: boolean
  workspaces?: { name: string } | null
}

interface Group {
  key: string
  name: string
  workspaceId: string | null
  folders: Doc[]
  looseDocs: Doc[]
  docsByFolder: Record<string, Doc[]>
}

const COLLAPSE_KEY = 'docs-sidebar-collapsed'
const CLOSED_KEY = 'docs-folders-closed'

export function DocsSidebar({ orgSlug, orgId, currentDocId, docs }: {
  orgSlug: string
  orgId: string
  currentDocId: string
  docs: Doc[]
}) {
  const router = useRouter()
  const [, start] = useTransition()
  const [collapsed, setCollapsed] = useState(false)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true)
      const c = localStorage.getItem(CLOSED_KEY)
      if (c) setClosed(new Set(JSON.parse(c)))
    } catch {}
  }, [])

  useEffect(() => {
    if (!menu) return
    function onOut(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null) }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [menu])

  function toggleSidebar() {
    setCollapsed(c => { const n = !c; try { localStorage.setItem(COLLAPSE_KEY, n ? '1' : '0') } catch {}; return n })
  }
  function toggleFolder(id: string) {
    setClosed(prev => {
      const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id)
      try { localStorage.setItem(CLOSED_KEY, JSON.stringify([...n])) } catch {}
      return n
    })
  }

  // ── Ações ──
  function newDoc(workspaceId: string | null, parentId: string | null) {
    setMenu(null)
    start(async () => { const r = await createDocument(orgId, orgSlug, workspaceId, parentId); if (r?.error) toast.error(r.error) })
  }
  async function newFolder(workspaceId: string | null) {
    setMenu(null)
    const r = await createFolder(orgId, orgSlug, workspaceId, 'Nova pasta')
    if (r?.error) { toast.error(r.error); return }
    router.refresh()
    if (r.id) { setRenamingId(r.id); setRenameValue('Nova pasta') }
  }
  function commitRename(id: string) {
    const value = renameValue.trim()
    setRenamingId(null)
    if (!value) return
    start(async () => { const r = await renameDocument(id, orgSlug, value); if (r?.error) toast.error(r.error); else router.refresh() })
  }
  function move(doc: Doc, folder: Doc | null) {
    setMenu(null)
    start(async () => {
      const r = await moveDocument(doc.id, orgSlug, folder ? folder.id : null, folder ? folder.workspace_id : doc.workspace_id)
      if (r?.error) toast.error(r.error); else router.refresh()
    })
  }
  function del(doc: Doc) {
    setMenu(null)
    start(async () => { const r = await removeDocument(doc.id, orgSlug); if (r?.error) toast.error(r.error); else router.refresh() })
  }

  if (collapsed) {
    return (
      <div className="hidden md:flex shrink-0 border-r border-gray-100 bg-gray-50/40 flex-col items-center pt-3">
        <button onClick={toggleSidebar} title="Mostrar documentos"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
          <PanelLeft className="w-4 h-4" />
        </button>
      </div>
    )
  }

  // ── Monta os grupos (Organização + clientes), igual à estrutura da listagem ──
  const map = new Map<string, Group>()
  function group(d: Doc): Group {
    const key = d.workspace_id ?? '__org__'
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: d.workspace_id ? (d.workspaces?.name ?? 'Cliente') : 'Organização',
        workspaceId: d.workspace_id,
        folders: [], looseDocs: [], docsByFolder: {},
      })
    }
    return map.get(key)!
  }
  // Garante o grupo "Organização" sempre presente
  if (!map.has('__org__')) map.set('__org__', { key: '__org__', name: 'Organização', workspaceId: null, folders: [], looseDocs: [], docsByFolder: {} })
  for (const d of docs) {
    const g = group(d)
    if (d.is_folder) g.folders.push(d)
    else if (d.parent_id) (g.docsByFolder[d.parent_id] ??= []).push(d)
    else g.looseDocs.push(d)
  }
  const groups = [...map.values()].sort((a, b) =>
    a.key === '__org__' ? -1 : b.key === '__org__' ? 1 : a.name.localeCompare(b.name))

  return (
    <aside ref={ref} className="hidden md:flex w-64 shrink-0 border-r border-gray-100 bg-gray-50/40 flex-col h-full">
      <div className="flex items-center justify-between px-3 py-3 border-b border-gray-100 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Documentos</span>
        <button onClick={toggleSidebar} title="Ocultar lista"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {groups.map(g => {
          const empty = g.folders.length === 0 && g.looseDocs.length === 0
          return (
            <div key={g.key} className="mb-3">
              {/* Cabeçalho do grupo + criar */}
              <div className="group/h flex items-center gap-1.5 px-3 mb-1">
                {g.workspaceId
                  ? <span className="w-2 h-2 rounded-sm bg-orange-400 shrink-0" />
                  : <Building2 className="w-3 h-3 text-gray-400 shrink-0" />}
                <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 truncate">{g.name}</span>
                <div className="relative">
                  <button onClick={() => setMenu(menu === `grp:${g.key}` ? null : `grp:${g.key}`)}
                    title="Adicionar" className="p-0.5 rounded text-gray-400 hover:text-orange-600 hover:bg-gray-200/60 opacity-0 group-hover/h:opacity-100 transition">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  {menu === `grp:${g.key}` && (
                    <Popover>
                      <PItem icon={<FilePlus className="w-3.5 h-3.5" />} onClick={() => newDoc(g.workspaceId, null)}>Novo documento</PItem>
                      <PItem icon={<FolderPlus className="w-3.5 h-3.5" />} onClick={() => newFolder(g.workspaceId)}>Nova pasta</PItem>
                    </Popover>
                  )}
                </div>
              </div>

              {empty && <p className="px-3 py-1 text-xs text-gray-300">Vazio</p>}

              {/* Pastas */}
              {g.folders.map(f => {
                const inside = g.docsByFolder[f.id] ?? []
                const open = !closed.has(f.id)
                return (
                  <div key={f.id}>
                    <div className="group/f flex items-center gap-1 pl-2 pr-2 py-1 mx-1 rounded-lg hover:bg-gray-100/70">
                      <button onClick={() => toggleFolder(f.id)} className="p-0.5 text-gray-400 hover:text-gray-700 shrink-0">
                        <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-90')} />
                      </button>
                      {open ? <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                      {renamingId === f.id ? (
                        <input autoFocus value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(f.id)}
                          onKeyDown={e => { if (e.key === 'Enter') commitRename(f.id); if (e.key === 'Escape') setRenamingId(null) }}
                          className="flex-1 min-w-0 text-sm bg-white border border-orange-300 rounded px-1 py-0.5 focus:outline-none" />
                      ) : (
                        <button onClick={() => toggleFolder(f.id)} className="flex-1 min-w-0 text-left text-sm font-medium text-gray-700 truncate">{f.title}</button>
                      )}
                      <button onClick={() => newDoc(g.workspaceId, f.id)} title="Novo documento na pasta"
                        className="p-0.5 rounded text-gray-400 hover:text-orange-600 opacity-0 group-hover/f:opacity-100 transition shrink-0">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <div className="relative shrink-0">
                        <button aria-label="Mais opções" onClick={() => setMenu(menu === `fld:${f.id}` ? null : `fld:${f.id}`)}
                          className="p-0.5 rounded text-gray-400 hover:text-gray-700 opacity-0 group-hover/f:opacity-100 transition">
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                        {menu === `fld:${f.id}` && (
                          <Popover>
                            <PItem icon={<Pencil className="w-3.5 h-3.5" />} onClick={() => { setMenu(null); setRenamingId(f.id); setRenameValue(f.title) }}>Renomear</PItem>
                            <PItem icon={<Trash2 className="w-3.5 h-3.5" />} danger
                              onClick={() => { if (inside.length) { toast.error('Esvazie a pasta antes de excluir'); setMenu(null) } else del(f) }}>
                              Excluir
                            </PItem>
                          </Popover>
                        )}
                      </div>
                    </div>

                    {open && inside.map(d => (
                      <DocRow key={d.id} doc={d} orgSlug={orgSlug} active={d.id === currentDocId} nested
                        menuOpen={menu === `doc:${d.id}`} onMenu={() => setMenu(menu === `doc:${d.id}` ? null : `doc:${d.id}`)}
                        folders={g.folders} inFolder onMove={move} />
                    ))}
                  </div>
                )
              })}

              {/* Documentos soltos */}
              {g.looseDocs.map(d => (
                <DocRow key={d.id} doc={d} orgSlug={orgSlug} active={d.id === currentDocId}
                  menuOpen={menu === `doc:${d.id}`} onMenu={() => setMenu(menu === `doc:${d.id}` ? null : `doc:${d.id}`)}
                  folders={g.folders} onMove={move} />
              ))}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function DocRow({ doc, orgSlug, active, nested, inFolder, menuOpen, onMenu, folders, onMove }: {
  doc: Doc
  orgSlug: string
  active: boolean
  nested?: boolean
  inFolder?: boolean
  menuOpen: boolean
  onMenu: () => void
  folders: Doc[]
  onMove: (doc: Doc, folder: Doc | null) => void
}) {
  return (
    <div className={cn('group/d flex items-center gap-1 mx-1 rounded-lg', active ? 'bg-orange-100' : 'hover:bg-gray-100')}>
      <Link href={`/${orgSlug}/docs/${doc.id}`}
        className={cn('flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 text-sm', nested && 'pl-7', active ? 'text-orange-800 font-medium' : 'text-gray-600')}>
        <FileText className={cn('w-3.5 h-3.5 shrink-0', active ? 'text-orange-500' : 'text-gray-400')} />
        <span className="truncate">{doc.title || 'Sem título'}</span>
      </Link>
      <div className="relative shrink-0 pr-1">
        <button aria-label="Mais opções" onClick={onMenu} className="p-0.5 rounded text-gray-400 hover:text-gray-700 opacity-0 group-hover/d:opacity-100 transition">
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        {menuOpen && (
          <Popover>
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Mover para</p>
            {inFolder && <PItem onClick={() => onMove(doc, null)}>Tirar da pasta</PItem>}
            {folders.filter(f => f.id !== doc.parent_id).map(f => (
              <PItem key={f.id} icon={<Folder className="w-3.5 h-3.5 text-amber-500" />} onClick={() => onMove(doc, f)}>{f.title}</PItem>
            ))}
            {folders.filter(f => f.id !== doc.parent_id).length === 0 && !inFolder && (
              <p className="px-3 py-1.5 text-xs text-gray-400">Crie uma pasta primeiro</p>
            )}
          </Popover>
        )}
      </div>
    </div>
  )
}

function Popover({ children }: { children: ReactNode }) {
  return (
    <div className="pop-in absolute right-0 top-full mt-1 z-50 w-48 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5">
      {children}
    </div>
  )
}

function PItem({ icon, children, onClick, danger }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition', danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50')}>
      {icon}<span className="truncate">{children}</span>
    </button>
  )
}
