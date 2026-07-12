import { assertFinanceAccess } from '@/lib/finance'
import { formatBRL, FATURAMENTO_PAGADOR } from '@/lib/midia'
import { GerarLancamentosButton } from './GerarLancamentosButton'
import { LancarButton } from './LancarButton'
import { FaturamentoFeesTable } from './FaturamentoFeesTable'
import { Receipt } from 'lucide-react'

export default async function FaturamentoPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)

  // Mídias faturadas (marcadas pela mídia/produção)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: docsRaw } = await (supabase as any)
    .from('midias')
    .select('id, numero, titulo, valor, desconto_pct, faturamento, workspaces(name), veiculos(name)')
    .eq('org_id', orgId).eq('situacao', 'faturado').eq('archived', false)
    .order('numero', { ascending: false })

  // Quais já foram lançadas (têm lançamento)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lancRaw } = await (supabase as any)
    .from('lancamentos').select('origem_id').eq('org_id', orgId).eq('origem_tipo', 'midia')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lancadas = new Set<string>((lancRaw ?? []).map((l: any) => l.origem_id))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendentes = ((docsRaw ?? []) as any[]).filter(d => !lancadas.has(d.id))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comissaoDe = (d: any) => Math.round(Number(d.valor ?? 0) * Number(d.desconto_pct ?? 0)) / 100
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pagadorDe = (d: any) => (FATURAMENTO_PAGADOR[d.faturamento] === 'veiculo'
    ? `${d.veiculos?.name ?? '—'} (veículo)` : `${d.workspaces?.name ?? '—'} (cliente)`)

  const totalComissao = pendentes.reduce((s, d) => s + comissaoDe(d), 0)
  const totalDocs = pendentes.reduce((s, d) => s + Number(d.valor ?? 0), 0)

  // Produção pronta pro Financeiro conferir e gerar as parcelas (1 lançamento por
  // parcela via gerar_lancamentos_producao): Fee 'aprovado' e Pedido 'faturar'.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: feesRaw } = await (supabase as any)
    .from('producao')
    .select('id, numero, titulo, tipo, valor, detalhe, workspaces(name)')
    .eq('org_id', orgId).eq('archived', false)
    .or('and(tipo.eq.fee,situacao.eq.aprovado),and(tipo.eq.pedido,situacao.eq.faturar)')
    .order('numero', { ascending: false })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fees = ((feesRaw ?? []) as any[]).map(f => ({
    id: f.id as string,
    numero: f.numero as number | null,
    titulo: (f.titulo as string) || 'Fee',
    cliente: f.workspaces?.name ?? '—',
    total: Number(f.valor ?? 0),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parcelas: (Array.isArray(f.detalhe?.parcelas) ? f.detalhe.parcelas : []).map((p: any) => ({
      vencimento: (p?.vencimento as string) ?? '',
      valor: Number(p?.valor ?? 0),
    })),
  }))
  const totalFees = fees.reduce((s, f) => s + f.total, 0)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Faturamento</h1>
          <p className="text-gray-500 text-sm mt-0.5">Conferência: revise os valores e <strong>Lance</strong> pro Financeiro</p>
        </div>
        {pendentes.length > 0 && <GerarLancamentosButton orgSlug={orgSlug} />}
      </div>

      {/* Fees / Produção a faturar (Atendimento marcou "Faturar") */}
      {fees.length > 0 && (
        <section className="mt-5">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h2 className="text-sm font-semibold text-gray-800">Fees e pedidos a faturar <span className="text-gray-400 font-normal">({fees.length})</span></h2>
            <span className="text-sm text-gray-500">Total: <strong className="text-gray-900">{formatBRL(totalFees)}</strong></span>
          </div>
          <p className="text-xs text-gray-400 mb-2">Cada parcela vira 1 lançamento a receber — confira as datas e valores abaixo antes de lançar (clique no <strong className="font-medium text-gray-500">Nx</strong> pra recolher).</p>
          <FaturamentoFeesTable orgSlug={orgSlug} fees={fees} />
        </section>
      )}

      {pendentes.length > 0 && (
      <>
      <h2 className="text-sm font-semibold text-gray-800 mt-6 mb-2">Mídia a lançar <span className="text-gray-400 font-normal">({pendentes.length})</span></h2>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">A conferir (documentos)</p>
          <p className="text-lg font-semibold text-gray-900 mt-1">{pendentes.length}</p>
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

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
                <th className="text-left px-4 py-3 w-16">Nº</th>
                <th className="text-left px-4 py-3">Título</th>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-left px-4 py-3">Veículo</th>
                <th className="text-right px-4 py-3">Valor doc.</th>
                <th className="text-left px-4 py-3">Comissão (cobrar de)</th>
                <th className="text-right px-4 py-3">Comissão</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pendentes.map(d => (
                <tr key={d.id} className="hover:bg-gray-50/50 transition">
                  <td className="px-4 py-3 text-sm text-gray-400">{d.numero ?? '—'}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{d.titulo}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{d.workspaces?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{d.veiculos?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-right">{formatBRL(Number(d.valor ?? 0))}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{pagadorDe(d)}</td>
                  <td className="px-4 py-3 text-sm font-medium text-emerald-600 text-right">{formatBRL(comissaoDe(d))}</td>
                  <td className="px-3 py-3 text-right"><LancarButton orgSlug={orgSlug} midiaId={d.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
      )}

      {fees.length === 0 && pendentes.length === 0 && (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <Receipt className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Nada a conferir</h3>
          <p className="text-gray-500 text-sm mt-1">Quando um <strong>Fee</strong> for aprovado, um <strong>Pedido</strong> marcado como <strong>Faturar</strong>, ou uma <strong>mídia</strong> como <strong>Faturado</strong>, aparece aqui pra conferir e lançar.</p>
        </div>
      )}
    </div>
  )
}
