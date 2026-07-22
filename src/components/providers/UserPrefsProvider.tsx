'use client'

import { createContext, useContext } from 'react'

export interface UserPrefs {
  orgSlug: string
  /** profiles.drive_mac_user — usuário do Mac (diretório em /Users). */
  driveMacUser: string | null
  /** profiles.drive_google_email — e-mail da conta Google do Drive Desktop. */
  driveGoogleEmail: string | null
  /** profiles.drive_lang — 'pt' | 'en': idioma que o Drive Desktop usa na raiz das pastas. */
  driveLang: string | null
}

const Ctx = createContext<UserPrefs>({ orgSlug: '', driveMacUser: null, driveGoogleEmail: null, driveLang: 'pt' })

export function UserPrefsProvider({ value, children }: { value: UserPrefs; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useUserPrefs(): UserPrefs {
  return useContext(Ctx)
}
