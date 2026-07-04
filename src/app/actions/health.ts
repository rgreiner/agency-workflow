'use server'

import { regenerarPastaDrive } from '@/app/actions/activity'
import type { HealthFix } from '@/lib/health/checks'

/**
 * Aplica a correção de um item de verificação. Ponto único de despacho: a UI só
 * conhece o `HealthFix`; aqui mapeamos cada `kind` pra ação real. Novos checks
 * com correção entram adicionando um `case`.
 */
export async function applyHealthFix(orgSlug: string, fix: HealthFix): Promise<{ error?: string; ok?: boolean }> {
  const path = `/${orgSlug}/settings/saude`
  switch (fix.kind) {
    case 'provision-drive': {
      const res = await regenerarPastaDrive(orgSlug, path, fix.activityId)
      if (res?.error) return { error: res.error }
      return { ok: true }
    }
    default:
      return { error: 'Correção desconhecida.' }
  }
}
