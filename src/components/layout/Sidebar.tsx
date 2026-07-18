'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Settings,
  LogOut,
  Plus,
  AlignLeft,
  Menu,
  X,
  PanelLeftClose,
  PanelLeft,
  Briefcase,
  Gauge,
  List,
  GanttChart,
  BookOpen,
  PenTool,
  Search,
  Megaphone,
  ClipboardList,
  Wallet,
  Users,
  SquareKanban,
  Building2,
  type LucideIcon,
} from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { ThemeToggle } from './ThemeToggle'
import { InboxNavItem } from './InboxNavItem'
import { MessagesNavItem } from './MessagesNavItem'
import { CommandPalette } from './CommandPalette'

interface Campaign {
  id: string
  name: string
}

interface WorkspaceItem {
  id: string
  name: string
  color: string
  campaigns: Campaign[]
}

interface SidebarProps {
  orgSlug: string
  orgName: string
  userEmail: string
  userAvatar?: string | null
  userName?: string | null
  workspaces: WorkspaceItem[]
  logoUrl?: string | null
  accentColor?: string
  /** Nome do cargo — rótulo do item "Trabalhar" quando houver. */
  positionName?: string | null
  /** Permissão para ver "Liberação de mídias". */
  canMidias?: boolean
  /** Permissão para ver "Liberação de Produção". */
  canProducao?: boolean
  /** Permissão para ver/operar o grupo Financeiro. */
  canFinance?: boolean
  /** Permissão para ver Cadastros. */
  canCadastros?: boolean
  /** Permissão de gestão (owner) — mostra o item "Gestão". */
  canManage?: boolean
  collapsed: boolean
  onCollapse: () => void
  onExpand?: () => void
}

interface NavItem { label: string; href: string }
interface NavGroupDef { id: string; label: string; icon: LucideIcon; items: NavItem[]; finance?: boolean }

// Grupos do módulo comercial/financeiro (SigaSW → One a One).
const COMERCIAL_GROUPS: NavGroupDef[] = [
  { id: 'midias', label: 'Liberação de mídias', icon: Megaphone, items: [
    { label: 'Simplificada', href: 'midias/simplificada' },
    { label: 'Impressa',     href: 'midias/impressa' },
    { label: 'Eletrônica',   href: 'midias/eletronica' },
    { label: 'Externas',     href: 'midias/externas' },
    { label: 'Digitais',     href: 'midias/digitais' },
  ] },
  { id: 'producao', label: 'Liberação de Produção', icon: ClipboardList, items: [
    { label: 'Orçamento',          href: 'producao/orcamento' },
    { label: 'Pedido de produção', href: 'producao/pedido' },
    { label: 'FEE',                href: 'producao/fee' },
    { label: 'Proposta',           href: 'producao/proposta' },
  ] },
  { id: 'financeiro', label: 'Financeiro', icon: Wallet, finance: true, items: [
    { label: 'Painel',         href: 'financeiro/painel' },
    { label: 'Fluxo de caixa', href: 'financeiro/fluxo-caixa' },
    { label: 'Lançamentos',    href: 'financeiro/lancamentos' },
    { label: 'Inadimplentes',  href: 'financeiro/inadimplentes' },
    { label: 'Faturamento',    href: 'financeiro/faturamento' },
    { label: 'Contas',         href: 'financeiro/contas' },
    { label: 'Categorias',     href: 'financeiro/categorias' },
  ] },
  { id: 'cadastros', label: 'Cadastros', icon: Users, items: [
    { label: 'Clientes',     href: 'workspaces' },
    { label: 'Veículos',     href: 'cadastros/veiculos' },
    { label: 'Fornecedores', href: 'cadastros/fornecedores' },
    { label: 'Histórico de docs', href: 'documentos' },
  ] },
]

function NavGroup({ base, pathname, group, open, onToggle }: {
  base: string; pathname: string; group: NavGroupDef; open: boolean; onToggle: () => void
}) {
  const Icon = group.icon
  const anyActive = group.items.some(it => pathname.startsWith(`${base}/${it.href}`))
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex items-center gap-2.5 mx-2 px-2 py-2 rounded-lg text-sm font-medium transition w-[calc(100%-1rem)]',
          anyActive ? 'text-gray-100' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
        )}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left truncate">{group.label}</span>
        <ChevronRight className={cn('w-3.5 h-3.5 text-gray-600 shrink-0 transition-transform duration-150', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="ml-7 mr-2 mt-px space-y-px">
          {group.items.map(it => {
            const href = `${base}/${it.href}`
            const active = pathname.startsWith(href)
            return (
              <Link
                key={it.href}
                href={href}
                className={cn(
                  'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors',
                  active ? 'bg-orange-600/20 text-orange-300' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800/60'
                )}
              >
                <span className="truncate">{it.label}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Visões da org (antes ficavam na barra superior). "Atendimento" = o item "Trabalhar".
const VIEWS = [
  { id: 'lista', label: 'Lista',      icon: List,       href: 'views/lista' },
  { id: 'gantt', label: 'Gantt',      icon: GanttChart, href: 'views/gantt' },
  { id: 'docs',  label: 'Documentos', icon: BookOpen,   href: 'docs' },
  { id: 'boards',label: 'Quadros',    icon: PenTool,    href: 'boards' },
]

type SidebarMode = 'trabalho' | 'operacional'
// Em que modo cada rota se encaixa (null = neutra, não troca o modo).
function modeForPath(path: string, base: string): SidebarMode | null {
  if (['financeiro', 'midias', 'producao', 'cadastros'].some(p => path.startsWith(`${base}/${p}`))) return 'operacional'
  if (['dashboard', 'views', 'docs', 'boards', 'workspaces'].some(p => path.startsWith(`${base}/${p}`))) return 'trabalho'
  return null
}
// Abas de modo (ícones no header). Tarefas/trabalho × comercial/operacional.
const MODE_TABS: { m: SidebarMode; Icon: LucideIcon; label: string }[] = [
  { m: 'trabalho', Icon: SquareKanban, label: 'Trabalho' },
  { m: 'operacional', Icon: Building2, label: 'Operacional' },
]

export function Sidebar({
  orgSlug, orgName, userEmail, userAvatar, userName, workspaces, logoUrl, accentColor = '#f97316', canManage,
  positionName, canMidias = false, canProducao = false, canFinance = false, canCadastros = false, collapsed, onCollapse, onExpand,
}: SidebarProps) {
  const pathname = usePathname()
  const base = `/${orgSlug}`

  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Grupos do Operacional: cada seção aparece conforme cargo × toggles (ver
  // computeAccess). Mídias/Produção dependem do cargo; Financeiro do can_finance;
  // Cadastros de can_vendas OU can_finance.
  const groupVisible: Record<string, boolean> = { midias: canMidias, producao: canProducao, financeiro: canFinance, cadastros: canCadastros }
  const comercialGroups = COMERCIAL_GROUPS.filter(g => groupVisible[g.id])
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sidebar-comercial-groups')
      const set = raw ? new Set(JSON.parse(raw) as string[]) : new Set<string>()
      // garante que o grupo da página atual já abre expandido
      const active = COMERCIAL_GROUPS.find(g => g.items.some(it => pathname.startsWith(`${base}/${it.href}`)))
      if (active) set.add(active.id)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenGroups(set)
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function toggleGroup(id: string) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      try { localStorage.setItem('sidebar-comercial-groups', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  // Modo da sidebar: "Trabalho" (visões + espaços) × "Operacional" (mídia/produção/
  // financeiro/cadastros) — um contexto por vez p/ reduzir a poluição. O switcher só
  // aparece com permissão; ao navegar, o modo acompanha a página atual.
  const canOperacional = canMidias || canProducao || canFinance || canCadastros
  const [mode, setMode] = useState<SidebarMode>(
    () => (canOperacional ? modeForPath(pathname, base) : null) ?? 'trabalho'
  )
  useEffect(() => {
    if (!canOperacional) return
    const m = modeForPath(pathname, base)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (m && m !== mode) setMode(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // SSR sempre renderiza 'Ctrl K'; suppressHydrationWarning no <kbd> cobre o Mac.
  const shortcutLabel =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')
      ? '⌘K'
      : 'Ctrl K'

  // Atalho global ⌘K / Ctrl+K para a busca.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const activeWorkspaceId = workspaces.find(ws =>
    pathname.includes(`/workspaces/${ws.id}`)
  )?.id

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeWorkspaceId ? [activeWorkspaceId] : [])
  )

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (activeWorkspaceId) {
      setExpanded(prev => new Set([...prev, activeWorkspaceId]))
    }
  }, [activeWorkspaceId])

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function expandAll() {
    setExpanded(new Set(workspaces.map(ws => ws.id)))
  }

  function collapseAll() {
    setExpanded(new Set())
  }

  const allExpanded = workspaces.length > 0 && workspaces.every(ws => expanded.has(ws.id))

  // Seção "Espaços" recolhida por padrão (o acesso por cliente é usado menos);
  // lembra a escolha do usuário e abre sozinha ao entrar num cliente.
  const ESPACOS_KEY = 'flow:sidebar-espacos-open'
  const [espacosOpen, setEspacosOpen] = useState(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ESPACOS_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === '1' || (saved === null && activeWorkspaceId)) setEspacosOpen(true)
    } catch { /* localStorage indisponível */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeWorkspaceId) setEspacosOpen(true)
  }, [activeWorkspaceId])
  function toggleEspacos() {
    setEspacosOpen(o => {
      const next = !o
      try { localStorage.setItem(ESPACOS_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  async function signOut() {
    await logout()
  }

  const displayName = userName || userEmail

  const sidebarContent = (
    <aside className="sidebar-shell w-60 bg-gray-900 flex flex-col h-full select-none">

      {/* ── Org header: logo + switcher de modo (Trabalho × Operacional) ── */}
      <div className="px-3 pt-4 pb-3 border-b border-gray-800 flex items-center gap-2">
        <Link
          href={`${base}/dashboard`}
          title={orgName}
          aria-label={orgName}
          className="shrink-0 rounded-lg p-1 hover:bg-gray-800 transition"
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={orgName} className="w-7 h-7 rounded-md object-contain bg-white" />
          ) : (
            <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: accentColor }}>
              <span className="text-white text-[11px] font-bold">{orgName.charAt(0).toUpperCase()}</span>
            </div>
          )}
        </Link>

        {/* Modo: Trabalho × Operacional (ícones) — só com permissão ao Operacional */}
        {canOperacional && (
          <div className="flex items-center gap-0.5 bg-gray-800/60 rounded-lg p-0.5">
            {MODE_TABS.map(({ m, Icon, label }) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                aria-label={label}
                title={label}
                className={cn(
                  'p-1.5 rounded-md transition-colors',
                  mode === m ? 'bg-gray-700 text-orange-400' : 'text-gray-500 hover:text-gray-200'
                )}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
        )}

        {/* Gestão — visão do todo (só o proprietário); ícone de topo, fora dos modos */}
        {canManage && (
          <Link
            href={`${base}/views/gestao`}
            title="Gestão"
            aria-label="Gestão"
            className={cn(
              'shrink-0 p-1.5 rounded-lg transition-colors',
              pathname.startsWith(`${base}/views/gestao`)
                ? 'bg-gray-700 text-orange-400'
                : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800'
            )}
          >
            <Gauge className="w-4 h-4" />
          </Link>
        )}

        <div className="flex-1" />

        {/* Ocultar — desktop only */}
        <button
          onClick={onCollapse}
          className="hidden md:block p-1.5 text-gray-600 hover:text-gray-300 transition shrink-0"
          title="Ocultar menu"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
        {/* Close — mobile only */}
        <button
          onClick={() => setMobileOpen(false)}
          aria-label="Fechar menu"
          className="md:hidden p-1.5 text-gray-600 hover:text-gray-300 transition shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Scrollable body ──────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-3 space-y-1">

        {/* Buscar (⌘K) */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex items-center gap-2.5 mx-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-gray-100 hover:bg-gray-800/60 transition w-[calc(100%-1rem)]"
        >
          <Search className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left">Buscar</span>
          <kbd suppressHydrationWarning className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
            {shortcutLabel}
          </kbd>
        </button>

        {/* Caixa de entrada — antes dos espaços */}
        <InboxNavItem orgSlug={orgSlug} />

        {/* Mensagens — abre o chat (dock no canto inferior direito) */}
        <MessagesNavItem />

        {/* ── Modo Trabalho: Trabalhar + Visões ── */}
        {mode === 'trabalho' && (
          <>
            {/* Trabalhar — tela de trabalho do cargo da pessoa (mostra o cargo, se houver) */}
            <Link
              href={`${base}/views/atendimento`}
              className={cn(
                'flex items-center gap-2.5 mx-2 px-2 py-2 rounded-lg text-sm font-medium transition',
                pathname.startsWith(`${base}/views/atendimento`)
                  ? 'bg-gray-800 text-gray-100'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
              )}
            >
              <Briefcase className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate">{positionName ?? 'Trabalhar'}</span>
            </Link>

            {/* Visões da org — Lista (todos os clientes/status), Gantt, Documentos, Quadros */}
            {VIEWS.map(({ id, label, icon: Icon, href }) => (
              <Link
                key={id}
                href={`${base}/${href}`}
                className={cn(
                  'flex items-center gap-2.5 mx-2 px-2 py-2 rounded-lg text-sm font-medium transition',
                  pathname.startsWith(`${base}/${href}`)
                    ? 'bg-gray-800 text-gray-100'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1">{label}</span>
              </Link>
            ))}

            <div className="mx-3 my-2 border-t border-gray-800" />
          </>
        )}

        {/* ── Modo Operacional: Mídia / Produção / Financeiro / Cadastros ── */}
        {mode === 'operacional' && canOperacional && (
          <div className="mt-1">
            {comercialGroups.map(g => (
              <NavGroup
                key={g.id}
                base={base}
                pathname={pathname}
                group={g}
                open={openGroups.has(g.id)}
                onToggle={() => toggleGroup(g.id)}
              />
            ))}
          </div>
        )}

        {/* ── Modo Trabalho: Espaços (clientes + campanhas) ── */}
        {mode === 'trabalho' && (
        <div>
          <div className="flex items-center justify-between px-4 mb-1.5">
            <button onClick={toggleEspacos} aria-expanded={espacosOpen} className="flex items-center gap-1 group/esp">
              <ChevronRight className={cn('w-3 h-3 text-gray-600 transition-transform duration-150', espacosOpen && 'rotate-90')} />
              <span className="text-[11px] font-semibold text-gray-500 group-hover/esp:text-gray-400 uppercase tracking-[0.08em] transition-colors">
                Espaços
              </span>
              {!espacosOpen && workspaces.length > 0 && (
                <span className="text-[10px] text-gray-600">{workspaces.length}</span>
              )}
            </button>
            <div className="flex items-center gap-1">
              {espacosOpen && (allExpanded ? (
                <button onClick={collapseAll} className="text-gray-600 hover:text-gray-300 transition" title="Fechar todos">
                  <ChevronsUp className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button onClick={expandAll} className="text-gray-600 hover:text-gray-300 transition" title="Expandir todos">
                  <ChevronsDown className="w-3.5 h-3.5" />
                </button>
              ))}
              <Link href={`${base}/workspaces/new`} className="text-gray-600 hover:text-gray-300 transition" title="Novo cliente">
                <Plus className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {espacosOpen && (
          <div className="space-y-px">
            {workspaces.map(ws => {
              const isOpen = expanded.has(ws.id)
              const isWsActive = pathname.includes(`/workspaces/${ws.id}`)

              return (
                <div key={ws.id}>
                  <div className="group flex items-center px-2">
                    <button
                      onClick={() => toggle(ws.id)}
                      aria-label={`${isOpen ? 'Recolher' : 'Expandir'} ${ws.name}`}
                      aria-expanded={isOpen}
                      className="p-1.5 rounded text-gray-600 hover:text-gray-300 transition-colors shrink-0"
                    >
                      <ChevronRight className={cn('w-3 h-3 transition-transform duration-150', isOpen && 'rotate-90')} />
                    </button>
                    <Link
                      href={`${base}/workspaces/${ws.id}`}
                      onClick={() => !isOpen && toggle(ws.id)}
                      className={cn(
                        'flex items-center gap-1.5 flex-1 min-w-0 px-1.5 py-1.5 rounded-lg text-sm font-medium transition-colors',
                        isWsActive && !pathname.includes('/campaigns/')
                          ? 'bg-gray-800/60 text-gray-100'
                          : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
                      )}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ws.color || '#f97316' }} />
                      <span className="truncate">{ws.name}</span>
                    </Link>
                    <Link
                      href={`${base}/workspaces/${ws.id}/campaigns/new`}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-600 hover:text-gray-300 transition"
                      title="Nova campanha"
                    >
                      <Plus className="w-3 h-3" />
                    </Link>
                  </div>

                  {isOpen && (
                    <div className="ml-7 mr-2 mt-px space-y-px">
                      {ws.campaigns.map(camp => {
                        const href = `${base}/workspaces/${ws.id}/campaigns/${camp.id}`
                        const isActive = pathname.startsWith(href)
                        return (
                          <Link
                            key={camp.id}
                            href={href}
                            className={cn(
                              'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors',
                              isActive
                                ? 'bg-orange-600/20 text-orange-300'
                                : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800/60'
                            )}
                          >
                            <AlignLeft className="w-3 h-3 shrink-0 opacity-60" />
                            <span className="truncate">{camp.name}</span>
                          </Link>
                        )
                      })}
                      {ws.campaigns.length === 0 && (
                        <Link
                          href={`${base}/workspaces/${ws.id}/campaigns/new`}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-600 hover:text-gray-400 transition rounded-lg"
                        >
                          <Plus className="w-3 h-3" />
                          Nova campanha
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {workspaces.length === 0 && (
              <Link
                href={`${base}/workspaces/new`}
                className="flex items-center gap-1.5 mx-4 px-2 py-1.5 text-sm text-gray-600 hover:text-gray-400 transition rounded-lg"
              >
                <Plus className="w-3 h-3" />
                Novo cliente
              </Link>
            )}
          </div>
          )}
        </div>
        )}

      </div>

      {/* ── Bottom ───────────────────────────────────── */}
      <div className="border-t border-gray-800">
        <Link
          href={`${base}/settings/membros`}
          className={cn(
            'flex items-center gap-2.5 px-5 py-2.5 text-sm transition-colors',
            pathname.startsWith(`${base}/settings`) ? 'text-white' : 'text-gray-500 hover:text-gray-200'
          )}
        >
          <Settings className="w-4 h-4 shrink-0" />
          Configurações
        </Link>

        <div className="flex items-center gap-2.5 px-4 py-3 border-t border-gray-800">
          <Link
            href={`${base}/perfil`}
            className="flex items-center gap-2.5 flex-1 min-w-0 group"
          >
            {userAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={userAvatar} alt="" className="w-6 h-6 rounded-full shrink-0 object-cover" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                <span className="text-gray-300 text-[10px]">{displayName.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <span className="text-gray-400 text-sm truncate group-hover:text-gray-200 transition-colors">{displayName}</span>
          </Link>
          <ThemeToggle />
          <button onClick={signOut} className="text-gray-600 hover:text-gray-300 transition-colors shrink-0" title="Sair">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )

  return (
    <>
      {/* Hamburger — fixed, visible on mobile only when sidebar is closed */}
      <button
        onClick={() => setMobileOpen(true)}
        className={cn(
          'fixed top-3 left-3 z-50 md:hidden',
          'bg-gray-900 text-gray-300 rounded-lg p-2 shadow-lg',
          'transition-opacity duration-200',
          mobileOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        )}
        aria-label="Abrir menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Expandir — desktop, quando a sidebar está recolhida (substitui o botão do topo) */}
      {collapsed && onExpand && (
        <button
          onClick={onExpand}
          className="hidden md:flex fixed top-3 left-3 z-50 bg-gray-900 text-gray-300 rounded-lg p-2 shadow-lg hover:text-white transition"
          title="Mostrar menu"
          aria-label="Mostrar menu"
        >
          <PanelLeft className="w-5 h-5" />
        </button>
      )}

      {/* Backdrop — mobile only */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar wrapper — drawer on mobile, static on desktop */}
      <div className={cn(
        'fixed inset-y-0 left-0 z-50 md:static md:z-auto',
        'shrink-0 h-full flex',
        'transition-transform duration-300 ease-in-out md:transition-none',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        collapsed && 'md:w-0 md:overflow-hidden'
      )}>
        {sidebarContent}
      </div>

      {/* Busca rápida (⌘K / item "Buscar") */}
      <CommandPalette
        orgSlug={orgSlug}
        workspaces={workspaces}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </>
  )
}
