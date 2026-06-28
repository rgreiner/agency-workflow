import { assertFinanceAccess } from '@/lib/finance'
import { formatBRL } from '@/lib/midia'
import { ArrowDownCircle, ArrowUpCircle, Landmark } from 'lucide-react'

interface LancRow {
  tipo: string
  situacao: string
  valor: number | string
  valor_realizado: number | string | null
  vencimento: string | null
  data_liquidacao: string | null
  conta_id: string | null
}
interface ContaRow { id: string; nome: string; cor: string | null; saldo_inicial: number | string; ativo: boolean }

const isPago = (s: string) => s === 'pago' || s === 'recebido'
const val = (l: LancRow) => Number(l.valor ?? 0)
const realVal = (l: LancRow) => Number(l.valor_realizado ?? l.valor ?? 0)
const monthOf = (d: string | null) => (d ? d.slice(0, 7) : null)
const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function lastMonths(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export default async function PainelPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [{ data: lancRaw }, { data: contasRaw }] = await Promise.all([
    sb.from('lancamentos')
      .select('tipo, situacao, valor, valor_realizado, vencimento, data_liquidacao, conta_id')
      .eq('org_id', orgId),
    sb.from('contas_financeiras')
      .select('id, nome, cor, saldo_inicial, ativo')
      .eq('org_id', orgId).order('ordem', { ascending: true }),
  ])

  const lanc = (lancRaw ?? []) as LancRow[]
  const contas = ((contasRaw ?? []) as ContaRow[]).filter(c => c.ativo)
  const today = new Date().toISOString().slice(0, 10)
  const mes = today.slice(0, 7)

  const aberto = lanc.filter(l => !isPago(l.situacao) && l.vencimento)
  const sum = (arr: LancRow[]) => arr.reduce((s, l) => s + val(l), 0)
  const grp = (tipo: string) => {
    const t = aberto.filter(l => l.tipo === tipo)
    return {
      vencido: sum(t.filter(l => l.vencimento! < today)),
      hoje: sum(t.filter(l => l.vencimento === today)),
      restanteMes: sum(t.filter(l => l.vencimento! > today && monthOf(l.vencimento) === mes)),
    }
  }
  const receber = grp('entrada')
  const pagar = grp('saida')

  // Posição das contas: saldo_inicial + realizados (recebido − pago) por conta.
  const saldoConta = (id: string) => {
    const real = lanc.filter(l => isPago(l.situacao) && l.conta_id === id)
    const ent = real.filter(l => l.tipo === 'entrada').reduce((s, l) => s + realVal(l), 0)
    const sai = real.filter(l => l.tipo === 'saida').reduce((s, l) => s + realVal(l), 0)
    return ent - sai
  }
  const contasComSaldo = contas.map(c => ({
    ...c,
    saldo: Number(c.saldo_inicial ?? 0) + saldoConta(c.id),
  }))
  const saldoTotal = contasComSaldo.reduce((s, c) => s + c.saldo, 0)

  // Faturamento (recebido) — últimos 6 meses por mês de liquidação.
  const meses = lastMonths(mes, 6)
  const faturamento = meses.map(ym => ({
    ym,
    label: MESES_ABREV[Number(ym.split('-')[1]) - 1],
    valor: lanc
      .filter(l => l.tipo === 'entrada' && isPago(l.situacao) && monthOf(l.data_liquidacao ?? l.vencimento) === ym)
      .reduce((s, l) => s + realVal(l), 0),
  }))
  const fatMax = Math.max(1, ...faturamento.map(f => f.valor))

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Painel financeiro</h1>
        <p className="text-gray-500 text-sm mt-0.5">Visão geral — vencimentos, contas e faturamento</p>
      </div>

      {/* A receber / A pagar */}
      <div className="grid md:grid-cols-2 gap-4">
        <FluxoCard titulo="A receber" tone="emerald" icon={<ArrowDownCircle className="w-4 h-4" />} g={receber} />
        <FluxoCard titulo="A pagar" tone="red" icon={<ArrowUpCircle className="w-4 h-4" />} g={pagar} />
      </div>

      {/* Posição das contas */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2"><Landmark className="w-4 h-4 text-gray-400" /> Posição das contas</h2>
          <div className="text-right">
            <p className="text-[11px] text-gray-400">Saldo total</p>
            <p className={`text-lg font-semibold ${saldoTotal >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{formatBRL(saldoTotal)}</p>
          </div>
        </div>
        {contasComSaldo.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhuma conta cadastrada. Crie em Financeiro → Contas.</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {contasComSaldo.map(c => (
              <li key={c.id} className="flex items-center justify-between py-2.5">
                <span className="inline-flex items-center gap-2.5 text-sm text-gray-700">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.cor ?? '#cbd5e1' }} />
                  {c.nome}
                </span>
                <span className={`text-sm font-medium ${c.saldo >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{formatBRL(c.saldo)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Faturamento últimos meses */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Faturamento recebido — últimos 6 meses</h2>
        <div className="flex items-end justify-between gap-3 h-44">
          {faturamento.map(f => (
            <div key={f.ym} className="flex-1 flex flex-col items-center justify-end gap-2 h-full">
              <span className="text-[11px] font-medium text-gray-600">{f.valor > 0 ? formatBRL(f.valor) : ''}</span>
              <div className="w-full rounded-t-lg bg-orange-500/90"
                style={{ height: `${Math.max((f.valor / fatMax) * 100, f.valor > 0 ? 4 : 0)}%` }} />
              <span className="text-xs text-gray-400">{f.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function FluxoCard({ titulo, tone, icon, g }: {
  titulo: string; tone: 'emerald' | 'red'; icon: React.ReactNode
  g: { vencido: number; hoje: number; restanteMes: number }
}) {
  const accent = tone === 'emerald' ? 'text-emerald-600' : 'text-red-600'
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h2 className={`text-sm font-semibold inline-flex items-center gap-2 mb-4 ${accent}`}>{icon} {titulo}</h2>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] text-gray-400 mb-1">Vencido</p>
          <p className={`text-base font-semibold ${g.vencido > 0 ? accent : 'text-gray-400'}`}>{formatBRL(g.vencido)}</p>
        </div>
        <div>
          <p className="text-[11px] text-gray-400 mb-1">Vence hoje</p>
          <p className="text-base font-semibold text-gray-900">{formatBRL(g.hoje)}</p>
        </div>
        <div>
          <p className="text-[11px] text-gray-400 mb-1">Restante do mês</p>
          <p className="text-base font-semibold text-gray-700">{formatBRL(g.restanteMes)}</p>
        </div>
      </div>
    </div>
  )
}
