import 'server-only'
import type { CronJob } from './jobs'
import { syncOrgMovements } from '@/lib/btg/sync'
import { listConnectedOrgIds, markBtgSynced, markBtgError } from '@/lib/btg/store'

/** Sincroniza o extrato do BTG de cada org conectada. 1x/dia, antes do digest. */
export const btgSyncJob: CronJob = {
  name: 'btg-sync',
  dailyAfterHour: 7,
  run: async ({ supabase, dry }) => {
    const orgIds = await listConnectedOrgIds()
    if (dry) return `${orgIds.length} org(s) conectada(s) ao BTG`
    if (orgIds.length === 0) return 'nenhuma org conectada'

    let ok = 0, fail = 0
    for (const orgId of orgIds) {
      try {
        await syncOrgMovements(supabase, orgId)
        await markBtgSynced(orgId)
        ok++
      } catch (e) {
        await markBtgError(orgId, e instanceof Error ? e.message : 'Falha no sync BTG')
        fail++
      }
    }
    return `${ok} org(s) sincronizada(s), ${fail} falha(s)`
  },
}
