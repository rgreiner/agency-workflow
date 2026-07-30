'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Loader2, Download, Settings2, Check, AlertTriangle, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { carregarFechamento, salvarFechamentoConfig, type Fechamento } from '@/app/actions/rh-calendario'

export interface FechConfig { dia_ini: number; dia_pagamento: number; paga_mes_seguinte: boolean }

/** minutos → H:MM (com sinal). O relatório da contabilidade usa esse formato. */
function hm(min: number): string {
  const s = min < 0 ? '-' : ''
  const a = Math.abs(min)
  return `${s}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`
}
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const cpfMask = (c: string | null) => c ?? '—'

export function FechamentoClient({ orgSlug, config, hoje }: { orgSlug: string; config: FechConfig | null; hoje: string }) {
  const router = useRouter()
  const [comp, setComp] = useState(hoje.slice(0, 7))
  const [fech, setFech] = useState<Fechamento | null>(null)
  const [loading, setLoading] = useState(true)
  const [cfgOpen, setCfgOpen] = useState(false)
  const [diaIni, setDiaIni] = useState(config?.dia_ini ?? 26)
  const [diaPg, setDiaPg] = useState(config?.dia_pagamento ?? 30)
  const [pagaProx, setPagaProx] = useState(config?.paga_mes_seguinte ?? false)
  const [pending, start] = useTransition()

  const carregar = useCallback(async () => {
    setLoading(true)
    const r = await carregarFechamento(orgSlug, comp)
    if (r?.error) { toast.error(r.error); setFech(null) }
    else setFech(r?.fechamento ?? null)
    setLoading(false)
  }, [orgSlug, comp])

  useEffect(() => { carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  function salvarCfg() {
    start(async () => {
      const r = await salvarFechamentoConfig(orgSlug, diaIni, diaPg, pagaProx)
      if (r?.error) toast.error(r.error)
      else { toast.success('Período de fechamento salvo.'); setCfgOpen(false); router.refresh(); carregar() }
    })
  }

  /** CSV para a contabilidade (matrícula = CPF). */
  function baixarCsv() {
    if (!fech?.linhas.length) return
    const head = ['Colaborador', 'Matrícula (CPF)', 'Cargo', 'H.N.', 'H.E.50', 'H.E.100', 'Faltas', 'H. Totais', 'Quitação Banco']
    const rows = fech.linhas.map(l => [
      l.nome, cpfMask(l.cpf), l.cargo ?? '', hm(l.hn_min), hm(l.he50_min), hm(l.he100_min),
      hm(l.faltas_min), hm(l.total_min), hm(l.quitacao_min),
    ])
    const csv = [head, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `fechamento-ponto-${comp}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const semMarcacao = (fech?.linhas ?? []).filter(l => l.dias_com_ponto === 0)
  const pendentes = (fech?.linhas ?? []).filter(l => l.pendente_min > 0)

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><ClipboardList className="w-5 h-5 text-orange-600" /> Fechamento do ponto</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            O relatório que vai para a contabilidade.
            {fech && <> Período <b className="text-gray-700">{dataBR(fech.ini)} – {dataBR(fech.fim)}</b></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={comp} onChange={e => setComp(e.target.value)}
            className="px-3 py-2 text-sm bg-gray-100 border border-transparent rounded-xl text-gray-800" />
          <button onClick={() => setCfgOpen(true)} title="Período de fechamento"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
            <Settings2 className="w-4 h-4" /> Período
          </button>
          <button onClick={baixarCsv} disabled={!fech?.linhas.length}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            <Download className="w-4 h-4" /> Exportar CSV
          </button>
        </div>
      </div>

      {!!pendentes.length && (
        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 mb-4 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <b>{pendentes.length} pessoa(s) com hora extra pendente de aprovação</b> — o não aprovado <b>não entra</b> nas colunas H.E.
            <div className="text-xs mt-0.5">Aprove em RH → Ponto antes de fechar: {pendentes.map(p => `${p.nome.split(' ')[0]} (${hm(p.pendente_min)})`).join(' · ')}</div>
          </div>
        </div>
      )}

      {!!semMarcacao.length && (
        <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 px-4 py-3 mb-4 text-sm text-gray-600 flex items-start gap-2">
          <Clock className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <b>{semMarcacao.length} pessoa(s) sem nenhuma marcação no período</b> — aparecem como “sem marcação”, não como falta.
            <div className="text-xs mt-0.5 text-gray-500">Enquanto o ponto do Flow não estiver em uso por todos, use o relatório do sistema atual.</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Calculando…</div>
      ) : !fech?.linhas.length ? (
        <div className="text-center py-16 text-gray-400 text-sm">Nenhum colaborador no período.</div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-400">
              <th className="text-left px-4 py-3 font-medium">Colaborador</th>
              <th className="text-left px-3 py-3 font-medium">Matrícula (CPF)</th>
              <th className="text-right px-3 py-3 font-medium">H.N.</th>
              <th className="text-right px-3 py-3 font-medium">H.E.50</th>
              <th className="text-right px-3 py-3 font-medium">H.E.100</th>
              <th className="text-right px-3 py-3 font-medium">Faltas</th>
              <th className="text-right px-3 py-3 font-medium">H. Totais</th>
              <th className="text-right px-4 py-3 font-medium">Quitação Banco</th>
            </tr></thead>
            <tbody>
              {fech.linhas.map(l => {
                const vazio = l.dias_com_ponto === 0
                return (
                  <tr key={l.colaborador_id} className={`border-b border-gray-50 last:border-0 ${vazio ? 'opacity-50' : 'hover:bg-orange-50/40'} transition`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{l.nome}</div>
                      {l.cargo && <div className="text-xs text-gray-400">{l.cargo}</div>}
                    </td>
                    <td className="px-3 py-3 text-gray-500 tabular-nums">{cpfMask(l.cpf)}</td>
                    {vazio ? (
                      <td colSpan={6} className="px-3 py-3 text-center text-xs text-gray-400 italic">sem marcação no período</td>
                    ) : (
                      <>
                        <td className="px-3 py-3 text-right tabular-nums text-gray-700">{hm(l.hn_min)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-gray-600">
                          {hm(l.he50_min)}
                          {l.pendente_min > 0 && <span title={`${hm(l.pendente_min)} pendente de aprovação`} className="text-amber-600"> *</span>}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-gray-600">{hm(l.he100_min)}</td>
                        <td className={`px-3 py-3 text-right tabular-nums ${l.faltas_min > 0 ? 'text-red-600' : 'text-gray-400'}`}>{hm(l.faltas_min)}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-medium text-gray-900">{hm(l.total_min)}</td>
                        <td className={`px-4 py-3 text-right tabular-nums font-medium ${l.quitacao_min < 0 ? 'text-red-600' : l.quitacao_min > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{hm(l.quitacao_min)}</td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        H.N. = horas normais · H.E.50/100 = extra 50%/100% (só o aprovado) · Faltas = horas não cumpridas (inclui atraso parcial) ·
        H. Totais = H.N. + extras − faltas · Quitação = extras − faltas. Feriado/emenda marcados no Calendário não geram falta.
      </p>

      {cfgOpen && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => { if (e.target === e.currentTarget) setCfgOpen(false) }}>
          <div className="modal-card w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Período de fechamento</h2>
              <p className="text-xs text-gray-500 mt-0.5">Cada empresa fecha diferente. A One a One usa 26 → 25.</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Fecha do dia</label>
                <input type="number" min={1} max={28} value={diaIni} onChange={e => setDiaIni(Number(e.target.value) || 1)}
                  className="w-24 px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                <p className="text-[11px] text-gray-400 mt-1.5">
                  {diaIni === 1 ? 'Mês cheio (dia 1 ao último dia do mês).' : `Do dia ${diaIni} do mês anterior ao dia ${diaIni - 1} da competência.`}
                  {' '}Máximo 28 (acima disso quebraria em fevereiro).
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Dia do pagamento</label>
                <input type="number" min={1} max={31} value={diaPg} onChange={e => setDiaPg(Number(e.target.value) || 1)}
                  className="w-24 px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={pagaProx} onChange={e => setPagaProx(e.target.checked)} className="rounded text-orange-600 focus:ring-orange-500" />
                Paga no mês seguinte à competência
              </label>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setCfgOpen(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
              <button onClick={salvarCfg} disabled={pending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
