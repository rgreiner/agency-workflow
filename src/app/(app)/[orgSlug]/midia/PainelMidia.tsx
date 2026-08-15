'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CalendarClock, Check, CheckCircle2, ExternalLink, FolderOpen, Inbox, Loader2, Repeat, Undo2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MachinePath } from '@/components/ui/MachinePath'
import { concluirTarefaMidia, concluidasRecentes, reabrirTarefaMidia } from '@/app/actions/midia-hub'

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
  const [aba, setAba] = useState<'pedidos' | 'rotinas' | 'feitas'>('pedidos')
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
           ['rotinas', 'Rotinas', <Repeat key="r" className="w-4 h-4" />],
           ['feitas', 'Feitas', <CheckCircle2 key="f" className="w-4 h-4" />]] as const).map(([v, label, icon]) => (
          <button key={v} onClick={() => setAba(v)} aria-pressed={aba === v}
            className={cn('inline-flex items-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-xl transition-colors',
              aba === v ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:bg-gray-100')}>
            {icon} {label}
            {v !== 'feitas' && (
              <span className={cn('tabular-nums text-xs', aba === v ? 'text-gray-300' : 'text-gray-400')}>
                {v === 'pedidos' ? pedidos.length : rotinas.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {aba === 'feitas' ? (
        <Feitas orgSlug={orgSlug} />
      ) : vazio ? (
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
                        <BotaoFeito orgSlug={orgSlug} id={item.id}
                          recorrente={'frequencia' in item && !!item.frequencia} />
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

/**
 * "Feito": conclui a tarefa. Rotina volta para a fila com o próximo prazo,
 * tarefa única fica concluída — o toast diz qual dos dois aconteceu, porque
 * o desfazer de cada um é diferente.
 */
function BotaoFeito({ orgSlug, id, recorrente }: { orgSlug: string; id: string; recorrente: boolean }) {
  const [pending, start] = useTransition()
  const router = useRouter()

  function concluir() {
    start(async () => {
      const r = await concluirTarefaMidia(orgSlug, id)
      if ('error' in r && r.error) { toast.error(r.error); return }
      if (r.recorreu) {
        const d = r.novoPrazo
        toast.success(d ? `Feito. Volta em ${d.slice(8, 10)}/${d.slice(5, 7)}.` : 'Feito. Volta no próximo ciclo.')
      } else {
        toast.success('Concluída.')
      }
      router.refresh()
    })
  }

  return (
    <button onClick={concluir} disabled={pending}
      title={recorrente ? 'Concluir este ciclo — a rotina volta com o próximo prazo' : 'Concluir'}
      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-gray-100 text-gray-600 hover:bg-emerald-100 hover:text-emerald-700 transition-colors disabled:opacity-60">
      {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
      Feito
    </button>
  )
}

/**
 * O que a mídia fechou nos últimos 7 dias. É rastro, não arquivo: o
 * arquivamento das concluídas continua sendo em lote na Lista, com o Rafael —
 * quebrar isso em dois lugares tornaria impossível saber o que já foi tratado.
 */
function Feitas({ orgSlug }: { orgSlug: string }) {
  const [itens, setItens] = useState<{
    id: string; titulo: string; cliente: string; workspaceId: string; campaignId: string
    quando: string; quem: string | null; voltarPara: string
  }[] | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  useEffect(() => {
    let vivo = true
    const buscar = async () => {
      const r = await concluidasRecentes(orgSlug)
      if (!vivo) return
      if ('error' in r && r.error) { toast.error(r.error); setItens([]); return }
      setItens(r.itens ?? [])
    }
    void buscar()
    return () => { vivo = false }
  }, [orgSlug])

  function reabrir(id: string, destino: string) {
    start(async () => {
      const r = await reabrirTarefaMidia(orgSlug, id, destino)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Voltou para a fila.')
      setItens(prev => (prev ?? []).filter(i => i.id !== id))
      router.refresh()
    })
  }

  if (itens === null) return <p className="text-sm text-gray-400 text-center py-16">Carregando…</p>
  if (itens.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-16">
        Nada concluído nos últimos 7 dias.
      </p>
    )
  }

  return (
    <div>
      <ul className="divide-y divide-gray-50">
        {itens.map(i => {
          const d = i.quando.slice(0, 10)
          return (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <Link href={`/${orgSlug}/workspaces/${i.workspaceId}/campaigns/${i.campaignId}/activities/${i.id}?from=${encodeURIComponent(`/${orgSlug}/midia`)}`}
                className="text-sm text-gray-700 hover:text-orange-600 transition-colors min-w-0 flex-1 truncate">
                {i.titulo}
              </Link>
              <span className="text-[11px] text-gray-400 shrink-0">{i.cliente}</span>
              <span className="text-[11px] text-gray-400 shrink-0 tabular-nums">
                {d.slice(8, 10)}/{d.slice(5, 7)}{i.quem ? ` · ${i.quem.split(' ')[0]}` : ''}
              </span>
              <button onClick={() => reabrir(i.id, i.voltarPara)} disabled={pending}
                title="Voltar para a fila"
                className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors disabled:opacity-60">
                {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                Reabrir
              </button>
            </li>
          )
        })}
      </ul>
      <p className="text-[11px] text-gray-400 px-4 py-3 border-t border-gray-50">
        Arquivar continua na Lista, em lote — este bloco é só o rastro dos últimos 7 dias.
      </p>
    </div>
  )
}
