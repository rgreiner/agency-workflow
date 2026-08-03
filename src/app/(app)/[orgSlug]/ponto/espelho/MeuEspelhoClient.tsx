'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Pencil, Lock, Download } from 'lucide-react'
import { toast } from 'sonner'
import { carregarEspelho, type Espelho } from '@/app/actions/rh-calendario'
import { AssinaturaPanel } from '../../rh/espelho/AssinaturaPanel'
import { EmailPessoalCard } from './EmailPessoalCard'
import { CienciaCard } from './CienciaCard'

const hm = (m: number) => `${m < 0 ? '-' : ''}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, '0')}`
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const DOW = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const STATUS_JUST: Record<string, string> = { aprovado: 'aprovada', rejeitado: 'rejeitada', abonado: 'abonada', falta: 'virou falta', pendente: 'pendente' }

/** Espelho do próprio colaborador: só leitura + assinatura (quem corrige é o RH). */
export function MeuEspelhoClient({ orgSlug, colaboradorId, compInicial }: {
  orgSlug: string; colaboradorId: string; compInicial: string
}) {
  const [comp, setComp] = useState(compInicial)
  const [esp, setEsp] = useState<Espelho | null>(null)
  const [loading, setLoading] = useState(true)
  // Muda para forçar o painel de assinatura a reler (e-mail/ciência liberam a assinatura).
  const [v, setV] = useState(0)

  const carregar = useCallback(async () => {
    setLoading(true)
    const r = await carregarEspelho(orgSlug, colaboradorId, comp)
    if (r?.error) { toast.error(r.error); setEsp(null) } else setEsp(r?.espelho ?? null)
    setLoading(false)
  }, [orgSlug, colaboradorId, comp])

  useEffect(() => { carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  return (
    <div className="p-6 max-w-4xl">
      <Link href={`/${orgSlug}/ponto`} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Meu ponto
      </Link>

      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Meu espelho de ponto</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Confira o período antes de assinar.
            {esp && <> Ciclo <b className="text-gray-700">{dataBR(esp.ini)} – {dataBR(esp.fim)}</b></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={comp} onChange={e => setComp(e.target.value)}
            className="px-3 py-2 text-sm bg-gray-100 border border-transparent rounded-xl text-gray-800" />
          <a href={`/api/rh/espelho/pdf?org=${orgSlug}&colaborador=${colaboradorId}&comp=${comp}`} download
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
            <Download className="w-4 h-4" /> PDF
          </a>
        </div>
      </div>

      {esp && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { l: 'Horas normais', v: hm(esp.resumo.hn_min), c: 'text-gray-900' },
            { l: 'Extras', v: hm(esp.resumo.extra_min), c: 'text-emerald-600' },
            { l: 'Faltas', v: hm(esp.resumo.faltas_min), c: esp.resumo.faltas_min > 0 ? 'text-red-600' : 'text-gray-400' },
            { l: 'Saldo do ciclo', v: hm(esp.resumo.saldo_min), c: esp.resumo.saldo_min < 0 ? 'text-red-600' : 'text-emerald-600' },
          ].map(x => (
            <div key={x.l} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-[11px] text-gray-400">{x.l}</div>
              <div className={`text-lg font-semibold tabular-nums ${x.c}`}>{x.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Ordem intencional: e-mail pessoal (2º fator) → ciência das divergências → assinatura. */}
      <EmailPessoalCard orgSlug={orgSlug} colaboradorId={colaboradorId} onPronto={() => setV(v => v + 1)} />
      <CienciaCard orgSlug={orgSlug} colaboradorId={colaboradorId} competencia={comp} onMudou={() => setV(v => v + 1)} />
      <AssinaturaPanel key={v} orgSlug={orgSlug} colaboradorId={colaboradorId} competencia={comp} papel="colaborador" onMudou={carregar} />

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Carregando…</div>
      ) : !esp ? null : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-400">
              <th className="text-left px-4 py-3 font-medium">Dia</th>
              <th className="text-left px-3 py-3 font-medium">Marcações</th>
              <th className="text-right px-3 py-3 font-medium">Trab.</th>
              <th className="text-right px-3 py-3 font-medium">Saldo</th>
              <th className="text-left px-3 py-3 font-medium">Ocorrência</th>
            </tr></thead>
            <tbody>
              {esp.dias.map(d => {
                const semCarga = d.esperado_min === 0
                return (
                  <tr key={d.data} className={`border-b border-gray-50 last:border-0 ${d.dow >= 6 || semCarga ? 'bg-gray-50/50' : ''}`}>
                    <td className="px-4 py-2.5">
                      <span className="text-gray-500 text-xs">{DOW[d.dow]}</span>{' '}
                      <span className="tabular-nums text-gray-900">{dataBR(d.data)}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {d.marcacoes.length === 0
                        ? <span className="text-gray-300 text-xs">—</span>
                        : <span className="tabular-nums text-gray-700">{d.marcacoes.join(' · ')}</span>}
                      {d.origem && <span title={`Importado do ${d.origem}`} className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-gray-400"><Lock className="w-3 h-3" />{d.origem}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{d.minutos ? hm(d.minutos) : <span className="text-gray-300">—</span>}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${d.saldo_min < 0 ? 'text-red-600' : d.saldo_min > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>{d.saldo_min ? hm(d.saldo_min) : '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {d.feriado && <span className={`text-[10px] px-1.5 py-0.5 rounded ${d.feriado.tipo === 'feriado' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{d.feriado.nome || d.feriado.tipo}</span>}
                        {d.justificativa && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">{d.justificativa.tipo} {STATUS_JUST[d.justificativa.status] ?? d.justificativa.status}</span>}
                        {d.ajuste && <span title={`Ajustado por ${d.ajuste.por ?? '—'}`} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700"><Pencil className="w-2.5 h-2.5" />ajustado</span>}
                        {d.intervalo_ok === false && <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700"><AlertTriangle className="w-2.5 h-2.5" />almoço {hm(d.intervalo_maior_min ?? 0)}</span>}
                        {!semCarga && d.marcacoes.length === 0 && !d.justificativa && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700">sem marcação</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        Achou divergência? Envie uma justificativa em Meu ponto antes de assinar — o RH corrige e você assina depois.
      </p>
    </div>
  )
}
