import { assertFinanceAccess } from '@/lib/finance'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { Wallet } from 'lucide-react'

const SITUACAO_LABEL: Record<string, string> = {
  em_aberto: 'Em aberto', recebido: 'Recebido', pago: 'Pago',
}
const ORIGEM_LABEL: Record<string, string> = {
  midia: 'Mídia', producao: 'Produção', fee: 'Fee', manual: 'Manual',
}

export default async function LancamentosPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw } = await (supabase as any)
    .from('lancamentos')
    .select('id, tipo, origem_tipo, contato_tipo, contato_nome, descricao, valor, vencimento, situacao')
    .eq('org_id', orgId)
    .order('vencimento', { ascending: true, nullsFirst: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lancamentos = (raw ?? []) as any[]
  const aReceber = lancamentos
    .filter(l => l.tipo === 'entrada' && l.situacao === 'em_aberto')
    .reduce((s, l) => s + Number(l.valor ?? 0), 0)
  const aPagar = lancamentos
    .filter(l => l.tipo === 'saida' && l.situacao === 'em_aberto')
    .reduce((s, l) => s + Number(l.valor ?? 0), 0)

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900">Lançamentos</h1>
        <p className="text-gray-500 text-sm mt-0.5">Contas a receber e a pagar geradas pelos documentos</p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">A receber (em aberto)</p>
          <p className="text-lg font-semibold text-emerald-600 mt-1">{formatBRL(aReceber)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">A pagar (em aberto)</p>
          <p className="text-lg font-semibold text-red-600 mt-1">{formatBRL(aPagar)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400">Saldo previsto</p>
          <p className="text-lg font-semibold text-gray-900 mt-1">{formatBRL(aReceber - aPagar)}</p>
        </div>
      </div>

      {lancamentos.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
                <th className="text-left px-4 py-3">Vencimento</th>
                <th className="text-left px-4 py-3">Contato</th>
                <th className="text-left px-4 py-3">Descrição</th>
                <th className="text-left px-4 py-3">Origem</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-right px-4 py-3">Valor</th>
                <th className="text-left px-4 py-3">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lancamentos.map(l => (
                <tr key={l.id} className="hover:bg-gray-50/50 transition">
                  <td className="px-4 py-3 text-sm text-gray-600">{formatDateBR(l.vencimento)}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{l.contato_nome ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{l.descricao ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{ORIGEM_LABEL[l.origem_tipo] ?? '—'}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={l.tipo === 'entrada' ? 'text-emerald-600' : 'text-red-600'}>
                      {l.tipo === 'entrada' ? 'A receber' : 'A pagar'}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-sm font-medium text-right ${l.tipo === 'entrada' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatBRL(Number(l.valor ?? 0))}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{SITUACAO_LABEL[l.situacao] ?? l.situacao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <Wallet className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Nenhum lançamento ainda</h3>
          <p className="text-gray-500 text-sm mt-1">Os lançamentos aparecem quando uma mídia é faturada.</p>
        </div>
      )}
    </div>
  )
}
