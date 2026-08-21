import { assertRhAccess } from '@/lib/rh'
import { PainelClient } from './PainelClient'

export const dynamic = 'force-dynamic'

export default async function PainelRhPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ meses?: string; ate?: string }>
}) {
  const { orgSlug } = await params
  const { meses, ate } = await searchParams
  const { supabase, orgId } = await assertRhAccess(orgSlug)
  const n = Math.min(36, Math.max(1, Number(meses) || 12))
  // `ate` = último mês do período (YYYY-MM). Ausente ou no futuro = mês corrente.
  const hoje = new Date()
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
  const ateOk = ate && /^\d{4}-(0[1-9]|1[0-2])$/.test(ate) && ate < mesAtual ? ate : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('rh_dashboard', {
    p_org: orgId, p_meses: n, ...(ateOk ? { p_ate: `${ateOk}-01` } : {}),
  })

  return <PainelClient orgSlug={orgSlug} meses={n} ate={ateOk} d={data} />
}
