'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  History, Plus, Loader2, Check, X, TrendingUp, Award, MessageSquare,
  AlertTriangle, Plane, Briefcase, Trash2, CornerDownRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '@/components/ui/Select'
import { carregarTimeline, salvarEvento, excluirEvento, type EventoTL } from '@/app/actions/rh-evento'

const TIPOS = [
  { value: 'reajuste',    label: 'Reajuste salarial', icon: TrendingUp,    cor: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { value: 'promocao',    label: 'Promoção',          icon: Award,         cor: 'text-orange-700 bg-orange-50 border-orange-200' },
  { value: 'cargo',       label: 'Mudança de cargo',  icon: Briefcase,     cor: 'text-sky-700 bg-sky-50 border-sky-200' },
  { value: 'feedback',    label: 'Feedback',          icon: MessageSquare, cor: 'text-gray-600 bg-gray-100 border-gray-200' },
  { value: 'advertencia', label: 'Advertência',       icon: AlertTriangle, cor: 'text-red-700 bg-red-50 border-red-200' },
  { value: 'afastamento', label: 'Afastamento',       icon: Plane,         cor: 'text-amber-700 bg-amber-50 border-amber-200' },
  { value: 'outro',       label: 'Outro',             icon: History,       cor: 'text-gray-600 bg-gray-100 border-gray-200' },
]
const porTipo = (t: string) => TIPOS.find(x => x.value === t) ?? TIPOS[TIPOS.length - 1]

const brl = (v: number | null) => v == null ? '—'
  : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (d: string) => d.split('-').reverse().join('/')
const mesAno = (d: string) => { const [a, m] = d.split('-'); return `${m}/${a}` }

export function Timeline({ orgSlug, colaboradorId, salarioAtual, cargoAtual }: {
  orgSlug: string; colaboradorId: string; salarioAtual: number | null; cargoAtual: string | null
}) {
  const router = useRouter()
  const [itens, setItens] = useState<EventoTL[] | null>(null)
  const [novo, setNovo] = useState(false)
  const [pending, start] = useTransition()

  const carregar = useCallback(() => {
    carregarTimeline(colaboradorId).then(setItens)
  }, [colaboradorId])
  useEffect(() => { carregar() }, [carregar])

  function apagar(id: string) {
    start(async () => {
      const r = await excluirEvento(orgSlug, id, colaboradorId)
      if (r?.error) toast.error(r.error)
      else { toast.success('Evento removido.'); carregar(); router.refresh() }
    })
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <History className="w-4 h-4 text-gray-400" /> Linha do tempo
        </h2>
        <button onClick={() => setNovo(true)}
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-orange-600 transition">
          <Plus className="w-3.5 h-3.5" /> Registrar
        </button>
      </div>

      {itens === null ? (
        <p className="py-6 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-gray-300" /></p>
      ) : itens.length === 0 ? (
        <p className="text-sm text-gray-400 py-3">
          Nada registrado ainda. Promoção, reajuste, feedback e advertência ficam aqui —
          com a data em que <b>passaram a valer</b>, não a data em que você registrou.
        </p>
      ) : (
        <div className="space-y-2.5">
          {itens.map(e => {
            const t = porTipo(e.tipo)
            const Icon = t.icon
            return (
              <div key={e.id} className="flex gap-3 group">
                <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${t.cor}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0 pb-2.5 border-b border-gray-50 last:border-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{e.titulo || t.label}</span>
                    <span className="text-[11px] text-gray-400 tabular-nums">{dataBR(e.data_efeito)}</span>
                    {/* Registrado depois da vigência: o caso normal da convenção. */}
                    {e.retroativo && (
                      <span className="text-[10px] text-sky-700 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5">
                        lançado depois
                      </span>
                    )}
                  </div>

                  {(e.salario_para != null || e.cargo_para) && (
                    <div className="text-[12px] text-gray-600 mt-1 flex flex-wrap items-center gap-x-2">
                      {e.salario_para != null && (
                        <span className="tabular-nums">
                          {e.salario_de != null && <span className="text-gray-400">{brl(e.salario_de)} → </span>}
                          <b className="text-gray-900">{brl(e.salario_para)}</b>
                          {e.percentual != null && <span className="text-emerald-700"> (+{e.percentual}%)</span>}
                        </span>
                      )}
                      {e.cargo_para && (
                        <span>{e.cargo_de && <span className="text-gray-400">{e.cargo_de} → </span>}<b>{e.cargo_para}</b></span>
                      )}
                    </div>
                  )}

                  {e.descricao && <p className="text-[12.5px] text-gray-600 mt-1 whitespace-pre-wrap">{e.descricao}</p>}

                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10.5px] text-gray-400">
                      {e.por ?? '—'} · registrado em {mesAno(e.registrado_em.slice(0, 10))}
                      {e.lote_id && ' · reajuste coletivo'}
                    </span>
                    <button onClick={() => apagar(e.id)} disabled={pending}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition disabled:opacity-40"
                      title="Remover">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {novo && (
        <NovoEvento orgSlug={orgSlug} colaboradorId={colaboradorId}
          salarioAtual={salarioAtual} cargoAtual={cargoAtual}
          onClose={() => setNovo(false)}
          onOk={() => { setNovo(false); carregar(); router.refresh() }} />
      )}
    </section>
  )
}

function NovoEvento({ orgSlug, colaboradorId, salarioAtual, cargoAtual, onClose, onOk }: {
  orgSlug: string; colaboradorId: string; salarioAtual: number | null; cargoAtual: string | null
  onClose: () => void; onOk: () => void
}) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const [tipo, setTipo] = useState('reajuste')
  const [dataEfeito, setDataEfeito] = useState(hoje)
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [salarioPara, setSalarioPara] = useState('')
  const [cargoPara, setCargoPara] = useState('')
  const [saving, start] = useTransition()
  const [down, setDown] = useState(false)

  const mexeSalario = tipo === 'reajuste' || tipo === 'promocao'
  const mexeCargo   = tipo === 'promocao' || tipo === 'cargo'
  const retro = dataEfeito < hoje

  function salvar() {
    if (mexeSalario && salarioPara && Number(salarioPara) <= 0) {
      toast.error('Salário inválido.'); return
    }
    start(async () => {
      const r = await salvarEvento(orgSlug, null, {
        colaborador_id: colaboradorId, tipo, data_efeito: dataEfeito,
        titulo: titulo || null, descricao: descricao || null,
        salario_de: mexeSalario && salarioPara ? salarioAtual : null,
        salario_para: mexeSalario && salarioPara ? Number(salarioPara) : null,
        cargo_de: mexeCargo && cargoPara ? cargoAtual : null,
        cargo_para: mexeCargo && cargoPara ? cargoPara : null,
      })
      if (r?.error) toast.error(r.error)
      else { toast.success('Registrado na linha do tempo.'); onOk() }
    })
  }

  const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onMouseDown={() => setDown(true)}
      onClick={e => { if (down && e.target === e.currentTarget) onClose(); setDown(false) }}>
      <div className="modal-card w-full max-w-md max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Registrar na linha do tempo</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-3.5">
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">O que aconteceu</label>
            <Select value={tipo} onChange={setTipo} options={TIPOS.map(t => ({ value: t.value, label: t.label }))} />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1.5">Passou a valer em</label>
            <input type="date" value={dataEfeito} onChange={e => setDataEfeito(e.target.value)} className={inputCls} />
            {retro && (
              <p className="text-[11px] text-sky-700 mt-1.5 flex items-start gap-1">
                <CornerDownRight className="w-3 h-3 mt-0.5 shrink-0" />
                Data no passado — o evento entra no histórico com essa vigência, e fica marcado
                como lançado depois. É assim que a convenção do sindicato deve ser registrada.
              </p>
            )}
          </div>

          {mexeSalario && (
            <div>
              <label className="block text-sm text-gray-600 mb-1.5">
                Novo salário <span className="text-gray-400 font-normal">(hoje: {brl(salarioAtual)})</span>
              </label>
              <input type="number" step="0.01" value={salarioPara} onChange={e => setSalarioPara(e.target.value)}
                className={inputCls} placeholder="0,00" />
            </div>
          )}

          {mexeCargo && (
            <div>
              <label className="block text-sm text-gray-600 mb-1.5">
                Novo cargo <span className="text-gray-400 font-normal">(hoje: {cargoAtual ?? '—'})</span>
              </label>
              <input value={cargoPara} onChange={e => setCargoPara(e.target.value)} className={inputCls} />
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-600 mb-1.5">
              Título <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} className={inputCls}
              placeholder="ex.: Convenção coletiva 2026" />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1.5">
              Descrição <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2} className={inputCls} />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          <button onClick={salvar} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Registrar
          </button>
        </div>
      </div>
    </div>
  )
}
