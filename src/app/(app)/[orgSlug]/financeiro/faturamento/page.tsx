import { assertFinanceAccess } from '@/lib/finance'
import { formatBRL, FATURAMENTO_PAGADOR } from '@/lib/midia'
import { FaturamentoFeesTable } from './FaturamentoFeesTable'
import { FaturamentoMidiaTable, type MidiaView } from './FaturamentoMidiaTable'
import type { Anexo } from '@/app/actions/financeiro'
import { Receipt } from 'lucide-react'

// Duas datas (espelham gerar_lancamento_midia):
//  - vencimento do veículo/cliente = base DFM (fim do mês + N) ou data_base;
//  - previsto p/ agência = essa base + os dias da agência (é a data do lançamento).
function addDaysISO(iso: string, k: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10)
}
function lastDayOfMonthISO(iso: string): string {
  const [y, m] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}
function midiaVencimentoVeiculo(dataBase: string | null, prazo: string | null): string {
  if (!dataBase) return ''
  const dfm: Record<string, number> = { '10_dfm': 10, '15_dfm': 15, '20_dfm': 20, '30_dfm': 30 }
  return prazo && dfm[prazo] != null ? addDaysISO(lastDayOfMonthISO(dataBase), dfm[prazo]) : dataBase.slice(0, 10)
}

export default async function FaturamentoPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)

  // Mídias liberadas pro Financeiro (estado unificado 'faturar' = A Faturar).
  // Aceita 'faturado' legado ainda não lançado (a checagem de lançadas remove os já lançados).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: docsRaw } = await (supabase as any)
    .from('midias')
    .select('id, numero, serie, titulo, valor, desconto_pct, faturamento, prazo, data_base, dias_agencia, anexos, workspaces(name), veiculos(name)')
    .eq('org_id', orgId).in('situacao', ['faturar', 'faturado']).eq('archived', false)
    .order('numero', { ascending: false })

  // Quais já foram lançadas (têm lançamento)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lancRaw } = await (supabase as any)
    .from('lancamentos').select('origem_id').eq('org_id', orgId).eq('origem_tipo', 'midia')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lancadas = new Set<string>((lancRaw ?? []).map((l: any) => l.origem_id))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const midias: MidiaView[] = ((docsRaw ?? []) as any[]).filter(d => !lancadas.has(d.id)).map(d => ({
    id: d.id as string,
    numero: d.numero as number | null,
    serie: d.serie as string | null,
    titulo: (d.titulo as string) || '—',
    cliente: d.workspaces?.name ?? '—',
    veiculo: d.veiculos?.name ?? '—',
    valorDoc: Number(d.valor ?? 0),
    comissao: Math.round(Number(d.valor ?? 0) * Number(d.desconto_pct ?? 0)) / 100,
    pagador: FATURAMENTO_PAGADOR[d.faturamento] === 'veiculo'
      ? `${d.veiculos?.name ?? '—'} (veículo)` : `${d.workspaces?.name ?? '—'} (cliente)`,
    competencia: (d.data_base as string) ?? '',
    vencimento: midiaVencimentoVeiculo(d.data_base ?? null, d.prazo ?? null),
    previstoAgencia: (() => {
      const base = midiaVencimentoVeiculo(d.data_base ?? null, d.prazo ?? null)
      return base ? addDaysISO(base, Number(d.dias_agencia ?? 0)) : ''
    })(),
    diasAgencia: Number(d.dias_agencia ?? 0),
    anexos: (Array.isArray(d.anexos) ? d.anexos : []) as Anexo[],
  }))
  const totalComissao = midias.reduce((s, d) => s + d.comissao, 0)
  const totalDocs = midias.reduce((s, d) => s + d.valorDoc, 0)

  // Produção liberada pro Financeiro (estado unificado 'faturar' = A Faturar): Fee e Pedido.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: feesRaw } = await (supabase as any)
    .from('producao')
    .select('id, numero, serie, titulo, tipo, valor, bv_pct, honorarios_pct, detalhe, anexos, workspaces(name)')
    .eq('org_id', orgId).eq('archived', false)
    .eq('situacao', 'faturar').in('tipo', ['fee', 'pedido'])
    .order('numero', { ascending: false })
  // Parcelas que viram lançamento a receber (o que a agência realmente fatura).
  const RECEBER_TIPOS = ['receber_bv', 'receber_honorarios', 'receber_cliente']
  const COMISSAO_TIPOS = ['receber_bv', 'receber_honorarios']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fees = ((feesRaw ?? []) as any[]).map(f => {
    const valorCheio = Number(f.valor ?? 0)
    const diasAg = Number(f.detalhe?.dias_agencia ?? 7)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const todasParc = (Array.isArray(f.detalhe?.parcelas) ? f.detalhe.parcelas : []) as any[]
    const parcReceber = todasParc.filter(p => RECEBER_TIPOS.includes(p?.tipo))
    const somaReceber = parcReceber.reduce((s, p) => s + Number(p?.valor ?? 0), 0)
    // Valor que a agência fatura (verde): comissão+honorários no pedido; valor cheio no fee.
    const aFaturar = somaReceber > 0
      ? somaReceber
      : (f.tipo === 'pedido'
          ? valorCheio * ((Number(f.bv_pct ?? 0) + Number(f.honorarios_pct ?? 0)) / 100)
          : valorCheio)
    // Mostra as parcelas a receber (fallback p/ dados antigos sem tipo).
    const parcExibir = parcReceber.length ? parcReceber : todasParc
    return {
      id: f.id as string,
      tipo: (f.tipo as string) || 'fee',
      numero: f.numero as number | null,
      serie: f.serie as string | null,
      titulo: (f.titulo as string) || 'Item',
      cliente: f.workspaces?.name ?? '—',
      aFaturar,
      valorCliente: valorCheio, // valor cheio (cinza) — o que o cliente paga
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parcelas: parcExibir.map((p: any) => {
        const venc = (p?.vencimento as string) ?? ''
        const comissao = COMISSAO_TIPOS.includes(p?.tipo)
        return {
          vencimento: venc,                                            // cobrança (fornecedor/cliente)
          previstoAgencia: venc && comissao ? addDaysISO(venc, diasAg) : venc,  // + dias agência na comissão
          comissao,
          valor: Number(p?.valor ?? 0),
        }
      }),
      anexos: (Array.isArray(f.anexos) ? f.anexos : []) as Anexo[],
    }
  })
  const totalFees = fees.reduce((s, f) => s + f.aFaturar, 0)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Faturamento</h1>
          <p className="text-gray-500 text-sm mt-0.5">Conferência: revise cliente, datas e documentos e <strong>Fature</strong> pro fluxo de caixa</p>
        </div>
      </div>

      {/* Fees / Produção a faturar */}
      {fees.length > 0 && (
        <section className="mt-5">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h2 className="text-sm font-semibold text-gray-800">Fees e pedidos a faturar <span className="text-gray-400 font-normal">({fees.length})</span></h2>
            <span className="text-sm text-gray-500">A faturar: <strong className="text-emerald-600">{formatBRL(totalFees)}</strong></span>
          </div>
          <p className="text-xs text-gray-400 mb-2">Confira datas, anexe <strong className="font-medium text-gray-500">NF · Boleto · comprovantes</strong> e Fature — cada parcela vira 1 lançamento a receber.</p>
          <FaturamentoFeesTable orgSlug={orgSlug} fees={fees} />
        </section>
      )}

      {midias.length > 0 && (
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-2">Mídia a faturar <span className="text-gray-400 font-normal">({midias.length})</span></h2>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400">A conferir (documentos)</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">{midias.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400">Comissão a lançar</p>
            <p className="text-lg font-semibold text-emerald-600 mt-1">{formatBRL(totalComissao)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400">Total dos documentos</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">{formatBRL(totalDocs)}</p>
          </div>
        </div>
        <FaturamentoMidiaTable orgSlug={orgSlug} midias={midias} />
      </section>
      )}

      {fees.length === 0 && midias.length === 0 && (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <Receipt className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Nada a conferir</h3>
          <p className="text-gray-500 text-sm mt-1">Quando uma mídia, um fee ou um pedido for marcado como <strong>A Faturar</strong>, aparece aqui pra conferir e faturar.</p>
        </div>
      )}
    </div>
  )
}
