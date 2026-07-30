'use client'

import { createContext, useContext } from 'react'
import type { StatusOverride, OrgStatusRow } from '@/types'

export interface OrgSettings {
  orgId:           string
  logoUrl:         string | null
  accentColor:     string
  /** Legado: sobreposição de label/cor sobre a lista fixa. Mantido p/ org sem cadastro. */
  statusOverrides: StatusOverride[]
  /** Cadastro de status da org (migration 168) — quando existe, é a lista completa. */
  statuses:        OrgStatusRow[]
}

const OrgSettingsContext = createContext<OrgSettings>({
  orgId:           '',
  logoUrl:         null,
  accentColor:     '#f97316',
  statusOverrides: [],
  statuses:        [],
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
