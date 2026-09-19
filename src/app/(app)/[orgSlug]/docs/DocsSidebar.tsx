'use client'

import { useState, useEffect, useRef, useTransition, type ReactNode, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FileText, Plus, Building2, Folder, FolderOpen, ChevronRight, MoreHorizontal, Pencil, Trash2,
  FolderPlus, FilePlus, Lock, Archive, ArchiveRestore, Target, ChevronLeft, Landmark, ChevronsUp, ChevronsDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { createDocument, createFolder, renameDocument, moveDocument, removeDocument, getDocShareInfo, updateDocumentVisibility, setDocumentArchived } from '@/app/actions/docs'
import { ShareModal } from '@/components/docs/ShareModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { gravarPref, PREF_COOKIES } from '@/lib/sidebar-prefs'
import type { DocNo } from '@/lib/docs-arvore'

interface ShareState {
  docId: string
  visibility: 'org' | 'custom'
  memberIds: string[]
  members: { userId: string; fullName: string | null; email: string }[]
  currentUserId: string
}

/**
 * Árvore de Documentos DENTRO da sidebar do app (casca escura). Entra no lugar
 * da lista do modo enquanto a rota é /docs — ver @painel/docs e Sidebar.tsx.
 *
 * Desenho igual ao de Espaços: mesmo passo de linha, mesmo aceso de item
 * (laranja translúcido), mesma bolinha de cor do cliente. As ações aparecem no
 * hover E no foco do teclado; os menus continuam claros (são popovers).
 *
 * Arrastar para mover (19/09/2026) — o gesto que todo mundo tenta primeiro numa
 * árvore; antes eram 3 cliques (menu → Mover para → destino). Soltar numa pasta
 * = entra nela; num documento = vai para a pasta dele (alvo maior, menos erro);
 * no bloco de um cliente = raiz dele (troca o dono, com a cascata do banco).
 * Só arrasta quem pode mover (régua do move_document). O menu continua sendo
 * o caminho no teclado e no toque — arrastar nativo não existe no celular.
 */
export function DocsSidebar({ orgSlug, orgId, currentDocId, docs, clientes = [], fechadasIniciais = [], meuId = null, souAdmin = false }: {
  orgSlug: string
  orgId: string
  currentDocId: string
  docs: DocNo[]
  /** Clientes da org — destino do "Mover para" e cor do cabeçalho do grupo. */
  clientes?: { id: string; name: string; color: string | null }[]
  /** Pastas fechadas, lidas do cookie no servidor. */
  fechadasIniciais?: string[]
  /** Quem criou pode mover o que é seu; owner/admin move tudo (can_user_manage_doc). */
  meuId?: string | null
  souAdmin?: boolean
}) {
  const router = useRouter()
  const [, start] = useTransition()
  const [share, setShare] = useState<ShareState | null>(null)
  const [closed, setClosed] = useState<Set<string>>(() => new Set(fechadasIniciais))
  // Abrir um documento arquivado já mostra o lado dos arquivados — senão ele some
  // da árvore justamente quando está aberto.
  const [showArchived, setShowArchived] = useState(() => !!docs.find(d => d.id === currentDocId)?.archived)
  const [menu, setMenu] = useState<string | null>(null)
  const [moveFor, setMoveFor] = useState<string | null>(null)   // menu mostrando a lista de destinos
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [excluir, setExcluir] = useState<DocNo | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Arrasto: o item em voo e a chave do destino aceso (`fld:<id>` | `grp:<dono>`).
  const [arrastando, setArrastando] = useState<DocNo | null>(null)
  const [alvo, setAlvo] = useState<string | null>(null)
  // Movimento aparece na hora; a árvore do servidor chega logo depois e zera isto.
  const [otimista, setOtimista] = useState<Record<string, Pick<DocNo, 'parent_id' | 'workspace_id'>>>({})
  const [docsAntes, setDocsAntes] = useState(docs)
  if (docs !== docsAntes) {
    setDocsAntes(docs)
    setOtimista({})
  }

  useEffect(() => {
    if (!menu) return
    function onOut(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null) }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [menu])

  // O documento aberto aparece na árvore: com 10 clientes a lista passa da altura
  // da tela, e quem chega por um link caía com o item fora da vista.
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
  }, [currentDocId])

  async function openShare(docId: string) {
    setMenu(null)
    const info = await getDocShareInfo(orgId, docId)
    if ('error' in info) { toast.error(info.error); return }
    setShare({ docId, visibility: info.visibility, memberIds: info.memberIds, members: info.members, currentUserId: info.currentUserId })
  }

  function setPasta(id: string, aberta: boolean) {
    setClosed(prev => {
      const n = new Set(prev)
      if (aberta) n.delete(id); else n.add(id)
      gravarPref(PREF_COOKIES.docsFechadas, [...n].join('|'))
      return n
    })
  }
  const toggleFolder = (id: string) => setPasta(id, closed.has(id))
  /** Recolher/expandir TODAS as pastas do lado mostrado (ativos ou arquivados) —
   *  as do outro lado mantêm o estado que tinham. */
  function setTodas(ids: string[], aberta: boolean) {
    setClosed(prev => {
      const n = new Set(prev)
      for (const id of ids) { if (aberta) n.delete(id); else n.add(id) }
      gravarPref(PREF_COOKIES.docsFechadas, [...n].join('|'))
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
    if (parentId) setPasta(parentId, true) // abre a pasta-mãe
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
  function move(doc: DocNo, folder: DocNo | null) {
    setMenu(null)
    start(async () => {
      const r = await moveDocument(doc.id, orgSlug, folder ? folder.id : null, folder ? folder.workspace_id : doc.workspace_id)
      if (r?.error) toast.error(r.error); else router.refresh()
    })
  }
  /** Troca o DONO: vai pra raiz do destino (Organização ou cliente). O conteúdo da
   *  pasta acompanha — a cascata é feita no move_document (migration 114). */
  function moveToOwner(doc: DocNo, workspaceId: string | null, nome: string) {
    setMenu(null); setMoveFor(null)
    start(async () => {
      const r = await moveDocument(doc.id, orgSlug, null, workspaceId)
      if (r?.error) { toast.error(r.error); return }
      toast.success(`"${doc.title}" movido para ${nome}.`)
      router.refresh()
    })
  }
  const [excluindo, startExcluir] = useTransition()
  function confirmarExclusao() {
    const alvo = excluir
    if (!alvo) return
    startExcluir(async () => {
      const r = await removeDocument(alvo.id, orgSlug)
      if (r?.error) { toast.error(r.error); return }
      toast.success(`Pasta "${alvo.title}" excluída.`)
      setExcluir(null)
      router.refresh()
    })
  }
  function archive(doc: DocNo) {
    setMenu(null)
    start(async () => {
      const r = await setDocumentArchived(doc.id, orgSlug, !doc.archived)
      if (r?.error) toast.error(r.error)
      else { toast.success(doc.archived ? 'Reativado.' : (doc.is_folder ? 'Pasta arquivada (com o conteúdo).' : 'Arquivado.')); router.refresh() }
    })
  }

  // ── Monta a árvore: filhos por pasta (parent_id) + raízes por dono (cliente) ──
  // Arquivadas × ativas: arquivar pasta arquiva o conteúdo, então a subárvore
  // inteira cai do mesmo lado.
  const corDe = new Map(clientes.map(c => [c.id, c.color]))
  const clienteDe = new Map(clientes.map(c => [c.id, c]))
  const docsView = Object.keys(otimista).length === 0 ? docs : docs.map(d => {
    const o = otimista[d.id]
    if (!o) return d
    const c = o.workspace_id ? clienteDe.get(o.workspace_id) : null
    return { ...d, ...o, workspaces: c ? { name: c.name, color: c.color } : null }
  })
  const byId = new Map(docsView.map(d => [d.id, d]))
  const visibleDocs = docsView.filter(d => !!d.archived === showArchived)
  const pastasVisiveis = visibleDocs.filter(d => d.is_folder).map(d => d.id)
  // Uma aberta basta para o botão oferecer "recolher" — é o que ainda ocupa espaço.
  const algumaAberta = pastasVisiveis.some(id => !closed.has(id))
  const childrenByParent = new Map<string, DocNo[]>()
  for (const d of visibleDocs) if (d.parent_id) {
    const arr = childrenByParent.get(d.parent_id) ?? []
    arr.push(d); childrenByParent.set(d.parent_id, arr)
  }
  type Grupo = { key: string; name: string; workspaceId: string | null; color: string | null; roots: DocNo[]; folders: DocNo[] }
  const groupsMap = new Map<string, Grupo>()
  const ensure = (d: Pick<DocNo, 'workspace_id' | 'workspaces'> | null) => {
    const workspaceId = d?.workspace_id ?? null
    const key = workspaceId ?? '__org__'
    if (!groupsMap.has(key)) groupsMap.set(key, {
      key, workspaceId,
      name: workspaceId ? (d?.workspaces?.name ?? 'Cliente') : 'Organização',
      color: workspaceId ? (d?.workspaces?.color ?? corDe.get(workspaceId) ?? null) : null,
      roots: [], folders: [],
    })
    return groupsMap.get(key)!
  }
  if (!showArchived) ensure(null)
  for (const d of visibleDocs) {
    const g = ensure(d)
    if (d.is_folder) g.folders.push(d)
    if (!d.parent_id) g.roots.push(d)
  }
  const groups = [...groupsMap.values()].sort((a, b) =>
    a.key === '__org__' ? -1 : b.key === '__org__' ? 1 : a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))

  // ── Arrastar para mover ──
  type Destino = { parentId: string | null; workspaceId: string | null; nome: string; chave: string }
  const destinoPasta = (f: DocNo): Destino => ({ parentId: f.id, workspaceId: f.workspace_id, nome: f.title, chave: `fld:${f.id}` })
  const destinoGrupo = (g: Grupo): Destino => ({ parentId: null, workspaceId: g.workspaceId, nome: g.name, chave: `grp:${g.key}` })
  /** Documento como alvo = a pasta (ou a raiz do dono) onde ele está. */
  function destinoDoDoc(d: DocNo): Destino | null {
    if (d.parent_id) { const mae = byId.get(d.parent_id); return mae ? destinoPasta(mae) : null }
    const g = groupsMap.get(d.workspace_id ?? '__org__')
    return g ? destinoGrupo(g) : null
  }
  const podeMover = (d: DocNo) => souAdmin || (!!meuId && d.created_by === meuId)
  /** `id` está dentro da pasta `pastaId` (em qualquer nível)? */
  function dentroDe(pastaId: string, id: string) {
    for (let n = byId.get(id); n?.parent_id; n = byId.get(n.parent_id)) if (n.parent_id === pastaId) return true
    return false
  }
  // O banco também barra o ciclo; aqui é pra o cursor já dizer "não" no hover.
  function destinoValido(d: DocNo, dest: Destino) {
    if (dest.parentId === d.id) return false
    if (dest.parentId && d.is_folder && dentroDe(d.id, dest.parentId)) return false
    return !(dest.parentId === d.parent_id && dest.workspaceId === d.workspace_id)
  }
  /** Acesso que vale para o item com essa mãe: manda a pasta-RAIZ; na raiz, o próprio. */
  function acessoCom(d: DocNo, parentId: string | null) {
    let r = parentId ? byId.get(parentId) : undefined
    while (r?.parent_id) r = byId.get(r.parent_id)
    return r ? { restrito: r.visibility === 'custom', raiz: r.title } : { restrito: d.visibility === 'custom', raiz: null }
  }

  function fonte(d: DocNo) {
    if (!podeMover(d) || renamingId === d.id) return {}
    return {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.stopPropagation()
        e.dataTransfer.effectAllowed = 'move'
        // Tipo próprio, não text/plain: soltado por engano sobre o editor, text/plain
        // colaria o título dentro do documento aberto. O Firefox só arrasta com dado.
        e.dataTransfer.setData('application/x-flow-doc', d.id)
        // Um tique depois: o navegador fotografa a linha para a "sombra" no fim
        // deste evento — apagar antes disso deixa a sombra apagada também.
        setTimeout(() => { setMenu(null); setArrastando(d) }, 0)
      },
      onDragEnd: () => { setArrastando(null); setAlvo(null) },
    }
  }
  function alvoDe(dest: Destino | null) {
    return {
      onDragOver: (e: DragEvent) => {
        if (!arrastando || !dest) return
        e.stopPropagation()   // a linha decide; o bloco do dono não "rouba" o hover
        if (!destinoValido(arrastando, dest)) { if (alvo) setAlvo(null); return }   // sem preventDefault = cursor proibido
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (alvo !== dest.chave) setAlvo(dest.chave)
      },
      onDrop: (e: DragEvent) => {
        if (!arrastando || !dest) return
        e.preventDefault(); e.stopPropagation()
        const d = arrastando
        setArrastando(null); setAlvo(null)
        if (destinoValido(d, dest)) soltar(d, dest)
      },
    }
  }
  function soltar(d: DocNo, dest: Destino) {
    const origem = { parent_id: d.parent_id, workspace_id: d.workspace_id }
    const antes = acessoCom(d, d.parent_id)
    const depois = acessoCom(d, dest.parentId)
    setOtimista(o => ({ ...o, [d.id]: { parent_id: dest.parentId, workspace_id: dest.workspaceId } }))
    if (dest.parentId) setPasta(dest.parentId, true)   // abre a pasta: mostra onde caiu
    start(async () => {
      const r = await moveDocument(d.id, orgSlug, dest.parentId, dest.workspaceId)
      if (r?.error) {
        setOtimista(o => { const n = { ...o }; delete n[d.id]; return n })
        toast.error(r.error)
        return
      }
      // O acesso herda da pasta-raiz: mudar de pasta pode abrir ou fechar o
      // documento para o time. Isso não pode acontecer calado.
      const aviso = antes.restrito && !depois.restrito ? ' Agora visível para toda a equipe.'
        : !antes.restrito && depois.restrito ? ` Agora com o acesso restrito de "${depois.raiz}".` : ''
      toast.success(`"${d.title || 'Sem título'}" movido para ${dest.nome}.${aviso}`, {
        duration: aviso ? 8000 : 4000,
        action: { label: 'Desfazer', onClick: () => desfazer(d, origem) },
      })
      router.refresh()
    })
  }
  function desfazer(d: DocNo, origem: Pick<DocNo, 'parent_id' | 'workspace_id'>) {
    setOtimista(o => ({ ...o, [d.id]: origem }))
    start(async () => {
      const r = await moveDocument(d.id, orgSlug, origem.parent_id, origem.workspace_id)
      if (r?.error) toast.error(r.error)
      router.refresh()
    })
  }

  // Ação que só aparece no hover da linha — e no foco, pra quem navega no teclado.
  const acaoHover = 'p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700/60 opacity-0 focus-visible:opacity-100 transition-opacity'

  // Renderiza um nó (pasta recursiva ou documento). depth = nível de indentação.
  function renderNode(d: DocNo, depth: number, groupFolders: DocNo[]): ReactNode {
    if (d.is_folder) {
      const kids = childrenByParent.get(d.id) ?? []
      const open = !closed.has(d.id)
      return (
        <div key={d.id}>
          <div {...fonte(d)} {...alvoDe(destinoPasta(d))}
            className={cn('group/f flex items-center gap-1 mx-2 pr-1 py-1 rounded-lg transition-colors',
              alvo === `fld:${d.id}`
                ? 'bg-orange-600/20 text-gray-100 ring-1 ring-inset ring-orange-500/50'
                : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60',
              arrastando?.id === d.id && 'opacity-40')}
            style={{ paddingLeft: 4 + depth * 14 }}>
            <button type="button" onClick={() => toggleFolder(d.id)} aria-expanded={open}
              aria-label={`${open ? 'Fechar' : 'Abrir'} pasta ${d.title}`}
              className="no-press p-0.5 rounded text-gray-600 hover:text-gray-300 shrink-0">
              <ChevronRight className={cn('w-3.5 h-3.5 transition-transform duration-150', open && 'rotate-90')} />
            </button>
            {open ? <FolderOpen className="w-3.5 h-3.5 text-amber-500/90 shrink-0" /> : <Folder className="w-3.5 h-3.5 text-amber-500/90 shrink-0" />}
            {!d.parent_id && d.visibility === 'custom' && <Lock aria-label="Acesso restrito" className="w-3 h-3 text-gray-500 shrink-0" />}
            {renamingId === d.id ? (
              <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                aria-label="Nome da pasta"
                onBlur={() => commitRename(d.id)}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(d.id); if (e.key === 'Escape') setRenamingId(null) }}
                className="flex-1 min-w-0 text-sm bg-gray-800 text-gray-100 border border-orange-500/60 rounded px-1.5 py-0.5 focus:outline-none" />
            ) : (
              <button type="button" onClick={() => toggleFolder(d.id)}
                className="no-press flex-1 min-w-0 py-0.5 text-left text-sm font-medium truncate">{d.title}</button>
            )}
            <button type="button" onClick={() => newDoc(d.workspace_id, d.id)} aria-label={`Novo documento em ${d.title}`}
              className={cn(acaoHover, 'group-hover/f:opacity-100 shrink-0')}><Plus className="w-3.5 h-3.5" /></button>
            <div className="relative shrink-0">
              <button type="button" aria-label={`Mais opções de ${d.title}`} aria-expanded={menu === `fld:${d.id}`}
                onClick={() => setMenu(menu === `fld:${d.id}` ? null : `fld:${d.id}`)}
                className={cn(acaoHover, 'group-hover/f:opacity-100', menu === `fld:${d.id}` && 'opacity-100')}>
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
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
                    onClick={() => { setMenu(null); if (kids.length) toast.error('Esvazie a pasta antes de excluir.'); else setExcluir(d) }}>Excluir</PItem>
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
        folders={groupFolders} onMove={move} onArchive={archive} acaoHover={acaoHover}
        arraste={{ ...fonte(d), ...alvoDe(destinoDoDoc(d)) }} arrastado={arrastando?.id === d.id} />
    )
  }

  return (
    <>
    <div ref={ref} className="mt-1" onDragOver={() => { if (alvo) setAlvo(null) }}>
      {/* Cabeçalho: nome da seção + alternância ativos × arquivados. O rótulo
          acompanha o lado mostrado, pra ninguém confundir arquivado com ativo. */}
      <div className="flex items-center justify-between px-4 mb-1">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.08em]">
          {showArchived ? 'Arquivados' : 'Documentos'}
        </span>
        <div className="flex items-center gap-0.5">
          {/* Recolher todas ↔ expandir todas, como em Espaços. Some sem pasta. */}
          {pastasVisiveis.length > 0 && (
            <button type="button" onClick={() => setTodas(pastasVisiveis, !algumaAberta)}
              aria-label={algumaAberta ? 'Recolher todas as pastas' : 'Expandir todas as pastas'}
              data-tip={algumaAberta ? 'Recolher todas' : 'Expandir todas'}
              className="tip press p-1 rounded-md text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors">
              {algumaAberta ? <ChevronsUp className="w-3.5 h-3.5" /> : <ChevronsDown className="w-3.5 h-3.5" />}
            </button>
          )}
          <button type="button" onClick={() => setShowArchived(v => !v)} aria-pressed={showArchived}
            className={cn('press inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors',
              showArchived ? 'bg-gray-700 text-orange-400' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800')}>
            <Archive className="w-3 h-3" />
            {showArchived ? 'Ver ativos' : 'Arquivados'}
          </button>
        </div>
      </div>

      {groups.length === 0 && (
        <p className="px-4 py-2 text-xs text-gray-500">Nada arquivado.</p>
      )}

      {groups.map(g => (
        <div key={g.key} {...alvoDe(destinoGrupo(g))}
          className={cn('mt-3 first:mt-2 pb-0.5 rounded-lg transition-colors',
            alvo === `grp:${g.key}` && 'bg-orange-600/10 ring-1 ring-inset ring-orange-500/40')}>
          <div className="group/h flex items-center gap-2 px-4 mb-0.5">
            {g.workspaceId
              ? <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color || '#f97316' }} />
              : <Building2 className="w-3 h-3 text-gray-500 shrink-0" />}
            <span className="flex-1 min-w-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 truncate">{g.name}</span>
            {!showArchived && (
              <div className="relative">
                <button type="button" onClick={() => setMenu(menu === `grp:${g.key}` ? null : `grp:${g.key}`)}
                  aria-label={`Adicionar em ${g.name}`} aria-expanded={menu === `grp:${g.key}`}
                  className={cn(acaoHover, 'group-hover/h:opacity-100', menu === `grp:${g.key}` && 'opacity-100')}>
                  <Plus className="w-3.5 h-3.5" />
                </button>
                {menu === `grp:${g.key}` && (
                  <Popover>
                    <PItem icon={<FilePlus className="w-3.5 h-3.5" />} onClick={() => newDoc(g.workspaceId, null)}>Novo documento</PItem>
                    <PItem icon={<FolderPlus className="w-3.5 h-3.5" />} onClick={() => newFolder(g.workspaceId)}>Nova pasta</PItem>
                  </Popover>
                )}
              </div>
            )}
          </div>

          {g.roots.length === 0 && <p className="px-4 py-1 text-xs text-gray-500">Vazio</p>}
          <div className="space-y-px">
            {g.roots.map(d => renderNode(d, 0, g.folders))}
          </div>
        </div>
      ))}
    </div>

    {/* Diálogos vão para o <body>: a árvore mora dentro da sidebar, cujo wrapper
        tem `translate` (drawer do celular) — e `translate` vira o bloco de
        contenção de todo `fixed` descendente. Sem o portal, o backdrop ficava
        preso nos 240px da sidebar. De quebra, escapam da paleta fixa da casca. */}
    {share && createPortal(
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
      />,
      document.body,
    )}

    {excluir && createPortal(
      <ConfirmDialog
        open
        title="Excluir pasta?"
        description={`A pasta "${excluir.title}" está vazia e será excluída de vez. Para guardar, use Arquivar.`}
        loading={excluindo}
        onConfirm={confirmarExclusao}
        onCancel={() => setExcluir(null)}
      />,
      document.body,
    )}
    </>
  )
}

function DocRow({ doc, orgSlug, active, depth, menuOpen, onMenu, folders, onMove, onArchive, acaoHover, arraste, arrastado }: {
  doc: DocNo
  orgSlug: string
  active: boolean
  depth: number
  menuOpen: boolean
  onMenu: () => void
  folders: DocNo[]
  onMove: (doc: DocNo, folder: DocNo | null) => void
  onArchive: (doc: DocNo) => void
  acaoHover: string
  /** Handlers do arrasto (fonte + alvo), montados na árvore. */
  arraste: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean }
  arrastado: boolean
}) {
  const inFolder = !!doc.parent_id
  const isBriefing = !!(doc.briefing_workspace_id || doc.briefing_campaign_id)
  const destinos = folders.filter(f => f.id !== doc.parent_id)
  // 20 = chevron (18) + gap da pasta − o px da linha: o ícone do documento cai
  // exatamente sob o ícone da pasta do mesmo nível.
  return (
    <div {...arraste} className={cn('group/d flex items-center mx-2 pr-1 rounded-lg transition-colors',
      active ? 'bg-orange-600/20' : 'hover:bg-gray-800/60', arrastado && 'opacity-40')}
      style={{ paddingLeft: 20 + depth * 14 }}>
      {/* draggable=false: quem arrasta é a linha, não o link (senão o navegador
          arrasta a URL e o drop vira "abrir link"). O clique continua navegando. */}
      <Link href={`/${orgSlug}/docs/${doc.id}`} aria-current={active ? 'page' : undefined} draggable={false}
        className={cn('no-press flex items-center gap-2 flex-1 min-w-0 px-1.5 py-1.5 text-sm transition-colors',
          active ? 'text-orange-300 font-medium' : 'text-gray-400 hover:text-gray-100')}>
        {isBriefing
          ? <Target className={cn('w-3.5 h-3.5 shrink-0', active ? 'text-orange-400' : 'text-orange-400/80')} />
          : <FileText className={cn('w-3.5 h-3.5 shrink-0', active ? 'text-orange-400' : 'text-gray-500')} />}
        <span className="truncate">{doc.title || 'Sem título'}</span>
        {isBriefing && <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-orange-400/80">brief</span>}
      </Link>
      <div className="relative shrink-0">
        <button type="button" aria-label={`Mais opções de ${doc.title || 'documento'}`} aria-expanded={menuOpen} onClick={onMenu}
          className={cn(acaoHover, 'group-hover/d:opacity-100', menuOpen && 'opacity-100')}>
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        {menuOpen && (
          <Popover>
            <PItem icon={doc.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />} onClick={() => onArchive(doc)}>
              {doc.archived ? 'Reativar' : 'Arquivar'}
            </PItem>
            <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 border-t border-gray-100 mt-1">Mover para</p>
            {inFolder && <PItem onClick={() => onMove(doc, null)}>Tirar da pasta</PItem>}
            {destinos.map(f => (
              <PItem key={f.id} icon={<Folder className="w-3.5 h-3.5 text-amber-500" />} onClick={() => onMove(doc, f)}>{f.title}</PItem>
            ))}
            {destinos.length === 0 && !inFolder && (
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
  doc: DocNo
  clientes: { id: string; name: string; color: string | null }[]
  onPick: (doc: DocNo, workspaceId: string | null, nome: string) => void
  onBack: () => void
}) {
  return (
    <>
      <button type="button" onClick={onBack}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 transition-colors">
        <ChevronLeft className="w-3 h-3" /> Mover para
      </button>
      <div className="max-h-56 overflow-y-auto border-t border-gray-100 pt-1">
        <PItem icon={<Landmark className="w-3.5 h-3.5" />} onClick={() => onPick(doc, null, 'Organização')}>Organização</PItem>
        {clientes.map(c => (
          <PItem key={c.id} icon={<span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color || '#f97316' }} />}
            onClick={() => onPick(doc, c.id, c.name)}>{c.name}</PItem>
        ))}
        {clientes.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">Nenhum cliente cadastrado.</p>}
      </div>
    </>
  )
}

/** Menu claro sobre a casca escura: é popover, segue a regra dos popovers do app. */
function Popover({ children }: { children: ReactNode }) {
  return (
    <div className="pop-in absolute right-0 top-full mt-1 z-[var(--z-popover)] w-48 origin-top-right bg-white rounded-xl border border-gray-200 shadow-lg py-1.5 select-text">
      {children}
    </div>
  )
}

function PItem({ icon, children, onClick, danger }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('no-press w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors', danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50')}>
      {icon}<span className="truncate">{children}</span>
    </button>
  )
}
