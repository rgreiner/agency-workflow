import { assertRhAccess } from '@/lib/rh'
import { FeriasClient, type FeriasGozo } from './FeriasClient'
import type {
  PeriodoFerias, LinhaDecimo, SaldoAno, PonteLinha, LancamentoFerias,
} from '@/app/actions/rh-ferias'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Férias e 13º — Flow' }

export default async function FeriasPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ ano?: string }>
}) {
  const { orgSlug } = await params
  const { ano: anoQS } = await searchParams
  const { supabase, orgId } = await assertRhAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const anoAtual = new Date().getFullYear()
  const ano = Number(anoQS) || anoAtual

  // Marco de quitação pré-Flow (mig. 274) — some junto com os períodos.
  const { data: cfgFerias } = await sb.from('org_settings')
    .select('ferias_quitadas_ate').eq('org_id', orgId).maybeSingle()

  const [perRes, decRes, gozoRes, saldoRes, ponteRes, lancRes] = await Promise.all([
    sb.rpc('rh_ferias_periodos', { p_org: orgId }),
    sb.rpc('rh_decimo_terceiro', { p_org: orgId, p_ano: ano }),
    sb.from('rh_ferias')
      .select('id, colaborador_id, periodo_inicio, inicio, fim, dias, abono_dias, status, observacao')
      .eq('org_id', orgId).order('inicio', { ascending: false }),
    sb.rpc('rh_ferias_saldo_ano', { p_org: orgId, p_ano: ano }),
    sb.rpc('rh_ferias_pontes', { p_org: orgId, p_ano: ano }),
    sb.from('rh_ferias_lancamento')
      .select('id, colaborador_id, inicio, fim, dias, tipo, motivo')
      .eq('org_id', orgId)
      .gte('inicio', `${ano}-01-01`).lte('inicio', `${ano}-12-31`)
      .order('inicio', { ascending: false }),
  ])

  return (
    <FeriasClient
      orgSlug={orgSlug}
      periodos={(perRes.data ?? []) as PeriodoFerias[]}
      decimo={(decRes.data ?? []) as LinhaDecimo[]}
      gozos={(gozoRes.data ?? []) as FeriasGozo[]}
      saldos={(saldoRes.data ?? []) as SaldoAno[]}
      pontes={(ponteRes.data ?? []) as PonteLinha[]}
      lancamentos={(lancRes.data ?? []) as LancamentoFerias[]}
      feriasMarco={(cfgFerias?.ferias_quitadas_ate as string | null) ?? null}
      ano={ano}
      anoAtual={anoAtual}
      erro={(saldoRes.error?.message ?? perRes.error?.message ?? decRes.error?.message ?? null) as string | null}
    />
  )
}
