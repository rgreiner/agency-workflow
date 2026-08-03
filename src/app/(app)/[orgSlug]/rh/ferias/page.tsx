import { assertRhAccess } from '@/lib/rh'
import { FeriasClient, type FeriasGozo } from './FeriasClient'
import type { PeriodoFerias, LinhaDecimo } from '@/app/actions/rh-ferias'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Férias e 13º — Flow' }

export default async function FeriasPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const ano = new Date().getFullYear()
  const [perRes, decRes, gozoRes] = await Promise.all([
    sb.rpc('rh_ferias_periodos', { p_org: orgId }),
    sb.rpc('rh_decimo_terceiro', { p_org: orgId, p_ano: ano }),
    sb.from('rh_ferias')
      .select('id, colaborador_id, periodo_inicio, inicio, fim, dias, abono_dias, status, observacao')
      .eq('org_id', orgId).order('inicio', { ascending: false }),
  ])

  return (
    <FeriasClient
      orgSlug={orgSlug}
      periodos={(perRes.data ?? []) as PeriodoFerias[]}
      decimo={(decRes.data ?? []) as LinhaDecimo[]}
      gozos={(gozoRes.data ?? []) as FeriasGozo[]}
      ano={ano}
      erro={(perRes.error?.message ?? decRes.error?.message ?? null) as string | null}
    />
  )
}
