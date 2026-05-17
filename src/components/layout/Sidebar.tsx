'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  ChevronRight,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  List,
  GanttChart,
  Users,
  BookOpen,
  Settings,
  LogOut,
  Plus,
  AlignLeft,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

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
}

const VIEWS = [
  { href: 'views/atendimento', label: 'Atendimento', icon: Users },
  { href: 'views/gantt', label: 'Gantt', icon: GanttChart },
  { href: 'docs', label: 'Documentos', icon: BookOpen },
]

export function Sidebar({
  orgSlug, orgName, userEmail, userAvatar, userName, workspaces,
}: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const base = `/${orgSlug}`

  // Find which workspace is currently active (from the URL)
  const activeWorkspaceId = workspaces.find(ws =>
    pathname.includes(`/workspaces/${ws.id}`)
  )?.id

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeWorkspaceId ? [activeWorkspaceId] : [])
  )

  // Auto-expand when navigating to a campaign
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

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const displayName = userName || userEmail

  return (
    <aside className="w-60 shrink-0 bg-gray-900 flex flex-col h-full select-none">

      {/* ── Org header ───────────────────────────────── */}
      <div className="px-3 pt-4 pb-3 border-b border-gray-800">
        <Link
          href={`${base}/dashboard`}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-gray-800 transition group"
        >
          <div className="w-6 h-6 rounded-md bg-indigo-500 flex items-center justify-center shrink-0">
            <span className="text-white text-[10px] font-bold">{orgName.charAt(0).toUpperCase()}</span>
          </div>
          <span className="text-gray-100 font-semibold text-sm truncate flex-1 text-left">{orgName}</span>
          <ChevronDown className="w-3.5 h-3.5 text-gray-600 shrink-0" />
        </Link>
      </div>

      {/* ── Scrollable body ──────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-3 space-y-1">

        {/* Espaços / Workspaces */}
        <div>
          <div className="flex items-center justify-between px-4 mb-1.5">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              Espaços
            </span>
            <div className="flex items-center gap-1">
              {allExpanded ? (
                <button
                  onClick={collapseAll}
                  className="text-gray-600 hover:text-gray-300 transition"
                  title="Fechar todos"
                >
                  <ChevronsUp className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={expandAll}
                  className="text-gray-600 hover:text-gray-300 transition"
                  title="Expandir todos"
                >
                  <ChevronsDown className="w-3.5 h-3.5" />
                </button>
              )}
              <Link
                href={`${base}/workspaces/new`}
                className="text-gray-600 hover:text-gray-300 transition"
                title="Novo cliente"
              >
                <Plus className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Todas as atividades — link para lista geral */}
          <Link
            href={`${base}/views/lista`}
            className={cn(
              'flex items-center gap-2 mx-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors mb-1',
              pathname === `${base}/views/lista`
                ? 'bg-gray-800/60 text-gray-100'
                : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800/40'
            )}
          >
            <List className="w-3.5 h-3.5 shrink-0 opacity-60" />
            <span className="truncate">{orgName}</span>
          </Link>

          <div className="space-y-px">
            {workspaces.map(ws => {
              const isOpen = expanded.has(ws.id)
              const isWsActive = pathname.includes(`/workspaces/${ws.id}`)

              return (
                <div key={ws.id}>
                  {/* Workspace row */}
                  <div className="group flex items-center px-2">
                    {/* Chevron — só toggle, não navega */}
                    <button
                      onClick={() => toggle(ws.id)}
                      className="p-1.5 rounded text-gray-600 hover:text-gray-300 transition-colors shrink-0"
                    >
                      <ChevronRight className={cn(
                        'w-3 h-3 transition-transform duration-150',
                        isOpen && 'rotate-90'
                      )} />
                    </button>
                    {/* Nome — navega E expande */}
                    <Link
                      href={`${base}/workspaces/${ws.id}`}
                      onClick={() => !isOpen && toggle(ws.id)}
                      className={cn(
                        'flex items-center gap-1.5 flex-1 min-w-0 px-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        isWsActive && !pathname.includes('/campaigns/')
                          ? 'bg-gray-800/60 text-gray-100'
                          : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
                      )}
                    >
                      <span
                        className="w-2 h-2 rounded-sm shrink-0"
                        style={{ backgroundColor: ws.color || '#6366f1' }}
                      />
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

                  {/* Campaigns */}
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
                              'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors',
                              isActive
                                ? 'bg-indigo-600/20 text-indigo-300'
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
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 hover:text-gray-400 transition rounded-lg"
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
                className="flex items-center gap-1.5 mx-4 px-2 py-1.5 text-xs text-gray-600 hover:text-gray-400 transition rounded-lg"
              >
                <Plus className="w-3 h-3" />
                Novo cliente
              </Link>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="mx-3 border-t border-gray-800/80" />

        {/* Views */}
        <div className="px-2 space-y-px">
          {VIEWS.map(({ href, label, icon: Icon }) => {
            const full = `${base}/${href}`
            const isActive = pathname.startsWith(full)
            return (
              <Link
                key={href}
                href={full}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            )
          })}
        </div>
      </div>

      {/* ── Bottom ───────────────────────────────────── */}
      <div className="border-t border-gray-800">
        <Link
          href={`${base}/settings/membros`}
          className={cn(
            'flex items-center gap-2.5 px-5 py-2.5 text-sm transition-colors',
            pathname.startsWith(`${base}/settings`)
              ? 'text-white'
              : 'text-gray-500 hover:text-gray-200'
          )}
        >
          <Settings className="w-4 h-4 shrink-0" />
          Configurações
        </Link>

        <div className="flex items-center gap-2.5 px-4 py-3 border-t border-gray-800">
          {userAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={userAvatar} alt="" className="w-6 h-6 rounded-full shrink-0 object-cover" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
              <span className="text-gray-300 text-[10px]">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <span className="text-gray-400 text-xs truncate flex-1">{displayName}</span>
          <button
            onClick={signOut}
            className="text-gray-600 hover:text-gray-300 transition-colors"
            title="Sair"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}
