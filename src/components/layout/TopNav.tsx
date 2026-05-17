'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { List, GanttChart, Users, BookOpen } from 'lucide-react'

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
]

export function TopNav({ orgSlug, orgName, workspaces, accentColor = '#6366f1' }: Props) {
  const pathname = usePathname()
  const base = `/${orgSlug}`

  // Detect workspace and campaign from URL
  const wsMatch   = pathname.match(/\/workspaces\/([^/]+)/)
  const campMatch = pathname.match(/\/campaigns\/([^/]+)/)

  const currentWs   = wsMatch   ? workspaces.find(w => w.id === wsMatch[1])   : null
  const currentCamp = campMatch && currentWs
    ? currentWs.campaigns.find(c => c.id === campMatch[1])
    : null

  // Build view href with context query param
  function viewHref(viewPath: string) {
    const full = `${base}/${viewPath}`
    if (currentWs) return `${full}?ws=${currentWs.id}`
    return full
  }

  function isActive(viewPath: string) {
    return pathname.startsWith(`${base}/${viewPath}`)
  }

  // Context breadcrumb
  const context = currentCamp
    ? `${currentWs?.name} › ${currentCamp.name}`
    : currentWs
    ? currentWs.name
    : orgName

  return (
    <div className="h-11 bg-white border-b border-gray-200 flex items-center px-5 gap-4 shrink-0 z-10">
      {/* Context label */}
      <span className="text-sm font-semibold text-gray-700 truncate max-w-xs shrink-0">
        {context}
      </span>

      <div className="w-px h-4 bg-gray-200 shrink-0" />

      {/* View tabs */}
      <nav className="flex items-center gap-0.5">
        {VIEWS.map(({ id, label, icon: Icon, href }) => (
          <Link
            key={id}
            href={viewHref(href)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
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
    </div>
  )
}
