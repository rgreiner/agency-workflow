import { createClient } from '@/lib/supabase/server'
import { unwrap } from '@/lib/supabase/unwrap'
import { ContasClient, type Conta } from './ContasClient'
import { BtgCard } from './BtgCard'
import { btgConfigured, btgEnv } from '@/lib/btg/config'
import { getBtgConnection } from '@/lib/btg/store'

export default async function ContasPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const resContas = await sb
    .from('contas_saldo')
    .select('id, nome, tipo, saldo_inicial, saldo_atual, cor, ativo, ordem, favorita')
    .eq('org_id', org.id)
    .order('ordem', { ascending: true })
    .order('nome', { ascending: true })

  // Ciclo do cartão e faturas abertas vêm de fora da view `contas_saldo`: recriar
  // uma view é onde já nasceu o P0 da 181 (o `create or replace` zera o
  // security_invoker). Duas leituras baratas custam menos que esse risco.
  const [resCiclo, resFaturas, resPendentes] = await Promise.all([
    sb.from('contas_financeiras').select('id, fechamento_dia, vencimento_dia, limite').eq('org_id', org.id),
    sb.from('cartao_faturas').select('conta_id, vence, total, compras').eq('org_id', org.id).order('vence'),
    // Movimento do banco esperando conciliação. Mesma régua da fila
    // (`loadConciliacao`): status 'pendente'. Se divergir dela, o cartão vira
    // uma promessa que a tela seguinte não cumpre.
    sb.from('btg_movements').select('conta_id, data_mov').eq('org_id', org.id).eq('status', 'pendente'),
  ])

  interface PendRow { conta_id: string | null; data_mov: string }
  const pend = new Map<string, { n: number; maisAntigo: string }>()
  for (const m of ((resPendentes?.data ?? []) as PendRow[])) {
    if (!m.conta_id) continue
    const a = pend.get(m.conta_id)
    if (!a) pend.set(m.conta_id, { n: 1, maisAntigo: m.data_mov })
    else pend.set(m.conta_id, { n: a.n + 1, maisAntigo: m.data_mov < a.maisAntigo ? m.data_mov : a.maisAntigo })
  }

  interface CicloRow { id: string; fechamento_dia: number | null; vencimento_dia: number | null; limite: number | string | null }
  const ciclo = new Map<string, CicloRow>(((resCiclo?.data ?? []) as CicloRow[]).map(c => [c.id, c]))

  interface FaturaRow { conta_id: string; vence: string; total: number | string; compras: number }
  const faturas = new Map<string, Conta['faturas']>()
  for (const f of ((resFaturas?.data ?? []) as FaturaRow[])) {
    const arr = faturas.get(f.conta_id) ?? []
    arr.push({ vence: f.vence, total: Number(f.total ?? 0), compras: f.compras })
    faturas.set(f.conta_id, arr)
  }

  const contas = unwrap<Conta>(resContas, 'contas').map(c => ({
    ...c,
    conciliar: pend.get(c.id)?.n ?? 0,
    conciliarDesde: pend.get(c.id)?.maisAntigo ?? null,
    // Calculado aqui e não no card: "hoje" durante o render do client é função
    // impura — o mesmo card poderia se pintar diferente entre dois renders.
    conciliarAtrasada: (() => {
      const d = pend.get(c.id)?.maisAntigo
      return !!d && (Date.now() - new Date(`${d}T12:00:00`).getTime()) > 15 * 86_400_000
    })(),
    fechamentoDia: ciclo.get(c.id)?.fechamento_dia ?? null,
    vencimentoDia: ciclo.get(c.id)?.vencimento_dia ?? null,
    limite: ciclo.get(c.id)?.limite != null ? Number(ciclo.get(c.id)!.limite) : null,
    faturas: faturas.get(c.id) ?? [],
  }))

  const conn = await getBtgConnection(org.id)
  const btg = {
    configured: btgConfigured(),
    env: btgEnv(),
    connected: !!conn?.refreshToken && conn.status !== 'revoked',
    status: conn?.status ?? null,
    companyId: conn?.companyId ?? null,
    accountId: conn?.accountId ?? null,
    lastSyncAt: conn?.lastSyncAt ?? null,
    lastError: conn?.lastError ?? null,
  }

  // A integração mora dentro da conta que ela alimenta (migration 128). Aqui ela só
  // aparece enquanto NÃO estiver vinculada a nenhuma — senão ficaria inalcançável.
  const orfa = !conn?.contaId

  return (
    <>
      <ContasClient orgSlug={orgSlug} contas={contas} />
      {orfa && (
        <div className="px-6 pb-8 -mt-2">
          <p className="text-xs text-gray-400 mb-2">
            Integração sem conta vinculada — assim que apontar pra uma conta, ela passa a aparecer dentro dela.
          </p>
          <BtgCard orgSlug={orgSlug} btg={btg} />
        </div>
      )}
    </>
  )
}
