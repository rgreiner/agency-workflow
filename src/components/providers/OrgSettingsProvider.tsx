'use client'

import { createContext, useContext } from 'react'
import type { StatusOverride, OrgStatusRow } from '@/types'
import { PAUTA_LISTAS_PADRAO, type PautaListas } from '@/lib/atividade-titulo'

export interface OrgSettings {
  orgId:           string
  logoUrl:         string | null
  accentColor:     string
  /** Legado: sobreposição de label/cor sobre a lista fixa. Mantido p/ org sem cadastro. */
  statusOverrides: StatusOverride[]
  /** Cadastro de status da org (migration 168) — quando existe, é a lista completa. */
  statuses:        OrgStatusRow[]
  /**
   * Sugestões que compõem o título da pauta (migration 285): veículo, formato e
   * objetivo. Vem pronta em lista porque quem consome — o form de nova atividade
   * e o modal de entrega da mídia — só quer os rótulos, na ordem do cadastro.
   */
  pauta:           PautaListas
}

const OrgSettingsContext = createContext<OrgSettings>({
  orgId:           '',
  logoUrl:         null,
  accentColor:     '#ff6a00',
  statusOverrides: [],
  statuses:        [],
  pauta:           PAUTA_LISTAS_PADRAO,
})

export function OrgSettingsProvider({
  children,
  settings,
}: {
  children: React.ReactNode
  settings: OrgSettings
}) {
  return (
    <OrgSettingsContext.Provider value={settings}>
      {children}
    </OrgSettingsContext.Provider>
  )
}

export function useOrgSettings() {
  return useContext(OrgSettingsContext)
}
