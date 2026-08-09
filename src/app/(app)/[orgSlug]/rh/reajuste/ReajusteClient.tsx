'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { TrendingUp, Loader2, Check, Undo2, Calculator, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { previaReajuste, aplicarReajuste, desfazerReajuste, type PreviaReajuste } from '@/app/actions/rh-evento'

export interface LoteRef {
  lote_id: string; data_efeito: string; percentual: number | null
  titulo: string | null; pessoas: number; created_at: string
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (d: string) => d.split('-').reverse().join('/')

export function ReajusteClient({ orgSlug, lotes }: { orgSlug: string; lotes: LoteRef[] }) {
  const router = useRouter()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const ano = hoje.slice(0, 4)

  // Data-base da convenção: maio, o padrão da categoria.
  const [dataEfeito, setDataEfeito] = useState(`${ano}-05-01`)
  const [percentual, setPercentual] = useState('')
  const [titulo, setTitulo] = useState(`Convenção coletiva ${ano}`)
  const [previa, setPrevia] = useState<PreviaReajuste | null>(null)
  const [fora, setFora] = useState<Set<string>>(new Set())
  const [pending, start] = useTransition()

  function calcular() {
    const p = Number(percentual.replace(',', '.'))
    if (!p || p <= 0) { toast.error('Informe o percentual do reajuste.'); return }
    start(async () => {
      const r = await previaReajuste(orgSlug, dataEfeito, p)
      if (r?.error) toast.error(r.error)
      else { setPrevia(r.previa!); setFora(new Set()) }
    })
  }

  function aplicar() {
    if (!previa) return
    const inclusos = previa.pessoas.filter(p => !fora.has(p.colaborador_id))
    if (inclusos.length === 0) { toast.error('Ninguém selecionado.'); return }
    start(async () => {
      const r = await aplicarReajuste(orgSlug, dataEfeito, Number(percentual.replace(',', '.')), titulo,
        inclusos.map(p => p.colaborador_id))
      if (r?.error) { toast.error(r.error); return }
      toast.success(`Reajuste aplicado a ${r.r!.pessoas} pessoas.`, {
        description: r.r!.retroativo_total > 0
          ? `Retroativo de ${brl(r.r!.retroativo_total)} referente a ${r.r!.meses_retroativos} meses.`
          : undefined,
        duration: 9000,
      })
      setPrevia(null); setPercentual(''); router.refresh()
    })
  }

  function desfazer(lote: string) {
    start(async () => {
      const r = await desfazerReajuste(orgSlug, lote)
      if (r?.error) toast.error(r.error)
      else { toast.success(`Reajuste desfeito em ${r.revertidos} pessoas.`); router.refresh() }
    })
  }

  const inclusos = previa?.pessoas.filter(p => !fora.has(p.colaborador_id)) ?? []
  const totalRetro = inclusos.reduce((s, p) => s + p.retroativo, 0)
  const totalMes = inclusos.reduce((s, p) => s + p.diferenca, 0)
  const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
        <TrendingUp className="w-5 h-5 text-orange-600" /> Reajuste coletivo
      </h1>
      <p className="text-gray-500 text-sm mb-6">
        A convenção do sindicato tem data-base em maio e costuma sair até agosto. Registre com a
        vigência real — o retroativo dos meses já pagos a menor é calculado aqui.
      </p>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">Passa a valer em</label>
            <input type="date" value={dataEfeito} onChange={e => { setDataEfeito(e.target.value); setPrevia(null) }} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">Percentual</label>
            <div className="relative">
              <input value={percentual} onChange={e => { setPercentual(e.target.value); setPrevia(null) }}
                className={inputCls} placeholder="5,5" inputMode="decimal" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">Título</label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} className={inputCls} />
          </div>
        </div>
        <button onClick={calcular} disabled={pending}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-[#fff] text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition">
          {pending && !previa ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />} Calcular
        </button>
      </section>

      {previa && (
        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden mb-5">
          <div className="px-5 py-3 border-b border-gray-100 flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-gray-700">
              Prévia — {inclusos.length} pessoa{inclusos.length > 1 ? 's' : ''}
            </h2>
            <span className="text-xs text-gray-500">
              Desmarque quem não entra (contrato recente, acordo à parte).
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-400 border-b border-gray-100">
                  <th className="text-left font-medium py-2 px-4">Pessoa</th>
                  <th className="text-right font-medium px-2">Hoje</th>
                  <th className="text-right font-medium px-2">Novo</th>
                  <th className="text-right font-medium px-2">Por mês</th>
                  <th className="text-right font-medium px-4">Retroativo</th>
                </tr>
              </thead>
              <tbody>
                {previa.pessoas.map(p => {
                  const off = fora.has(p.colaborador_id)
                  return (
                    <tr key={p.colaborador_id}
                      onClick={() => setFora(s => { const n = new Set(s); if (off) n.delete(p.colaborador_id); else n.add(p.colaborador_id); return n })}
                      className={`border-b border-gray-50 last:border-0 cursor-pointer transition-colors ${off ? 'opacity-35' : 'hover:bg-gray-50/70'}`}>
                      <td className="py-2 px-4">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={!off} readOnly
                            className="w-3.5 h-3.5 rounded border-gray-300 text-orange-600 pointer-events-none" />
                          <div className="min-w-0">
                            <div className="text-gray-900 truncate">{p.nome}</div>
                            <div className="text-[11px] text-gray-400 truncate">{p.cargo ?? '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-right px-2 text-gray-500 tabular-nums">{brl(p.salario_de)}</td>
                      <td className="text-right px-2 text-gray-900 font-medium tabular-nums">{brl(p.salario_para)}</td>
                      <td className="text-right px-2 text-emerald-700 tabular-nums">+{brl(p.diferenca)}</td>
                      <td className="text-right px-4 text-sky-700 tabular-nums">{brl(p.retroativo)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-4 bg-gray-50/70 border-t border-gray-100">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 mb-3 text-sm">
              <span className="text-gray-600">Aumento mensal na folha: <b className="text-gray-900 tabular-nums">{brl(totalMes)}</b></span>
              <span className="text-gray-600">
                Retroativo a pagar: <b className="text-sky-700 tabular-nums">{brl(totalRetro)}</b>
                <span className="text-gray-400"> ({previa.meses_retroativos} {previa.meses_retroativos === 1 ? 'mês' : 'meses'})</span>
              </span>
            </div>
            {previa.meses_retroativos > 0 && (
              <p className="text-[11.5px] text-gray-500 mb-3 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
                O retroativo é o que ficou a pagar de {dataBR(previa.data_efeito)} até o mês passado — some
                junto da folha do mês em que a convenção saiu. O Flow calcula e registra na linha do tempo
                de cada pessoa, mas <b>não lança no Financeiro</b>: esse passo é seu.
              </p>
            )}
            <button onClick={aplicar} disabled={pending || inclusos.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Aplicar a {inclusos.length} pessoa{inclusos.length > 1 ? 's' : ''}
            </button>
          </div>
        </section>
      )}

      {lotes.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Reajustes aplicados</h2>
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
            {lotes.map(l => (
              <div key={l.lote_id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900">{l.titulo ?? 'Reajuste coletivo'}</div>
                  <div className="text-xs text-gray-500 tabular-nums">
                    vigência {dataBR(l.data_efeito)} · {l.percentual}% · {l.pessoas} pessoas
                  </div>
                </div>
                <button onClick={() => desfazer(l.lote_id)} disabled={pending}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-50 transition">
                  <Undo2 className="w-3.5 h-3.5" /> Desfazer
                </button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            Desfazer devolve o salário anterior e apaga os eventos do lote — mas não mexe em quem já
            teve promoção depois desse reajuste.
          </p>
        </section>
      )}
    </div>
  )
}
