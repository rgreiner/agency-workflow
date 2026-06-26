'use client'

import { createContext, useContext } from 'react'
import type { StatusOverride } from '@/types'

export interface OrgSettings {
  orgId:           string
  logoUrl:         string | null
  accentColor:     string
  statusOverrides: StatusOverride[]
}

const OrgSettingsContext = createContext<OrgSettings>({
  orgId:           '',
  logoUrl:         null,
  accentColor:     '#f97316',
  statusOverrides: [],
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
