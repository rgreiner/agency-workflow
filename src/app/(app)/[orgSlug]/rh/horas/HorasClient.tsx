'use client'

import { useRouter } from 'next/navigation'
import { Timer, TriangleAlert, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface LinhaTarefa {
  activity_id: string; titulo: string; status: string
  campanha: string | null; cliente: string | null; workspace_id: string | null
  estimadas: number | null; minutos: number; sem_sinal_min: number
  pessoas: number; custo: number | null
}
export interface LinhaPessoa {
  user_id: string; nome: string | null
  min_ponto: number; min_tarefa: number; min_sem_tarefa: number
  sem_sinal_min: number; tarefas: number; custo_hora: number | null
}

const hm = (min: number) => {
  const m = Math.round(min)
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100) : 0)

const PRESETS = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: 'mes', label: 'Este mês' },
  { id: 'anterior', label: 'Mês passado' },
]

export function HorasClient({ orgSlug, de, ate, preset, tarefas, pessoas, erro }: {
  orgSlug: string
  de: string; ate: string; preset: string
  tarefas: LinhaTarefa[]; pessoas: LinhaPessoa[]; erro: string | null
}) {
  const router = useRouter()

  const totalTarefa = tarefas.reduce((s, t) => s + Number(t.minutos), 0)
  const totalCusto = tarefas.reduce((s, t) => s + Number(t.custo ?? 0), 0)
  const totalSemSinal = tarefas.reduce((s, t) => s + Number(t.sem_sinal_min), 0)
  const totalPonto = pessoas.reduce((s, p) => s + Number(p.min_ponto), 0)
  const totalCego = pessoas.reduce((s, p) => s + Number(p.min_sem_tarefa), 0)
  const temCusto = tarefas.some(t => t.custo != null)

  // Por cliente (agrega as tarefas) — é a leitura que responde "esse cliente dá lucro?"
  const porCliente = Object.values(
    tarefas.reduce((acc, t) => {
      const k = t.cliente ?? '—'
      acc[k] ??= { cliente: k, minutos: 0, custo: 0, tarefas: 0 }
      acc[k].minutos += Number(t.minutos)
      acc[k].custo += Number(t.custo ?? 0)
      acc[k].tarefas += 1
      return acc
    }, {} as Record<string, { cliente: string; minutos: number; custo: number; tarefas: number }>)
  ).sort((a, b) => b.minutos - a.minutos)

  const irPara = (p: string) => router.push(`/${orgSlug}/rh/horas?p=${p}`)

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
          <Timer className="w-5 h-5 text-orange-600" /> Horas
        </h1>
        <p className="text-gray-500 text-sm">
          Tempo medido pelo uso: da abertura de uma tarefa até a abertura da próxima, dentro do ponto do dia.
          Ninguém aponta nada.
        </p>
      </div>

      {/* Período */}
      <div className="flex flex-wrap items-center gap-1.5 mb-5">
        {PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => irPara(p.id)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              preset === p.id
                ? 'bg-orange-500 text-[#fff]'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            {p.label}
          </button>
        ))}
        <span className="text-xs text-gray-400 ml-1">
          {de.split('-').reverse().join('/')} — {ate.split('-').reverse().join('/')}
        </span>
      </div>

      {erro && (
        <div className="mb-5 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
          {erro}
        </div>
      )}

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card titulo="Em tarefas" valor={hm(totalTarefa)} sub={`${tarefas.length} tarefa(s)`} destaque />
        <Card titulo="No ponto" valor={hm(totalPonto)} sub="jornada registrada" />
        <Card
          titulo="Sem tarefa aberta"
          valor={hm(totalCego)}
          sub={`${pct(totalCego, totalPonto)}% do ponto`}
          alerta={pct(totalCego, totalPonto) > 40}
        />
        {temCusto
          ? <Card titulo="Custo do tempo" valor={brl(totalCusto)} sub="folha ÷ horas úteis" />
          : <Card titulo="Sem sinal" valor={hm(totalSemSinal)} sub={`${pct(totalSemSinal, totalTarefa)}% do medido`} alerta={pct(totalSemSinal, totalTarefa) > 50} />}
      </div>

      {totalTarefa === 0 && !erro && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500 flex items-start gap-3">
          <Info className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-gray-700 font-medium mb-1">Ainda não há tempo medido neste período.</p>
            <p>A medição começa a partir do momento em que a coleta entrou no ar — dias anteriores não têm como ser reconstituídos. O tempo só é atribuído a quem tem <strong>ponto batido</strong> e <strong>ficha vinculada ao login</strong> (RH → Pessoas).</p>
          </div>
        </div>
      )}

      {/* Por cliente */}
      {porCliente.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Por cliente</h2>
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
            {porCliente.map(c => (
              <div key={c.cliente} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{c.cliente}</p>
                  <p className="text-xs text-gray-400">{c.tarefas} tarefa(s)</p>
                </div>
                <div className="w-32 h-1.5 rounded-full bg-gray-100 overflow-hidden hidden sm:block">
                  <div className="h-full bg-orange-400 rounded-full" style={{ width: `${pct(c.minutos, totalTarefa)}%` }} />
                </div>
                <span className="text-sm font-semibold text-gray-900 tabular-nums w-16 text-right">{hm(c.minutos)}</span>
                {temCusto && <span className="text-sm text-gray-500 tabular-nums w-24 text-right">{brl(c.custo)}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Por pessoa */}
      {pessoas.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Por pessoa</h2>
          <p className="text-xs text-gray-400 mb-3">
            &ldquo;Sem tarefa&rdquo; = tempo de ponto que nenhuma tarefa estava aberta (antes da primeira abertura do dia).
            &ldquo;Sem sinal&rdquo; = a tarefa ficou aberta sem a aba visível — o desvio a monitorar.
          </p>
          <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2.5 font-medium">Pessoa</th>
                  <th className="px-3 py-2.5 font-medium text-right">Ponto</th>
                  <th className="px-3 py-2.5 font-medium text-right">Em tarefas</th>
                  <th className="px-3 py-2.5 font-medium text-right">Sem tarefa</th>
                  <th className="px-3 py-2.5 font-medium text-right">Sem sinal</th>
                  <th className="px-3 py-2.5 font-medium text-right">Tarefas</th>
                  <th className="px-4 py-2.5 font-medium text-right">Custo/h</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pessoas.map(p => (
                  <tr key={p.user_id}>
                    <td className="px-4 py-2.5 text-gray-800">{p.nome ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{hm(p.min_ponto)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-gray-900">{hm(p.min_tarefa)}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums',
                      pct(p.min_sem_tarefa, p.min_ponto) > 40 ? 'text-amber-600 font-medium' : 'text-gray-500')}>
                      {hm(p.min_sem_tarefa)}
                      <span className="text-xs text-gray-400 ml-1">{pct(p.min_sem_tarefa, p.min_ponto)}%</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{hm(p.sem_sinal_min)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{p.tarefas}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                      {p.custo_hora != null ? brl(Number(p.custo_hora)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Por tarefa */}
      {tarefas.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Por tarefa</h2>
          <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-2.5 font-medium">Tarefa</th>
                  <th className="px-3 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium text-right">Estimado</th>
                  <th className="px-3 py-2.5 font-medium text-right">Medido</th>
                  <th className="px-3 py-2.5 font-medium text-right">Sem sinal</th>
                  <th className="px-4 py-2.5 font-medium text-right">Custo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tarefas.map(t => {
                  const estMin = t.estimadas != null ? Number(t.estimadas) * 60 : null
                  const estourou = estMin != null && estMin > 0 && Number(t.minutos) > estMin
                  return (
                    <tr key={t.activity_id}>
                      <td className="px-4 py-2.5 text-gray-800 max-w-xs truncate" title={t.titulo}>{t.titulo}</td>
                      <td className="px-3 py-2.5 text-gray-500 truncate">{t.cliente ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-400">
                        {estMin != null ? hm(estMin) : '—'}
                      </td>
                      <td className={cn('px-3 py-2.5 text-right tabular-nums font-medium',
                        estourou ? 'text-amber-600' : 'text-gray-900')}>
                        {hm(Number(t.minutos))}
                        {estourou && <TriangleAlert className="w-3 h-3 inline ml-1 -mt-0.5" />}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-400">{hm(Number(t.sem_sinal_min))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                        {t.custo != null ? brl(Number(t.custo)) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function Card({ titulo, valor, sub, destaque, alerta }: {
  titulo: string; valor: string; sub?: string; destaque?: boolean; alerta?: boolean
}) {
  return (
    <div className={cn('rounded-2xl border p-4',
      destaque ? 'border-orange-100 bg-orange-50/50' : alerta ? 'border-amber-100 bg-amber-50/40' : 'border-gray-200 bg-white')}>
      <p className="text-xs text-gray-500 mb-1">{titulo}</p>
      <p className={cn('text-xl font-semibold tabular-nums',
        destaque ? 'text-orange-700' : alerta ? 'text-amber-700' : 'text-gray-900')}>{valor}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
