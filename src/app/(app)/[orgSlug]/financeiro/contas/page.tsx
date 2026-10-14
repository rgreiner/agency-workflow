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
  const [resCiclo, resFaturas, resPendentes, resOfx] = await Promise.all([
    sb.from('contas_financeiras').select('id, fechamento_dia, vencimento_dia, limite').eq('org_id', org.id),
    sb.from('cartao_faturas').select('conta_id, vence, total, compras').eq('org_id', org.id).order('vence'),
    // Movimento do banco esperando conciliação. Mesma régua da fila
    // (`loadConciliacao`): status 'pendente'. Se divergir dela, o cartão vira
    // uma promessa que a tela seguinte não cumpre.
    sb.from('btg_movements').select('conta_id, data_mov').eq('org_id', org.id).eq('status', 'pendente'),
    // Último OFX de cada conta: até quando vai o extrato e QUANDO subiu.
    sb.from('ofx_arquivos').select('conta_id, periodo_fim, created_at').eq('org_id', org.id)
      .order('created_at', { ascending: false }).limit(500),
  ])

  // O aviso olha o DIA DA IMPORTAÇÃO, não o fim do extrato: o banco entrega o OFX
  // até ontem (medido: o de 07/10 cobria até 06/10), então pelo fim do extrato o
  // aviso nunca apagaria. Importou hoje = em dia. Dia no fuso de Brasília.
  const diaBR = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const hojeBR = diaBR(new Date().toISOString())
  interface OfxRow { conta_id: string | null; periodo_fim: string | null; created_at: string }
  const ofx = new Map<string, { ate: string | null; importadoEm: string }>()
  for (const o of ((resOfx?.data ?? []) as OfxRow[])) {
    if (!o.conta_id) continue
    const a = ofx.get(o.conta_id)
    if (!a) ofx.set(o.conta_id, { ate: o.periodo_fim, importadoEm: diaBR(o.created_at) })
    else if (o.periodo_fim && (!a.ate || o.periodo_fim > a.ate)) a.ate = o.periodo_fim
  }

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
    ofxAte: ofx.get(c.id)?.ate ?? null,
    ofxImportadoEm: ofx.get(c.id)?.importadoEm ?? null,
    ofxDesatualizado: !!ofx.get(c.id) && ofx.get(c.id)!.importadoEm !== hojeBR,
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
