'use client'

import { useState, useEffect, useRef, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FileText, Plus, Building2, PanelLeftClose, PanelLeft, Loader2,
  Folder, FolderOpen, ChevronRight, MoreHorizontal, Pencil, Trash2,
  FolderPlus, FilePlus, Lock, Archive, ArchiveRestore, Target, ChevronLeft, Landmark,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { createDocument, createFolder, renameDocument, moveDocument, removeDocument, getDocShareInfo, updateDocumentVisibility, setDocumentArchived } from '@/app/actions/docs'
import { ShareModal } from '@/components/docs/ShareModal'

interface Doc {
  id: string
  title: string
  visibility: string
  workspace_id: string | null
  parent_id: string | null
  is_folder: boolean
  archived?: boolean
  briefing_workspace_id?: string | null
  briefing_campaign_id?: string | null
  workspaces?: { name: string } | null
}

const COLLAPSE_KEY = 'docs-sidebar-collapsed'
const CLOSED_KEY = 'docs-folders-closed'

interface ShareState {
  docId: string
  visibility: 'org' | 'custom'
  memberIds: string[]
  members: { userId: string; fullName: string | null; email: string }[]
  currentUserId: string
}

export function DocsSidebar({ orgSlug, orgId, currentDocId, docs, currentUserId, clientes = [] }: {
  orgSlug: string
  orgId: string
  currentDocId: string
  docs: Doc[]
  currentUserId: string
  /** Clientes da org — destino do "Mover para". */
  clientes?: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [, start] = useTransition()
  const [share, setShare] = useState<ShareState | null>(null)

  async function openShare(docId: string) {
    setMenu(null)
    const info = await getDocShareInfo(orgId, docId)
    if ('error' in info) { toast.error(info.error); return }
    setShare({ docId, visibility: info.visibility, memberIds: info.memberIds, members: info.members, currentUserId: info.currentUserId })
  }
  const [collapsed, setCollapsed] = useState(false)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [showArchived, setShowArchived] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [moveFor, setMoveFor] = useState<string | null>(null)   // menu mostrando a lista de destinos
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
  async function newFolder(workspaceId: string | null, parentId: string | null = null) {
    setMenu(null)
    if (parentId) setClosed(prev => { const n = new Set(prev); n.delete(parentId); return n }) // abre a pasta-mãe
    const r = await createFolder(orgId, orgSlug, workspaceId, 'Nova pasta', parentId)
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
  /** Troca o DONO: vai pra raiz do destino (Organização ou cliente). O conteúdo da
   *  pasta acompanha — a cascata é feita no move_document (migration 114). */
  function moveToOwner(doc: Doc, workspaceId: string | null, nome: string) {
    setMenu(null); setMoveFor(null)
    start(async () => {
      const r = await moveDocument(doc.id, orgSlug, null, workspaceId)
      if (r?.error) { toast.error(r.error); return }
      toast.success(`"${doc.title}" movido para ${nome}.`)
      router.refresh()
    })
  }
  function del(doc: Doc) {
    setMenu(null)
    start(async () => { const r = await removeDocument(doc.id, orgSlug); if (r?.error) toast.error(r.error); else router.refresh() })
  }
  function archive(doc: Doc) {
    setMenu(null)
    start(async () => {
      const r = await setDocumentArchived(doc.id, orgSlug, !doc.archived)
      if (r?.error) toast.error(r.error)
      else { toast.success(doc.archived ? 'Reativado.' : (doc.is_folder ? 'Pasta arquivada (com o conteúdo).' : 'Arquivado.')); router.refresh() }
    })
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

  // ── Monta a árvore: filhos por pasta (parent_id) + roots por grupo (workspace) ──
  // Filtra por arquivadas × ativas (arquivar pasta arquiva o conteúdo, então o
  // subtree inteiro cai no mesmo lado).
  const visibleDocs = docs.filter(d => !!d.archived === showArchived)
  const childrenByParent = new Map<string, Doc[]>()
  for (const d of visibleDocs) if (d.parent_id) {
    const arr = childrenByParent.get(d.parent_id) ?? []
    arr.push(d); childrenByParent.set(d.parent_id, arr)
  }
  const groupsMap = new Map<string, { key: string; name: string; workspaceId: string | null; roots: Doc[]; folders: Doc[] }>()
  const ensure = (workspaceId: string | null, wsName?: string | null) => {
    const key = workspaceId ?? '__org__'
    if (!groupsMap.has(key)) groupsMap.set(key, { key, name: workspaceId ? (wsName ?? 'Cliente') : 'Organização', workspaceId, roots: [], folders: [] })
    return groupsMap.get(key)!
  }
  if (!showArchived) ensure(null)
  for (const d of visibleDocs) {
    const g = ensure(d.workspace_id, d.workspaces?.name)
    if (d.is_folder) g.folders.push(d)
    if (!d.parent_id) g.roots.push(d)
  }
  const groups = [...groupsMap.values()].sort((a, b) =>
    a.key === '__org__' ? -1 : b.key === '__org__' ? 1 : a.name.localeCompare(b.name))

  // Renderiza um nó (pasta recursiva ou documento). depth = nível de indentação.
  function renderNode(d: Doc, depth: number, groupFolders: Doc[]): ReactNode {
    if (d.is_folder) {
      const kids = childrenByParent.get(d.id) ?? []
      const open = !closed.has(d.id)
      return (
        <div key={d.id}>
          <div className="group/f flex items-center gap-1 pr-2 py-1 mx-1 rounded-lg hover:bg-gray-100/70" style={{ paddingLeft: 8 + depth * 14 }}>
            <button onClick={() => toggleFolder(d.id)} className="p-0.5 text-gray-400 hover:text-gray-700 shrink-0">
              <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-90')} />
            </button>
            {open ? <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
            {!d.parent_id && d.visibility === 'custom' && <Lock className="w-3 h-3 text-gray-400 shrink-0" />}
            {renamingId === d.id ? (
              <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                onBlur={() => commitRename(d.id)}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(d.id); if (e.key === 'Escape') setRenamingId(null) }}
                className="flex-1 min-w-0 text-sm bg-white border border-orange-300 rounded px-1 py-0.5 focus:outline-none" />
            ) : (
              <button onClick={() => toggleFolder(d.id)} className="flex-1 min-w-0 text-left text-sm font-medium text-gray-700 truncate">{d.title}</button>
            )}
            <button onClick={() => newDoc(d.workspace_id, d.id)} title="Novo documento na pasta"
              className="p-0.5 rounded text-gray-400 hover:text-orange-600 opacity-0 group-hover/f:opacity-100 transition shrink-0"><Plus className="w-3.5 h-3.5" /></button>
            <div className="relative shrink-0">
              <button aria-label="Mais opções" onClick={() => setMenu(menu === `fld:${d.id}` ? null : `fld:${d.id}`)}
                className="p-0.5 rounded text-gray-400 hover:text-gray-700 opacity-0 group-hover/f:opacity-100 transition"><MoreHorizontal className="w-3.5 h-3.5" /></button>
              {menu === `fld:${d.id}` && moveFor === d.id && (
                <Popover><OwnerList doc={d} clientes={clientes} onPick={moveToOwner} onBack={() => setMoveFor(null)} /></Popover>
              )}
              {menu === `fld:${d.id}` && moveFor !== d.id && (
                <Popover>
                  <PItem icon={<FolderPlus className="w-3.5 h-3.5" />} onClick={() => newFolder(d.workspace_id, d.id)}>Nova subpasta</PItem>
                  <PItem icon={<Pencil className="w-3.5 h-3.5" />} onClick={() => { setMenu(null); setRenamingId(d.id); setRenameValue(d.title) }}>Renomear</PItem>
                  <PItem icon={<Building2 className="w-3.5 h-3.5" />} onClick={() => setMoveFor(d.id)}>Mover para…</PItem>
                  {!d.parent_id
                    ? <PItem icon={<Lock className="w-3.5 h-3.5" />} onClick={() => openShare(d.id)}>Compartilhar / acesso</PItem>
                    : <PItem icon={<FolderOpen className="w-3.5 h-3.5" />} onClick={() => move(d, null)}>Mover pra raiz</PItem>}
                  <PItem icon={d.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />} onClick={() => archive(d)}>
                    {d.archived ? 'Reativar' : 'Arquivar pasta'}
                  </PItem>
                  <PItem icon={<Trash2 className="w-3.5 h-3.5" />} danger
                    onClick={() => { if (kids.length) { toast.error('Esvazie a pasta antes de excluir'); setMenu(null) } else del(d) }}>Excluir</PItem>
                </Popover>
              )}
            </div>
          </div>
          {open && kids.map(k => renderNode(k, depth + 1, groupFolders))}
        </div>
      )
    }
    return (
      <DocRow key={d.id} doc={d} orgSlug={orgSlug} active={d.id === currentDocId} depth={depth}
        menuOpen={menu === `doc:${d.id}`} onMenu={() => setMenu(menu === `doc:${d.id}` ? null : `doc:${d.id}`)}
        folders={groupFolders} onMove={move} onArchive={archive} />
    )
  }

  return (
    <>
    <aside ref={ref} className="hidden md:flex w-64 shrink-0 border-r border-gray-100 bg-gray-50/40 flex-col h-full">
      <div className="flex items-center justify-between px-3 py-3 border-b border-gray-100 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Documentos</span>
        <button onClick={toggleSidebar} title="Ocultar lista"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-gray-100 shrink-0">
        <div className="inline-flex w-full rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
          <button onClick={() => setShowArchived(false)}
            className={cn('flex-1 px-2 py-1 rounded-md transition-colors', !showArchived ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>Ativas</button>
          <button onClick={() => setShowArchived(true)}
            className={cn('flex-1 px-2 py-1 rounded-md transition-colors inline-flex items-center justify-center gap-1', showArchived ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>
            <Archive className="w-3 h-3" /> Arquivadas
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {groups.map(g => (
          <div key={g.key} className="mb-3">
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

            {g.roots.length === 0 && <p className="px-3 py-1 text-xs text-gray-300">Vazio</p>}
            {g.roots.map(d => renderNode(d, 0, g.folders))}
          </div>
        ))}
      </div>
    </aside>

    {share && (
      <ShareModal
        visibility={share.visibility}
        sharedMemberIds={share.memberIds}
        members={share.members}
        currentUserId={share.currentUserId}
        onSave={async (visibility, memberIds) => {
          const r = await updateDocumentVisibility(share.docId, orgSlug, visibility, memberIds)
          if (r?.error) { toast.error(r.error); return }
          setShare(null); router.refresh()
        }}
        onClose={() => setShare(null)}
      />
    )}
    </>
  )
}

function DocRow({ doc, orgSlug, active, depth, menuOpen, onMenu, folders, onMove, onArchive }: {
  doc: Doc
  orgSlug: string
  active: boolean
  depth: number
  menuOpen: boolean
  onMenu: () => void
  folders: Doc[]
  onMove: (doc: Doc, folder: Doc | null) => void
  onArchive: (doc: Doc) => void
}) {
  const inFolder = !!doc.parent_id
  const isBriefing = !!(doc.briefing_workspace_id || doc.briefing_campaign_id)
  // +22 = largura do chevron (18) + gap (4) da pasta → alinha o ícone do doc sob o
  // ícone da pasta do mesmo nível (itens dentro da pasta ficam visivelmente aninhados).
  return (
    <div className={cn('group/d flex items-center gap-1 mx-1 rounded-lg', active ? 'bg-orange-100' : 'hover:bg-gray-100')} style={{ paddingLeft: 22 + depth * 14 }}>
      <Link href={`/${orgSlug}/docs/${doc.id}`}
        className={cn('flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 text-sm', active ? 'text-orange-800 font-medium' : 'text-gray-600')}>
        {isBriefing
          ? <Target className={cn('w-3.5 h-3.5 shrink-0', active ? 'text-orange-500' : 'text-orange-400')} />
          : <FileText className={cn('w-3.5 h-3.5 shrink-0', active ? 'text-orange-500' : 'text-gray-400')} />}
        <span className="truncate">{doc.title || 'Sem título'}</span>
        {isBriefing && <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-orange-500/80">brief</span>}
      </Link>
      <div className="relative shrink-0 pr-1">
        <button aria-label="Mais opções" onClick={onMenu} className="p-0.5 rounded text-gray-400 hover:text-gray-700 opacity-0 group-hover/d:opacity-100 transition">
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        {menuOpen && (
          <Popover>
            <PItem icon={doc.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />} onClick={() => onArchive(doc)}>
              {doc.archived ? 'Reativar' : 'Arquivar'}
            </PItem>
            <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 border-t border-gray-100 mt-1">Mover para</p>
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

/** Lista de destinos do "Mover para": Organização ou um cliente.
 *  Vai pra RAIZ do destino de propósito — deixar dentro de uma pasta de outro dono
 *  é justamente a inconsistência que a cascata resolve. */
function OwnerList({ doc, clientes, onPick, onBack }: {
  doc: Doc
  clientes: { id: string; name: string }[]
  onPick: (doc: Doc, workspaceId: string | null, nome: string) => void
  onBack: () => void
}) {
  return (
    <>
      <button onClick={onBack}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 transition">
        <ChevronLeft className="w-3 h-3" /> Mover para
      </button>
      <div className="max-h-56 overflow-y-auto border-t border-gray-100 pt-1">
        <PItem icon={<Landmark className="w-3.5 h-3.5" />} onClick={() => onPick(doc, null, 'Organização')}>Organização</PItem>
        {clientes.map(c => (
          <PItem key={c.id} icon={<Building2 className="w-3.5 h-3.5" />} onClick={() => onPick(doc, c.id, c.name)}>{c.name}</PItem>
        ))}
        {clientes.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">Nenhum cliente cadastrado.</p>}
      </div>
    </>
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
