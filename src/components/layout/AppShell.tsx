'use client'

import { useState, useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { TopNav } from './TopNav'

interface WorkspaceItem {
  id: string
  name: string
  color: string
  campaigns: { id: string; name: string }[]
}

interface Props {
  orgSlug: string
  orgName: string
  userEmail: string
  userAvatar?: string | null
  userName?: string | null
  workspaces: WorkspaceItem[]
  logoUrl?: string | null
  accentColor?: string
  /** Nome do cargo do usuário — rótulo da aba de trabalho no menu superior. */
  positionName?: string | null
  children: React.ReactNode
}

/**
 * Casca do app: detém o estado de colapso da sidebar (persistido) e o compartilha
 * entre Sidebar e TopNav — assim o botão de expandir vive no TopNav, sem flutuar
 * sobre o conteúdo.
 */
export function AppShell({
  orgSlug, orgName, userEmail, userAvatar, userName, workspaces, logoUrl, accentColor, positionName, children,
}: Props) {
  const [collapsed, setCollapsedState] = useState(false)

  useEffect(() => {
    try { setCollapsedState(localStorage.getItem('sidebar-collapsed') === '1') } catch {}
  }, [])

  function setCollapsed(v: boolean) {
    setCollapsedState(v)
    try { localStorage.setItem('sidebar-collapsed', v ? '1' : '0') } catch {}
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar
        orgSlug={orgSlug}
        orgName={orgName}
        userEmail={userEmail}
        userAvatar={userAvatar}
        userName={userName}
        workspaces={workspaces}
        logoUrl={logoUrl}
        accentColor={accentColor}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(true)}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopNav
          orgSlug={orgSlug}
          orgName={orgName}
          workspaces={workspaces}
          accentColor={accentColor}
          positionName={positionName}
          collapsed={collapsed}
          onExpand={() => setCollapsed(false)}
        />
        <main className="flex-1 overflow-y-auto min-w-0">
          <div className="pt-12 md:pt-0 h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
