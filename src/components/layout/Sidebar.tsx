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
  Settings,
  LogOut,
  Plus,
  AlignLeft,
  Menu,
  X,
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
  logoUrl?: string | null
  accentColor?: string
}

export function Sidebar({
  orgSlug, orgName, userEmail, userAvatar, userName, workspaces, logoUrl, accentColor = '#6366f1',
}: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const base = `/${orgSlug}`

  const [mobileOpen, setMobileOpen] = useState(false)

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

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const displayName = userName || userEmail

  const sidebarContent = (
    <aside className="w-60 bg-gray-900 flex flex-col h-full select-none">

      {/* ── Org header ───────────────────────────────── */}
      <div className="px-3 pt-4 pb-3 border-b border-gray-800 flex items-center gap-1">
        <Link
          href={`${base}/dashboard`}
          className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded-lg hover:bg-gray-800 transition group"
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={orgName} className="w-6 h-6 rounded-md object-contain shrink-0 bg-white" />
          ) : (
            <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: accentColor }}>
              <span className="text-white text-[10px] font-bold">{orgName.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <span className="text-gray-100 font-semibold text-sm truncate flex-1 text-left">{orgName}</span>
          <ChevronDown className="w-3.5 h-3.5 text-gray-600 shrink-0" />
        </Link>
        {/* Close — mobile only */}
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden p-1.5 text-gray-600 hover:text-gray-300 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Scrollable body ──────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-3 space-y-1">

        {/* Espaços */}
        <div>
          <div className="flex items-center justify-between px-4 mb-1.5">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              Espaços
            </span>
            <div className="flex items-center gap-1">
              {allExpanded ? (
                <button onClick={collapseAll} className="text-gray-600 hover:text-gray-300 transition" title="Fechar todos">
                  <ChevronsUp className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button onClick={expandAll} className="text-gray-600 hover:text-gray-300 transition" title="Expandir todos">
                  <ChevronsDown className="w-3.5 h-3.5" />
                </button>
              )}
              <Link href={`${base}/workspaces/new`} className="text-gray-600 hover:text-gray-300 transition" title="Novo cliente">
                <Plus className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          <div className="space-y-px">
            {workspaces.map(ws => {
              const isOpen = expanded.has(ws.id)
              const isWsActive = pathname.includes(`/workspaces/${ws.id}`)

              return (
                <div key={ws.id}>
                  <div className="group flex items-center px-2">
                    <button
                      onClick={() => toggle(ws.id)}
                      className="p-1.5 rounded text-gray-600 hover:text-gray-300 transition-colors shrink-0"
                    >
                      <ChevronRight className={cn('w-3 h-3 transition-transform duration-150', isOpen && 'rotate-90')} />
                    </button>
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
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: ws.color || '#6366f1' }} />
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
            <span className="text-gray-400 text-xs truncate group-hover:text-gray-200 transition-colors">{displayName}</span>
          </Link>
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
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}>
        {sidebarContent}
      </div>
    </>
  )
}
