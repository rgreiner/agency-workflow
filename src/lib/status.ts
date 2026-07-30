import 'server-only'
import { buildStatusConfig, getMergedStatusConfig, type StatusConfig, type OrgStatusRow, type StatusOverride } from '@/types'

/**
 * Config de status da org para server components (migration 168).
 * O cadastro (`org_status`) manda; a lista fixa do código só entra se a org não
 * tiver cadastro. No client, o equivalente é `useStatusConfig()`.
 */
export async function getStatusConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string | null | undefined,
  overrides: StatusOverride[] = [],
): Promise<StatusConfig[]> {
  if (!orgId) return getMergedStatusConfig(overrides)
  const { data } = await supabase
    .from('org_status')
    .select('valor, label, grupo, bg, txt, ordem, papel')
    .eq('org_id', orgId)
    .order('ordem') as { data: OrgStatusRow[] | null }
  return data?.length ? buildStatusConfig(data) : getMergedStatusConfig(overrides)
}
