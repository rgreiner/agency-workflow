'use client'

import { useState, useEffect } from 'react'
import { Sidebar } from './Sidebar'

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
  /** Permissão para ver "Liberação de mídias". */
  canMidias?: boolean
  canMidiaHub?: boolean
  /** Permissão para ver "Liberação de Produção". */
  canProducao?: boolean
  /** Permissão para ver/operar o grupo Financeiro. */
  canFinance?: boolean
  /** Permissão para ver Cadastros. */
  canCadastros?: boolean
  /** Permissão para ver o grupo RH (owner/admin ou can_rh). */
  canRh?: boolean
  /** Permissão de gestão (owner) — mostra o item "Gestão". */
  canManage?: boolean
  canListaGlobal?: boolean
  onboardingPendente?: number
  /** Pendências das telas transitórias da Mídia — 0 esconde o item. */
  midiaTransicao?: { migrar: number; vincular: number }
  children: React.ReactNode
}

/**
 * Casca do app: detém o estado de colapso da sidebar (persistido). Sem barra
 * superior — navegação, busca e notificações vivem na Sidebar; quando recolhida,
 * a própria Sidebar mostra um botão flutuante para reabrir.
 */
export function AppShell({
  orgSlug, orgName, userEmail, userAvatar, userName, workspaces, logoUrl, accentColor, positionName, canMidias, canMidiaHub, canProducao, canFinance, canCadastros, canRh, canManage, canListaGlobal, onboardingPendente, midiaTransicao, children,
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
        positionName={positionName}
        canMidias={canMidias}
        canMidiaHub={canMidiaHub}
        canProducao={canProducao}
        canFinance={canFinance}
        canCadastros={canCadastros}
        canRh={canRh}
        canManage={canManage}
        canListaGlobal={canListaGlobal}
        onboardingPendente={onboardingPendente}
        midiaTransicao={midiaTransicao}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(true)}
        onExpand={() => setCollapsed(false)}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto min-w-0">
          {/* Mobile: 3rem pro hambúrguer + safe-area (PWA iOS, conteúdo sob o notch). */}
          <div className="pt-[calc(env(safe-area-inset-top,0px)+3rem)] md:pt-0 h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
