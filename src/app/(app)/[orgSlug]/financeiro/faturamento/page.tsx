import { assertFinanceAccess } from '@/lib/finance'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { GerarLancamentosButton } from './GerarLancamentosButton'
import { Receipt } from 'lucide-react'

export default async function FaturamentoPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)

  // Mídias faturadas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: docsRaw } = await (supabase as any)
    .from('midias')
    .select('id, numero, titulo, valor, faturamento, workspaces(name), veiculos(name)')
    .eq('org_id', orgId).eq('situacao', 'faturado').eq('archived', false)
    .order('numero', { ascending: false })

  // Lançamentos gerados a partir de mídias
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lancRaw } = await (supabase as any)
    .from('lancamentos')
    .select('origem_id, tipo, contato_tipo, contato_nome, descricao, valor, vencimento, situacao')
    .eq('org_id', orgId).eq('origem_tipo', 'midia')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lancByMidia = new Map<string, any>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(lancRaw ?? []).forEach((l: any) => lancByMidia.set(l.origem_id, l))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs = (docsRaw ?? []) as any[]
  const entradas = (lancRaw ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((l: any) => l.tipo === 'entrada').reduce((s: number, l: any) => s + Number(l.valor ?? 0), 0)
  const saidas = (lancRaw ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((l: any) => l.tipo === 'saida').reduce((s: number, l: any) => s + Number(l.valor ?? 0), 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalDocs = docs.reduce((s: number, d: any) => s + Number(d.valor ?? 0), 0)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Faturamento</h1>
          <p className="text-gray-500 text-sm mt-0.5">Mídias faturadas e a comissão que vai pro Financeiro</p>
        </div>
        <GerarLancamentosButton orgSlug={orgSlug} />
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Entradas das faturas</p>
          <p className="text-lg font-semibold text-emerald-600 mt-1">{formatBRL(entradas)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Saídas das faturas</p>
          <p className="text-lg font-semibold text-red-600 mt-1">{formatBRL(saidas)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Total dos documentos</p>
          <p className="text-lg font-semibold text-gray-900 mt-1">{formatBRL(totalDocs)}</p>
        </div>
      </div>

      {docs.length > 0 ? (
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
                <th className="text-left px-4 py-3">Vencimento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {docs.map(d => {
                const l = lancByMidia.get(d.id)
                return (
                  <tr key={d.id} className="hover:bg-gray-50/50 transition">
                    <td className="px-4 py-3 text-sm text-gray-400">{d.numero ?? '—'}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{d.titulo}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{d.workspaces?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{d.veiculos?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right">{formatBRL(Number(d.valor ?? 0))}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {l ? `${l.contato_nome ?? '—'} (${l.contato_tipo === 'veiculo' ? 'veículo' : 'cliente'})` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-emerald-600 text-right">{l ? formatBRL(Number(l.valor ?? 0)) : '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDateBR(l?.vencimento)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <Receipt className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Nenhuma mídia faturada</h3>
          <p className="text-gray-500 text-sm mt-1">Quando uma liberação de mídia for marcada como <strong>Faturado</strong>, ela aparece aqui com a comissão.</p>
        </div>
      )}
    </div>
  )
}
