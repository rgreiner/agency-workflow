'use client'

import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { gravarPref, PREF_COOKIES, type SidebarPrefs } from '@/lib/sidebar-prefs'

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
  /** Preferências da casca lidas do cookie no servidor. */
  prefs: SidebarPrefs
  children: React.ReactNode
}

/**
 * Casca do app: detém o estado de colapso da sidebar (persistido). Sem barra
 * superior — navegação, busca e notificações vivem na Sidebar; quando recolhida,
 * a própria Sidebar mostra um botão flutuante para reabrir.
 */
export function AppShell({
  orgSlug, orgName, userEmail, userAvatar, userName, workspaces, logoUrl, accentColor, positionName, canMidias, canMidiaHub, canProducao, canFinance, canCadastros, canRh, canManage, canListaGlobal, onboardingPendente, midiaTransicao, prefs, children,
}: Props) {
  // Recolhida: vem do cookie lido no servidor, então o HTML já chega recolhido.
  // Antes o localStorage era lido depois do paint e a sidebar "pulava" 240px.
  const [collapsed, setCollapsedState] = useState(prefs.recolhida ?? false)

  function setCollapsed(v: boolean) {
    setCollapsedState(v)
    gravarPref(PREF_COOKIES.recolhida, v ? '1' : '0')
  }

  // h-dvh: no Safari do celular a barra do navegador comia o rodapé do drawer com h-screen.
  return (
    <div className="flex h-dvh overflow-hidden bg-gray-50">
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
        prefs={prefs}
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
