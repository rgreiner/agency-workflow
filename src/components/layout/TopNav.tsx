'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Search, PanelLeft } from 'lucide-react'
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
  collapsed?: boolean
  onExpand?: () => void
}

/**
 * Barra superior enxuta: contexto (cliente › campanha) + notificações + busca.
 * A navegação de visões (Lista, Gantt, etc.) vive na Sidebar.
 */
export function TopNav({ orgSlug, orgName, workspaces, collapsed = false, onExpand }: Props) {
  const pathname = usePathname()
  const [paletteOpen, setPaletteOpen] = useState(false)

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

  const context = currentCamp
    ? `${currentWs?.name} › ${currentCamp.name}`
    : currentWs
    ? currentWs.name
    : orgName

  return (
    <>
      <div className="h-11 bg-white border-b border-gray-200 flex items-center px-3 md:px-5 gap-3 shrink-0 z-10">
        {/* Expandir menu — desktop, só quando a sidebar está retraída */}
        {collapsed && onExpand && (
          <button
            onClick={onExpand}
            title="Mostrar menu"
            aria-label="Mostrar menu"
            className="hidden md:flex items-center p-1.5 -ml-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition shrink-0"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        {/* Context label — pl-10 no mobile p/ não colidir com o hambúrguer fixo */}
        <span className="text-sm font-semibold text-gray-700 truncate min-w-0 pl-10 md:pl-0">
          {context}
        </span>

        <div className="flex-1" />

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
