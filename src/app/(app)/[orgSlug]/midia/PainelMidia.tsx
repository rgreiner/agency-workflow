'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, ExternalLink, FolderOpen, Inbox, Repeat } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MachinePath } from '@/components/ui/MachinePath'

export interface PedidoRow {
  id: string; titulo: string; status: string; prazo: string | null
  cliente: string; campanha: string
  workspaceId: string; campaignId: string
  pastaUrl: string | null; pastaPath: string | null
  redacaoUrl: string | null; previewUrl: string | null; finalUrl: string | null
}

export interface RotinaRow {
  id: string; titulo: string; status: string; prazo: string | null
  cliente: string; frequencia: string
  workspaceId: string; campaignId: string
}

interface StatusCfg { valor: string; label: string; bg: string; txt: string }

const FREQ_LABEL: Record<string, string> = {
  weekly: 'semanal', biweekly: 'quinzenal', monthly: 'mensal',
  bimonthly: 'bimestral', quarterly: 'trimestral', semiannual: 'semestral', annual: 'anual',
}

const hojeBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

function prazoInfo(prazo: string | null) {
  if (!prazo) return { texto: 'sem prazo', tom: 'neutro' as const }
  const hoje = hojeBR()
  const d = prazo.slice(0, 10)
  const dias = Math.round((new Date(d + 'T12:00:00').getTime() - new Date(hoje + 'T12:00:00').getTime()) / 86400000)
  const fmt = `${d.slice(8, 10)}/${d.slice(5, 7)}`
  if (dias < 0) return { texto: `${fmt} · atrasada`, tom: 'atraso' as const }
  if (dias === 0) return { texto: `${fmt} · hoje`, tom: 'hoje' as const }
  if (dias <= 7) return { texto: `${fmt} · em ${dias}d`, tom: 'perto' as const }
  return { texto: fmt, tom: 'neutro' as const }
}

const TOM: Record<string, string> = {
  atraso: 'text-red-600 bg-red-50',
  hoje: 'text-orange-700 bg-orange-50',
  perto: 'text-amber-700 bg-amber-50',
  neutro: 'text-gray-500 bg-gray-100',
}

export function PainelMidia({ orgSlug, pedidos, rotinas, statusCfg }: {
  orgSlug: string
  pedidos: PedidoRow[]
  rotinas: RotinaRow[]
  statusCfg: StatusCfg[]
}) {
  const [aba, setAba] = useState<'pedidos' | 'rotinas'>('pedidos')
  const cfg = useMemo(() => new Map(statusCfg.map(s => [s.valor, s])), [statusCfg])

  // Um cliente por bloco: é assim que ela trabalha (resolve tudo de um cliente
  // de uma vez), e era o que o balde escondia atrás de `[Cliente]` no título.
  const porCliente = useMemo(() => {
    const lista = aba === 'pedidos' ? pedidos : rotinas
    const m = new Map<string, (PedidoRow | RotinaRow)[]>()
    for (const item of lista) {
      const arr = m.get(item.cliente) ?? []
      arr.push(item)
      m.set(item.cliente, arr)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
  }, [aba, pedidos, rotinas])

  const vazio = (aba === 'pedidos' ? pedidos : rotinas).length === 0

  return (
    <section className="bg-white border border-gray-200 rounded-xl">
      <div className="flex items-center gap-2 p-4 border-b border-gray-100">
        {([['pedidos', 'Pedidos do time', <Inbox key="i" className="w-4 h-4" />],
           ['rotinas', 'Rotinas', <Repeat key="r" className="w-4 h-4" />]] as const).map(([v, label, icon]) => (
          <button key={v} onClick={() => setAba(v)} aria-pressed={aba === v}
            className={cn('inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-xl transition-colors',
              aba === v ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:bg-gray-100')}>
            {icon} {label}
            <span className={cn('tabular-nums text-xs', aba === v ? 'text-gray-300' : 'text-gray-400')}>
              {v === 'pedidos' ? pedidos.length : rotinas.length}
            </span>
          </button>
        ))}
      </div>

      {vazio ? (
        <p className="text-sm text-gray-400 text-center py-16">
          {aba === 'pedidos'
            ? 'Nada na fila. Quando o time mandar uma tarefa para a mídia, ela aparece aqui.'
            : 'Nenhuma rotina ativa. Ative a mídia num cliente em "Clientes e rotinas".'}
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {porCliente.map(([cliente, itens]) => (
            <div key={cliente} className="p-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2.5">
                {cliente} <span className="text-gray-300 font-normal normal-case">· {itens.length}</span>
              </h2>
              <ul className="space-y-1.5">
                {itens.map(item => {
                  const p = prazoInfo(item.prazo)
                  const s = cfg.get(item.status)
                  const href = `/${orgSlug}/workspaces/${item.workspaceId}/campaigns/${item.campaignId}/activities/${item.id}?from=${encodeURIComponent(`/${orgSlug}/midia`)}`
                  const pedido = 'pastaUrl' in item ? item : null
                  return (
                    <li key={item.id} className="rounded-xl border border-gray-100 hover:border-gray-200 transition-colors">
                      <div className="flex items-center gap-3 px-3 py-2.5 flex-wrap">
                        <Link href={href} className="text-sm text-gray-800 hover:text-orange-600 transition-colors font-medium min-w-0 flex-1 truncate">
                          {item.titulo}
                        </Link>
                        {'frequencia' in item && item.frequencia && (
                          <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
                            <Repeat className="w-3 h-3" /> {FREQ_LABEL[item.frequencia] ?? item.frequencia}
                          </span>
                        )}
                        {s && (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0"
                            style={{ backgroundColor: s.bg, color: s.txt }}>{s.label}</span>
                        )}
                        <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 inline-flex items-center gap-1', TOM[p.tom])}>
                          <CalendarClock className="w-3 h-3" /> {p.texto}
                        </span>
                      </div>

                      {/* Os atalhos que ela abria a tarefa para procurar. */}
                      {pedido && (pedido.finalUrl || pedido.previewUrl || pedido.redacaoUrl || pedido.pastaUrl || pedido.pastaPath) && (
                        <div className="flex items-center gap-1.5 flex-wrap px-3 pb-2.5 -mt-0.5">
                          <Atalho url={pedido.finalUrl} label="Final" />
                          <Atalho url={pedido.previewUrl} label="Preview" />
                          <Atalho url={pedido.redacaoUrl} label="Redação" />
                          <Atalho url={pedido.pastaUrl} label="Pasta" icon />
                          {pedido.pastaPath && (
                            <span className="text-[11px] text-gray-400 min-w-0">
                              <MachinePath winPath={pedido.pastaPath} compact />
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Atalho({ url, label, icon }: { url: string | null; label: string; icon?: boolean }) {
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 text-[11px] font-medium text-gray-600 hover:bg-orange-50 hover:text-orange-700 transition-colors">
      {icon ? <FolderOpen className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />} {label}
    </a>
  )
}
