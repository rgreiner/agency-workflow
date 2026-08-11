'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check, Pencil, AlertTriangle, History, X, Plus, Trash2, Lock, Download, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { carregarEspelho, editarPonto, type Espelho, type EspelhoDia } from '@/app/actions/rh-calendario'
import { AssinaturaPanel } from '../AssinaturaPanel'

const hm = (m: number) => `${m < 0 ? '-' : ''}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, '0')}`
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const DOW = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const dtBR = (s: string) => new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const STATUS_JUST: Record<string, string> = { aprovado: 'aprovada', rejeitado: 'rejeitada', abonado: 'abonada', falta: 'virou falta', pendente: 'pendente' }

export function EspelhoClient({ orgSlug, colaboradorId, compInicial }: { orgSlug: string; colaboradorId: string; compInicial: string }) {
  const [comp, setComp] = useState(compInicial)
  const [esp, setEsp] = useState<Espelho | null>(null)
  const [loading, setLoading] = useState(true)
  const [editando, setEditando] = useState<EspelhoDia | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    const r = await carregarEspelho(orgSlug, colaboradorId, comp)
    if (r?.error) { toast.error(r.error); setEsp(null) } else setEsp(r?.espelho ?? null)
    setLoading(false)
  }, [orgSlug, colaboradorId, comp])

  useEffect(() => { carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  return (
    <div className="p-6 max-w-5xl">
      <Link href={`/${orgSlug}/rh/espelho`} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Espelho de ponto
      </Link>

      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{esp?.colaborador.nome ?? '—'}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {esp?.colaborador.cargo || 'Sem cargo'}
            {esp && <> · ciclo <b className="text-gray-700">{dataBR(esp.ini)} – {dataBR(esp.fim)}</b></>}
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
              {/* O dia de hoje fica fora da conta (mig. 230). */}
              {x.l === 'Saldo do ciclo' && esp.resumo.ate && (
                <div className="text-[10px] text-gray-400 mt-1 leading-tight">
                  fechado até {esp.resumo.ate.slice(8, 10)}/{esp.resumo.ate.slice(5, 7)}
                </div>
              )}
              {/* O total de extras é o que foi TRABALHADO além da jornada. O que
                  entra na folha é só a parte aprovada — dizer isso aqui evita a
                  conversa de "mas o sistema mostrava X". */}
              {x.l === 'Extras' && (
                <div className="text-[10px] text-amber-700 mt-1 leading-tight">
                  só entra na folha depois de aprovado
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AssinaturaPanel orgSlug={orgSlug} colaboradorId={colaboradorId} competencia={comp} papel="empresa" onMudou={carregar} />

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
              <th className="px-4 py-3 w-px"></th>
            </tr></thead>
            <tbody>
              {esp.dias.map(d => {
                const fds = d.dow >= 6
                const semCarga = d.esperado_min === 0
                const temHist = !!d.ajuste || d.log.length > 0 || !!d.justificativa
                return (
                  <>
                    <tr key={d.data} className={`border-b border-gray-50 last:border-0 transition ${fds || semCarga ? 'bg-gray-50/50' : 'hover:bg-orange-50/40'}`}>
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
                      {/* Saldo zerado pela tolerância mostra o quanto foi absorvido:
                          sem isso, 7:55 trabalhadas com saldo "—" parece erro de conta. */}
                      <td className={`px-3 py-2.5 text-right tabular-nums ${d.saldo_min < 0 ? 'text-red-600' : d.saldo_min > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                        {d.saldo_min ? hm(d.saldo_min) : d.tolerado_min
                          ? <span title={`${hm(d.tolerado_min)} dentro da tolerância de ${esp.jornada.tolerancia_min ?? 10} min — não vira falta nem extra.`}
                              className="text-gray-400">{hm(d.tolerado_min)}<span className="text-gray-300">*</span></span>
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {d.feriado && <span className={`text-[10px] px-1.5 py-0.5 rounded ${d.feriado.tipo === 'feriado' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{d.feriado.nome || d.feriado.tipo}</span>}
                          {d.justificativa && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">{d.justificativa.tipo} {STATUS_JUST[d.justificativa.status] ?? d.justificativa.status}</span>}
                          {/* Anexo continua alcançável DEPOIS de decidida — a fila
                              de pendentes esvazia, e é conferindo o mês que alguém
                              pergunta "cadê o atestado desse dia?". */}
                          {d.justificativa?.doc_id && (
                            <a href={`/api/rh/documento/${d.justificativa.doc_id}`} target="_blank" rel="noopener noreferrer"
                              title="Abrir o anexo da justificativa"
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 hover:bg-orange-100 transition">
                              <Paperclip className="w-2.5 h-2.5" />anexo
                            </a>
                          )}
                          {d.ajuste && <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700"><Pencil className="w-2.5 h-2.5" />ajustado</span>}
                          {d.intervalo_ok === false && <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700"><AlertTriangle className="w-2.5 h-2.5" />almoço {hm(d.intervalo_maior_min ?? 0)}</span>}
                          {d.extra_status === 'pendente' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">extra pendente</span>}
                          {!semCarga && d.marcacoes.length === 0 && !d.justificativa && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700">sem marcação</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {temHist && (
                          <button onClick={() => setAberto(aberto === d.data ? null : d.data)} title="Ver histórico"
                            className="p-1.5 text-gray-400 hover:text-violet-600 transition"><History className="w-3.5 h-3.5" /></button>
                        )}
                        {!d.origem && (
                          <button onClick={() => setEditando(d)} title="Editar dia"
                            className="p-1.5 text-gray-400 hover:text-orange-600 transition"><Pencil className="w-3.5 h-3.5" /></button>
                        )}
                      </td>
                    </tr>
                    {aberto === d.data && (
                      <tr key={`${d.data}-h`} className="bg-gray-50/70 border-b border-gray-100">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="space-y-2 text-xs">
                            {d.ajuste && (
                              <div className="text-gray-600">
                                <b>Registro original:</b>{' '}
                                <span className="tabular-nums">{d.ajuste.de?.marcacoes?.length ? d.ajuste.de.marcacoes.join(' · ') : [d.ajuste.de?.entrada, d.ajuste.de?.saida].filter(Boolean).join(' · ') || 'sem marcação'}</span>
                                {' — '}alterado por <b>{d.ajuste.por ?? '—'}</b> em {dtBR(d.ajuste.em)}
                              </div>
                            )}
                            {d.justificativa && (
                              <div className="text-gray-600">
                                <b>Justificativa:</b> {d.justificativa.tipo}
                                {d.justificativa.descricao && ` — "${d.justificativa.descricao}"`}
                                {' · '}<b>{STATUS_JUST[d.justificativa.status] ?? d.justificativa.status}</b>
                                {d.justificativa.decidido_por && <> por <b>{d.justificativa.decidido_por}</b></>}
                                {d.justificativa.decidido_em && ` em ${dtBR(d.justificativa.decidido_em)}`}
                                {/* Explica na própria linha por que a carga do dia
                                    foi menor — sem isto o saldo parece arbitrário. */}
                                {d.justificativa.ausencia_ini && d.justificativa.ausencia_fim && (
                                  <> · abonado das <b>{d.justificativa.ausencia_ini.slice(0, 5)}</b> às{' '}
                                    <b>{d.justificativa.ausencia_fim.slice(0, 5)}</b></>
                                )}
                                {d.justificativa.doc_id && (
                                  <> · <a href={`/api/rh/documento/${d.justificativa.doc_id}`} target="_blank" rel="noopener noreferrer"
                                    className="text-orange-700 hover:underline font-medium">ver anexo</a></>
                                )}
                              </div>
                            )}
                            {d.log.map((l, i) => (
                              <div key={i} className="text-gray-500">
                                <b>{l.acao === 'edicao_rh' ? 'Edição do RH' : l.acao}</b>{' '}
                                <span className="tabular-nums">[{l.antes?.join(' · ') || 'vazio'}] → [{l.depois?.join(' · ') || 'vazio'}]</span>
                                {l.motivo && ` — ${l.motivo}`}
                                {' · '}{l.por ?? '—'} em {dtBR(l.em)}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {esp?.dias.some(d => d.tolerado_min) && (
        <p className="text-[11px] text-gray-400 mt-3">
          <b className="text-gray-500">*</b> diferença dentro da tolerância de {esp.jornada.tolerancia_min ?? 10} minutos
          do dia (art. 58 §1º da CLT): não vira falta nem hora extra, e o dia conta a jornada cheia nas horas normais.
        </p>
      )}
      <p className="text-[11px] text-gray-400 mt-3">
        Dia importado do Pontomais é o registro legal do sistema anterior e não pode ser editado aqui.
        Toda edição exige motivo e fica no histórico (registro original, quem alterou e quando).
      </p>

      {editando && esp && (
        <EditarDia orgSlug={orgSlug} colaboradorId={colaboradorId} dia={editando}
          onClose={() => setEditando(null)} onOk={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function EditarDia({ orgSlug, colaboradorId, dia, onClose, onOk }: {
  orgSlug: string; colaboradorId: string; dia: EspelhoDia; onClose: () => void; onOk: () => void
}) {
  const [horas, setHoras] = useState<string[]>(dia.marcacoes.length ? [...dia.marcacoes] : ['', ''])
  const [motivo, setMotivo] = useState('')
  const [saving, start] = useTransition()
  const [down, setDown] = useState(false)

  const set = (i: number, v: string) => setHoras(p => p.map((x, k) => k === i ? v : x))
  const add = () => setHoras(p => [...p, '', ''])
  const del = (i: number) => setHoras(p => p.filter((_, k) => k !== i))

  function salvar() {
    const limpo = horas.map(h => h.trim()).filter(Boolean)
    if (limpo.length % 2 === 1) { toast.error('As marcações vêm em pares (entrada e saída).'); return }
    if (!motivo.trim()) { toast.error('Informe o motivo da alteração.'); return }
    const ordenado = [...limpo].sort()
    if (ordenado.join() !== limpo.join()) { toast.error('As marcações precisam estar em ordem crescente.'); return }
    start(async () => {
      const r = await editarPonto(orgSlug, colaboradorId, dia.data, limpo, motivo.trim())
      if (r?.error) toast.error(r.error)
      else { toast.success('Dia corrigido.'); onOk() }
    })
  }

  const inputCls = 'w-24 px-2 py-1.5 text-sm bg-gray-100 border border-transparent rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onMouseDown={() => setDown(true)}
      onClick={e => { if (down && e.target === e.currentTarget) onClose(); setDown(false) }}>
      <div className="modal-card w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Corrigir {DOW[dia.dow]} {dataBR(dia.data)}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Marcações (pares: entrada e saída)</label>
            <div className="space-y-2">
              {horas.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-400 w-14">{i === 0 ? 'Entrada' : i % 2 === 1 ? 'Saída' : 'Retorno'}</span>
                  <input type="time" value={h} onChange={e => set(i, e.target.value)} className={inputCls} />
                  <button onClick={() => del(i)} className="p-1 text-gray-400 hover:text-red-500 transition"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
            <button onClick={add} className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-orange-600 transition">
              <Plus className="w-3.5 h-3.5" /> Adicionar par (pausa)
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Motivo da alteração *</label>
            <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="ex.: esqueceu de bater a saída"
              className="w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500" />
            <p className="text-[11px] text-gray-400 mt-1.5">Fica registrado com seu nome e a marcação anterior — a original nunca é apagada.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button onClick={salvar} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
          </button>
        </div>
      </div>
    </div>
  )
}
