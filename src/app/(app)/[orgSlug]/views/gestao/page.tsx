import { assertManageAccess } from '@/lib/finance'
import { GestaoClient, type GestaoData, type EngajamentoData } from './GestaoClient'

export const metadata = { title: 'Gestão — Flow' }

export default async function GestaoPage({
  params, searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ ws?: string; dias?: string; aba?: string }>
}) {
  const { orgSlug } = await params
  const sp = await searchParams
  const { supabase, orgId, userId } = await assertManageAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const wsFilter = (sp.ws ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const dias = Math.min(Math.max(parseInt(sp.dias ?? '84', 10) || 84, 7), 372)

  const [{ data: workspacesRaw }, gestaoRes, engajaRes] = await Promise.all([
    sb.from('workspaces').select('id, name').eq('org_id', orgId).eq('archived', false).order('name'),
    sb.rpc('dashboard_gestao', { p_user_id: userId, p_org_id: orgId, p_ws: wsFilter.length ? wsFilter : null }),
    sb.rpc('dashboard_engajamento', { p_user_id: userId, p_org_id: orgId, p_days: dias }),
  ])

  const workspaces = (workspacesRaw ?? []) as { id: string; name: string }[]
  const gestao = (gestaoRes.data ?? null) as GestaoData | null
  const engajamento = (engajaRes.data ?? null) as EngajamentoData | null

  return (
    <GestaoClient
      orgSlug={orgSlug}
      workspaces={workspaces}
      wsFilter={wsFilter}
      dias={dias}
      aba={sp.aba === 'engajamento' ? 'engajamento' : 'operacao'}
      gestao={gestao}
      engajamento={engajamento}
    />
  )
}
