'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { List, GanttChart, Users, BookOpen, PenTool, Search } from 'lucide-react'
import { CommandPalette } from './CommandPalette'
import { NotificationsBell } from './NotificationsBell'

interface Workspace {
  id: string
  name: string
  campaigns: { id: string; name: string }[]
}

interface Props {
  orgSlug: string
  orgName: string
  workspaces: Workspace[]
  accentColor?: string
}

const VIEWS = [
  { id: 'lista',       label: 'Lista',       icon: List,       href: 'views/lista' },
  { id: 'gantt',       label: 'Gantt',       icon: GanttChart, href: 'views/gantt' },
  { id: 'atendimento', label: 'Atendimento', icon: Users,      href: 'views/atendimento' },
  { id: 'docs',        label: 'Documentos',  icon: BookOpen,   href: 'docs' },
  { id: 'boards',      label: 'Quadros',     icon: PenTool,    href: 'boards' },
]

export function TopNav({ orgSlug, orgName, workspaces, accentColor = '#6366f1' }: Props) {
  const pathname = usePathname()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const base = `/${orgSlug}`

  // SSR sempre renderiza 'Ctrl K'; suppressHydrationWarning no <kbd> cobre o ajuste no Mac
  const shortcutLabel =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')
      ? '⌘K'
      : 'Ctrl K'

  // Atalho global ⌘K / Ctrl+K
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

  // Detect workspace and campaign from URL
  const wsMatch   = pathname.match(/\/workspaces\/([^/]+)/)
  const campMatch = pathname.match(/\/campaigns\/([^/]+)/)

  const currentWs   = wsMatch   ? workspaces.find(w => w.id === wsMatch[1])   : null
  const currentCamp = campMatch && currentWs
    ? currentWs.campaigns.find(c => c.id === campMatch[1])
    : null

  function viewHref(viewPath: string) {
    const full = `${base}/${viewPath}`
    if (currentWs) return `${full}?ws=${currentWs.id}`
    return full
  }

  function isActive(viewPath: string) {
    return pathname.startsWith(`${base}/${viewPath}`)
  }

  const context = currentCamp
    ? `${currentWs?.name} › ${currentCamp.name}`
    : currentWs
    ? currentWs.name
    : orgName

  return (
    <>
      <div className="h-11 bg-white border-b border-gray-200 flex items-center px-3 md:px-5 gap-3 shrink-0 z-10">
        {/* Context label — hidden on small screens (hamburger occupies that space) */}
        <span className="hidden md:block text-sm font-semibold text-gray-700 truncate max-w-xs shrink-0">
          {context}
        </span>

        <div className="hidden md:block w-px h-4 bg-gray-200 shrink-0" />

        {/* View tabs — horizontally scrollable on mobile */}
        <nav className="flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1 min-w-0 pl-10 md:pl-0">
          {VIEWS.map(({ id, label, icon: Icon, href }) => (
            <Link
              key={id}
              href={viewHref(href)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0',
                isActive(href) ? '' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
              )}
              style={isActive(href) ? {
                backgroundColor: accentColor + '18',
                color: accentColor,
              } : undefined}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>

        {/* Notificações */}
        <NotificationsBell orgSlug={orgSlug} />

        {/* Search trigger */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0 border border-transparent hover:border-gray-200"
          title="Busca rápida"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Buscar</span>
          <kbd
            suppressHydrationWarning
            className="hidden lg:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium text-gray-400 bg-gray-50 border border-gray-200 rounded"
          >
            {shortcutLabel}
          </kbd>
        </button>
      </div>

      <CommandPalette
        orgSlug={orgSlug}
        workspaces={workspaces}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </>
  )
}
