'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, CalendarClock, Check, Link2, Loader2, Truck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import {
  vincularEntregaTarefa, type EntregaSemTarefa, type TarefaCandidata,
} from '@/app/actions/midia-hub'

const fmt = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—')

/**
 * Tela transitória (01/09): liga as entregas antigas — criadas quando o vazio de
 * "tarefa da criação" ainda tinha dois sentidos — à tarefa que já existe na
 * pauta. Vinculada, a entrega volta a mostrar status e conflito de prazo, e a
 * tarefa passa a exibir o aviso do prazo do veículo para quem faz a arte.
 *
 * Quando a lista zera, a tela sai do menu — mesmo destino da "Migrar rotinas".
 */
export function VincularEntregas({ orgSlug, entregas, tarefas }: {
  orgSlug: string
  entregas: EntregaSemTarefa[]
  tarefas: Record<string, TarefaCandidata[]>
}) {
  const [escolhas, setEscolhas] = useState<Record<string, { activityId: string; marcada: boolean }>>(
    // Sugestão fraca nasce DESMARCADA: é onde o erro passaria em silêncio.
    () => Object.fromEntries(entregas.map(e => [e.id, {
      activityId: e.tarefaSugerida ?? '',
      marcada: !!e.tarefaSugerida && !e.sugestaoFraca,
    }])),
  )
  const [feitas, setFeitas] = useState<Set<string>>(new Set())
  const [pending, start] = useTransition()

  const pendentes = useMemo(() => entregas.filter(e => !feitas.has(e.id)), [entregas, feitas])
  const prontas = pendentes.filter(e => escolhas[e.id]?.marcada && escolhas[e.id]?.activityId)

  function set(id: string, patch: Partial<{ activityId: string; marcada: boolean }>) {
    setEscolhas(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  function vincularSelecionadas() {
    start(async () => {
      const ok: string[] = []
      const erros: string[] = []
      for (const e of prontas) {
        const r = await vincularEntregaTarefa(orgSlug, e.id, escolhas[e.id].activityId)
        if (r?.error) erros.push(`${e.titulo}: ${r.error}`)
        else ok.push(e.id)
      }
      if (ok.length) {
        setFeitas(prev => new Set([...prev, ...ok]))
        toast.success(`${ok.length} entrega${ok.length > 1 ? 's' : ''} vinculada${ok.length > 1 ? 's' : ''}.`)
      }
      for (const msg of erros.slice(0, 3)) toast.error(msg)
    })
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Vincular entregas</h1>
        <p className="text-gray-500 text-sm mt-0.5 max-w-3xl">
          Entregas pendentes que ainda não apontam para nenhuma tarefa. Ligar cada uma à peça que já está
          na pauta faz a entrega mostrar o status da criação e o conflito de prazo — e faz a tarefa avisar
          o designer da data do veículo. <b>Quando esta lista zerar, a tela pode sair do menu.</b>
        </p>
      </div>

      {pendentes.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-gray-500">
            {pendentes.length} pendente{pendentes.length > 1 ? 's' : ''}
          </span>
          {prontas.length > 0 && (
            <button onClick={vincularSelecionadas} disabled={pending}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors disabled:opacity-60">
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Vincular {prontas.length} selecionada{prontas.length > 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}

      {pendentes.length === 0 ? (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl">
          <Check className="w-8 h-8 text-emerald-600 mx-auto" />
          <p className="text-sm text-gray-600 mt-3">Nenhuma entrega pendente sem tarefa.</p>
          <p className="text-[12px] text-gray-400 mt-1">
            Esta tela cumpriu o papel — pode ser removida do menu.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {pendentes.map(e => {
            const esc = escolhas[e.id] ?? { activityId: '', marcada: false }
            const cand = tarefas[e.workspaceId] ?? []
            return (
              <li key={e.id} className={cn('bg-white border rounded-xl p-4',
                e.sugestaoFraca ? 'border-amber-200' : 'border-gray-200')}>
                <div className="flex items-start gap-3 flex-wrap">
                  <button onClick={() => set(e.id, { marcada: !esc.marcada })} disabled={!esc.activityId}
                    aria-pressed={esc.marcada}
                    className={cn('w-5 h-5 mt-0.5 rounded-md border flex items-center justify-center shrink-0 transition-colors',
                      esc.marcada ? 'bg-orange-600 border-orange-600' : 'border-gray-300',
                      !esc.activityId && 'opacity-40 cursor-not-allowed')}>
                    {esc.marcada && <Check className="w-3.5 h-3.5 text-[#fff]" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{e.titulo}</p>
                    <p className="text-[11px] text-gray-400 inline-flex items-center gap-2 flex-wrap mt-0.5">
                      <span>{e.cliente}</span>
                      {e.veiculo && (
                        <span className="inline-flex items-center gap-1">
                          · <Truck className="w-3 h-3" /> {e.veiculo}
                        </span>
                      )}
                      {e.formato && <span className="text-gray-300">· {e.formato}</span>}
                      <span className="inline-flex items-center gap-1">
                        · <CalendarClock className="w-3 h-3" /> envio {fmt(e.prazoEnvio)}
                      </span>
                    </p>
                    {e.observacao && <p className="text-[12px] text-gray-500 mt-1">{e.observacao}</p>}

                    {e.sugestaoFraca && (
                      <p className="text-[11px] text-amber-700 mt-1.5 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        {e.tarefaSugerida
                          ? 'Nada muito parecido na pauta — confira antes de marcar.'
                          : 'Nenhuma tarefa parecida neste cliente.'}
                      </p>
                    )}

                    <label className="block mt-2.5">
                      <span className="text-[11px] text-gray-400">Tarefa da pauta</span>
                      <div className="mt-0.5">
                        <Select size="sm" value={esc.activityId}
                          onChange={v => set(e.id, { activityId: v, marcada: !!v })}
                          options={cand.map(t => ({
                            value: t.id,
                            label: `${t.titulo}${t.prazo ? ` · ${fmt(t.prazo)}` : ''} — ${t.campanha}`,
                          }))}
                          placeholder={cand.length ? 'Escolha a tarefa' : 'Este cliente não tem tarefa ativa'} />
                      </div>
                    </label>

                    {cand.length === 0 && (
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        Se essa peça ainda precisa ser produzida, abra o briefing por{' '}
                        <Link href={`/${orgSlug}/midia/entregas`} className="text-orange-600 hover:text-orange-700">
                          Entregas
                        </Link>{' '}— o select de lá cria a tarefa.
                      </p>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
