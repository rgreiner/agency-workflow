'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw, Loader2, Check, X, RotateCcw, Landmark, ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { sincronizarBtg, conciliarMovimento, ignorarMovimento, desfazerConciliacaoBtg } from '@/app/actions/btg'

export interface LancOption {
  id: string; tipo: string; contatoNome: string | null; descricao: string | null
  valor: number; vencimento: string | null
}
export interface MovementView {
  id: string; tipo: string; valor: number; dataMov: string
  descricao: string | null; categoria: string | null; sugestaoId: string | null
  status?: string
}

const STATUS_LABEL: Record<string, string> = { conciliado: 'Conciliado', ignorado: 'Ignorado' }

function lancLabel(l: LancOption): string {
  const venc = l.vencimento ? formatDateBR(l.vencimento) : '—'
  return `${l.contatoNome || l.descricao || 'Sem descrição'} · ${formatBRL(l.valor)} · ${venc}`
}

export function ConciliacaoClient({ orgSlug, pendentes, historico, abertos }: {
  orgSlug: string; pendentes: MovementView[]; historico: MovementView[]; abertos: LancOption[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [syncing, setSyncing] = useState(false)
  const [showHistorico, setShowHistorico] = useState(false)
  const [picked, setPicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(pendentes.filter(m => m.sugestaoId).map(m => [m.id, m.sugestaoId as string])))

  const abertosPorTipo = useMemo(() => ({
    entrada: abertos.filter(l => l.tipo === 'entrada'),
    saida: abertos.filter(l => l.tipo === 'saida'),
  }), [abertos])

  function runSync() {
    setSyncing(true)
    startTransition(async () => {
      const r = await sincronizarBtg(orgSlug)
      setSyncing(false)
      if (!r.ok) { toast.error(r.error); return }
      toast.success(`Sincronizado: ${r.movimentos} movimento(s) nos últimos 30 dias.`)
      router.refresh()
    })
  }
  function conciliar(movementId: string) {
    const lancId = picked[movementId]
    if (!lancId) { toast.error('Selecione um lançamento.'); return }
    startTransition(async () => {
      const r = await conciliarMovimento(orgSlug, movementId, lancId)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Conciliado.')
      router.refresh()
    })
  }
  function ignorar(movementId: string) {
    startTransition(async () => {
      const r = await ignorarMovimento(orgSlug, movementId)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Movimento ignorado.')
      router.refresh()
    })
  }
  function desfazer(movementId: string) {
    startTransition(async () => {
      const r = await desfazerConciliacaoBtg(orgSlug, movementId)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Desfeito — voltou pra pendente.')
      router.refresh()
    })
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
            <Landmark className="w-4 h-4 text-gray-400" /> Conciliação BTG
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Cruza o extrato do banco com os lançamentos em aberto.</p>
        </div>
        <button onClick={runSync} disabled={syncing || isPending}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sincronizar agora
        </button>
      </div>

      {pendentes.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200 mt-5">
          <Check className="w-10 h-10 text-emerald-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Tudo conciliado</h3>
          <p className="text-gray-500 text-sm mt-1">Nenhum movimento pendente. Clique em <strong>Sincronizar agora</strong> pra buscar novos.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto mt-5">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
                <th className="text-left px-4 py-3 w-28">Data</th>
                <th className="text-left px-4 py-3">Movimento</th>
                <th className="text-right px-4 py-3 w-32">Valor</th>
                <th className="text-left px-4 py-3 w-72">Lançamento correspondente</th>
                <th className="w-44" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pendentes.map(m => {
                const credito = m.tipo === 'credit'
                const options = (credito ? abertosPorTipo.entrada : abertosPorTipo.saida)
                  .map(l => ({ value: l.id, label: lancLabel(l) }))
                return (
                  <tr key={m.id} className="hover:bg-gray-50/50 transition">
                    <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">{formatDateBR(m.dataMov)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {credito
                          ? <ArrowDownCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                          : <ArrowUpCircle className="w-4 h-4 text-red-500 shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{m.descricao || '—'}</p>
                          {m.categoria && <p className="text-xs text-gray-400 truncate">{m.categoria}</p>}
                        </div>
                      </div>
                    </td>
                    <td className={cn('px-4 py-3 text-sm font-medium text-right tabular-nums', credito ? 'text-emerald-600' : 'text-red-600')}>
                      {credito ? '+' : '−'}{formatBRL(m.valor)}
                    </td>
                    <td className="px-4 py-3">
                      {options.length > 0 ? (
                        <Select size="sm" value={picked[m.id] ?? ''} onChange={v => setPicked(p => ({ ...p, [m.id]: v }))}
                          options={options} placeholder="Selecionar lançamento" />
                      ) : (
                        <span className="text-xs text-gray-400">Nenhum lançamento aberto compatível</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => conciliar(m.id)} disabled={isPending || !picked[m.id]}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-40 transition">
                          <Check className="w-3.5 h-3.5" /> Conciliar
                        </button>
                        <button onClick={() => ignorar(m.id)} disabled={isPending}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition">
                          <X className="w-3.5 h-3.5" /> Ignorar
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {historico.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowHistorico(s => !s)} className="text-sm text-gray-500 hover:text-gray-700 transition">
            {showHistorico ? 'Ocultar' : 'Ver'} histórico ({historico.length})
          </button>
          {showHistorico && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto mt-3">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
                    <th className="text-left px-4 py-3 w-28">Data</th>
                    <th className="text-left px-4 py-3">Movimento</th>
                    <th className="text-right px-4 py-3 w-32">Valor</th>
                    <th className="text-left px-4 py-3 w-28">Status</th>
                    <th className="w-28" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {historico.map(m => {
                    const credito = m.tipo === 'credit'
                    return (
                      <tr key={m.id} className="hover:bg-gray-50/50 transition">
                        <td className="px-4 py-3 text-sm text-gray-500 tabular-nums">{formatDateBR(m.dataMov)}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 truncate">{m.descricao || '—'}</td>
                        <td className={cn('px-4 py-3 text-sm text-right tabular-nums', credito ? 'text-emerald-600' : 'text-red-600')}>
                          {credito ? '+' : '−'}{formatBRL(m.valor)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full',
                            m.status === 'conciliado' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
                            {STATUS_LABEL[m.status ?? ''] ?? m.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button onClick={() => desfazer(m.id)} disabled={isPending}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-orange-600 transition disabled:opacity-40">
                            <RotateCcw className="w-3.5 h-3.5" /> Desfazer
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
