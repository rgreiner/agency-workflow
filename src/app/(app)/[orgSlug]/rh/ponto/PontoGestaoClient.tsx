'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, FileText, Check, X, Ban, CalendarX, CalendarClock, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { decidirExtra, decidirJustificativa, setPontoObrigatorio } from '@/app/actions/rh-ponto'
import { MarcacoesEditor, validarMarcacoes } from '@/components/ponto/MarcacoesEditor'
import { LocaisPonto } from '@/components/rh/LocaisPonto'
import { FilaForaLocal, type MarcacaoFora } from '@/components/rh/FilaForaLocal'
import type { LocalRh } from '@/app/actions/rh-local'
import { JornadaEditor, type JornadaVals } from '../JornadaEditor'
import { ImportarPontomais } from './ImportarPontomais'

interface Colab { nome: string | null }
/** Blocos previstos da jornada da pessoa (personalizada, senão a padrão da org). */
export interface JornadaResumo { entrada: string; intervalo_ini: string; intervalo_fim: string; saida: string }
/** Justificativa (de qualquer status) cujo período cobre o dia da extra. */
export interface JustDoDia { tipo: string; descricao: string | null; status: string }
export interface ExtraPend {
  id: string; data: string; minutos: number; saldo_min: number; acima_10h: boolean
  colaborador_id: string
  /** Motivo vindo do relatório importado (Pontomais) — dia do Flow não preenche. */
  motivo: string | null
  /** Marcações reais do dia, HH:MM em ordem cronológica. */
  batidas: string[]
  jornada: JornadaResumo | null
  justs: JustDoDia[]
  rh_colaborador: Colab | null
}
export interface JustPend {
  id: string; colaborador_id: string; data_ini: string; data_fim: string
  tipo: string; descricao: string | null; status: string
  /** Anexo enviado junto da justificativa (atestado, declaração). */
  doc_id: string | null
  /** Dia completo proposto em N pares (mig. 222). */
  marcacoes: string[] | null
  /** Campos legados (justificativa anterior à 222): posições, não lista. */
  hora_entrada: string | null; hora_intervalo_ini: string | null
  hora_intervalo_fim: string | null; hora_saida: string | null
  /** Período coberto pelo documento — só ele sai da carga do dia (mig. 212). */
  ausencia_ini: string | null; ausencia_fim: string | null
  /** Marcações ATUAIS do dia (preenchidas pela page) — base do editor. */
  atuais?: string[]
  rh_colaborador: Colab | null
}

const DIA_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
// Date com números locais, nunca new Date('yyyy-mm-dd') — a string é UTC e em BRT
// cairia no dia anterior.
const dataBR = (d: string) => { const [y, m, dd] = d.split('-'); return `${DIA_SEM[new Date(+y, +m - 1, +dd).getDay()]} ${dd}/${m}/${y}` }
const saldoStr = (m: number) => `+${Math.floor(Math.abs(m) / 60)}h${String(Math.abs(m) % 60).padStart(2, '0')}`
const hStr = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
const TIPO: Record<string, string> = { esqueci: 'Esqueceu de bater', atestado: 'Atestado', medico: 'Consulta médica', falta: 'Falta', outro: 'Outro' }
const JUST_STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: 'pendente', cls: 'text-amber-600' },
  aprovado: { label: 'aprovada', cls: 'text-emerald-600' },
  abonado: { label: 'abonada', cls: 'text-emerald-600' },
  rejeitado: { label: 'rejeitada', cls: 'text-gray-400' },
  falta: { label: 'virou falta', cls: 'text-red-500' },
}

const hhmm = (t: string | null) => (t ?? '').slice(0, 5)

/** Sinaliza qual batida puxou a extra (chegou antes / almoçou menos / saiu depois).
 *  É só destaque visual — a conta oficial é a do banco (rh_saldo_tolerado, sobre o
 *  TOTAL do dia). Com 4 marcações compara posição a posição; senão, só as pontas. */
function batidasFora(batidas: string[], j: JornadaResumo | null, esperado: number): boolean[] {
  const out = batidas.map(() => false)
  if (!j || esperado <= 0 || !batidas.length) return out
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const prev = [j.entrada, j.intervalo_ini, j.intervalo_fim, j.saida].map(t => toMin(hhmm(t)))
  const b = batidas.map(toMin)
  const LIMIAR = 5
  if (b.length === 4) {
    out[0] = prev[0] - b[0] >= LIMIAR
    out[1] = b[1] - prev[1] >= LIMIAR
    out[2] = prev[2] - b[2] >= LIMIAR
    out[3] = b[3] - prev[3] >= LIMIAR
  } else {
    out[0] = prev[0] - b[0] >= LIMIAR
    out[b.length - 1] = out[b.length - 1] || b[b.length - 1] - prev[3] >= LIMIAR
  }
  return out
}

/** O dia como a aprovação deixaria: a lista da justificativa quando existe;
 *  senão, as marcações atuais com os campos legados aplicados por POSIÇÃO
 *  (espelha o merge da migration 222, incluindo o dia ímpar). */
function diaProposto(j: JustPend): string[] {
  if (j.marcacoes?.length) return j.marcacoes
  const m = j.atuais ?? []
  const n = m.length
  const e = hhmm(j.hora_entrada) || m[0] || ''
  const ii = hhmm(j.hora_intervalo_ini) || (n >= 3 ? m[1] : '')
  const iF = hhmm(j.hora_intervalo_fim) || (n >= 3 ? m[2] : '')
  const s = hhmm(j.hora_saida) || (n >= 2 && n % 2 === 0 ? m[n - 1] : '')
  const extras = n >= 5 ? m.slice(3, n % 2 === 0 ? n - 1 : n) : []
  const lista = [e, ii, iF, ...extras, s].filter(Boolean)
  return lista.length ? lista : ['', '']
}

export function PontoGestaoClient({ orgSlug, extras, justificativas, jornadaPadrao, pontoObrigatorio = false,
  locais = [], fora = [], ipAtual = null }: {
  orgSlug: string; extras: ExtraPend[]; justificativas: JustPend[]
  jornadaPadrao: Partial<JornadaVals> | null
  /** Trava do Flow sem ponto batido (migration 199). */
  pontoObrigatorio?: boolean
  /** Locais autorizados e batidas fora deles (migration 227). */
  locais?: LocalRh[]; fora?: MarcacaoFora[]; ipAtual?: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [obrig, setObrig] = useState(pontoObrigatorio)

  function trocarObrigatorio(v: boolean) {
    setObrig(v)
    start(async () => {
      const r = await setPontoObrigatorio(orgSlug, v)
      if (r?.error) { toast.error(r.error); setObrig(!v); return }
      toast.success(v ? 'A partir de agora o Flow exige ponto batido.' : 'Trava desligada.')
      router.refresh()
    })
  }
  // O dia completo que a aprovação vai gravar, em N pares, pré-carregado com o
  // que a pessoa pediu (ou com as marcações atuais, se ela não pediu correção).
  const [pares, setPares] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(justificativas.map(j => [j.id, diaProposto(j)])))
  const [abonos, setAbonos] = useState<Record<string, { ausIni: string; ausFim: string }>>(() =>
    Object.fromEntries(justificativas.map(j => [j.id, { ausIni: hhmm(j.ausencia_ini), ausFim: hhmm(j.ausencia_fim) }])))
  const setAbono = (id: string, k: 'ausIni' | 'ausFim', v: string) =>
    setAbonos(p => ({ ...p, [id]: { ...(p[id] ?? { ausIni: '', ausFim: '' }), [k]: v } }))

  function extra(id: string, status: string) {
    start(async () => {
      const r = await decidirExtra(orgSlug, id, status)
      if (r?.error) toast.error(r.error); else { toast.success(status === 'aprovado' ? 'Hora extra aprovada.' : 'Hora extra rejeitada.'); router.refresh() }
    })
  }
  function just(id: string, status: string) {
    const j = justificativas.find(x => x.id === id)
    const ab = abonos[id]
    // Só manda a lista se ela difere das marcações atuais do dia — aprovar sem
    // mudança não pode gerar um "ajuste" que regrava o dia igual.
    let marcacoes: string[] | undefined
    if (j && j.data_ini === j.data_fim) {
      const v = validarMarcacoes(pares[id] ?? [])
      if (!v.ok) { toast.error(v.erro); return }
      const mudou = v.limpo.join() !== (j.atuais ?? []).join()
      const pedido = (j.marcacoes ?? []).join()
      // Se a pessoa pediu correção e o RH não mexeu, a lista já difere do dia
      // atual e segue mesmo assim — é exatamente o pedido dela.
      if (mudou && v.limpo.join() !== pedido) marcacoes = v.limpo
      else if (!mudou && pedido) marcacoes = []   // RH desfez o pedido: só decide
    }
    start(async () => {
      const r = await decidirJustificativa(orgSlug, id, status, {
        marcacoes,
        ausencia_ini: ab?.ausIni || null, ausencia_fim: ab?.ausFim || null,
      })
      if (r?.error) toast.error(r.error)
      else {
        // Decidir e ajustar são dois atos. Quando o ajuste não passa (competência
        // assinada, dia importado), o aviso é de ERRO — dizer "aprovada" e deixar
        // o saldo errado é o bug que a migration 193 fechou.
        const falhou = r.naoAplicados ?? []
        if (falhou.length) {
          toast.error(`Decidida, mas a marcação NÃO foi ajustada: ${falhou[0].motivo}`, { duration: 10_000 })
        } else {
          toast.success(r.ajustados ? `Aprovada — marcação ajustada (${r.ajustados} dia(s)).` : 'Justificativa decidida.')
        }
        router.refresh()
      }
    })
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1"><Clock className="w-5 h-5 text-orange-600" /> Ponto — aprovações</h1>
          <p className="text-gray-500 text-sm">Horas extras (aprova o gestor) e justificativas (decide o RH).</p>
        </div>
        <ImportarPontomais orgSlug={orgSlug} />
      </div>

      {/* Trava do ponto — para ligar no dia da virada do Pontomais */}
      <section className="mb-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={obrig} disabled={pending}
              onChange={e => trocarObrigatorio(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-orange-600" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-gray-900">Exigir ponto batido para usar o Flow</span>
              <span className="block text-xs text-gray-500 mt-0.5">
                Ligada, quem tem ficha e jornada no dia vê uma tela de “bata o ponto para começar” — com o
                botão que resolve ali mesmo. Não vale em feriado que abona, em dia fora da escala, nem para
                quem não tem ficha. Ligue no dia em que o time sair do Pontomais de vez.
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* Locais de trabalho + fila de batidas fora (mig. 227) */}
      <LocaisPonto orgSlug={orgSlug} locais={locais} ipAtual={ipAtual} />
      <FilaForaLocal orgSlug={orgSlug} itens={fora} />

      {/* Jornada padrão da empresa */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><CalendarClock className="w-4 h-4" /> Jornada padrão da empresa</h2>
        <p className="text-xs text-gray-400 mb-3">O modelo aplicado a quem não tem jornada personalizada. Personalização por pessoa fica na ficha.</p>
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <JornadaEditor orgSlug={orgSlug} colaboradorId={null} inicial={jornadaPadrao} />
        </div>
      </section>

      {/* Horas extras */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Horas extras pendentes <span className="text-gray-400">{extras.length}</span></h2>
        {extras.length === 0 ? (
          <p className="text-sm text-gray-400 py-3">Nada pendente.</p>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
            {extras.map(e => {
              // Carga efetiva do dia já com decisões do RH (abono, feriado, escala):
              // para extra pendente o saldo é cheio, então esperado = trabalhado − saldo.
              const esperado = e.minutos - e.saldo_min
              const fora = batidasFora(e.batidas, e.jornada, esperado)
              return (
                <div key={e.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{e.rh_colaborador?.nome ?? '—'}</div>
                      <div className="text-xs text-gray-500 tabular-nums">{dataBR(e.data)} · saldo <b className="text-emerald-600">{saldoStr(e.saldo_min)}</b>{e.acima_10h && <span className="text-red-500"> · acima de 10h</span>}</div>
                    </div>
                    <button onClick={() => extra(e.id, 'aprovado')} disabled={pending}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-50 transition"><Check className="w-3.5 h-3.5" /> Aprovar</button>
                    <button onClick={() => extra(e.id, 'rejeitado')} disabled={pending}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"><X className="w-3.5 h-3.5" /> Rejeitar</button>
                  </div>
                  <div className="mt-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-[11px] tabular-nums">
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                      <span className="w-14 shrink-0 text-gray-400 font-medium">Previsto</span>
                      {esperado > 0 ? (
                        e.jornada
                          ? <span className="text-gray-600">{hhmm(e.jornada.entrada)}–{hhmm(e.jornada.intervalo_ini)} · {hhmm(e.jornada.intervalo_fim)}–{hhmm(e.jornada.saida)} <span className="text-gray-400">({hStr(esperado)})</span></span>
                          : <span className="text-gray-600">{hStr(esperado)}</span>
                      ) : (
                        <span className="text-gray-500">sem carga no dia (feriado/fim de semana) — extra conta desde o 1º minuto</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                      <span className="w-14 shrink-0 text-gray-400 font-medium">Batido</span>
                      <span className="text-gray-600">
                        {e.batidas.length
                          ? e.batidas.map((h, i) => (
                              <span key={i}>{i > 0 && ' · '}<span className={fora[i] ? 'text-amber-600 font-semibold' : undefined}>{h}</span></span>
                            ))
                          : 'sem marcação'}
                        {' '}<span className="text-gray-400">({hStr(e.minutos)} trabalhadas)</span>
                      </span>
                    </div>
                  </div>
                  {(e.motivo || e.justs.length > 0) && (
                    <div className="mt-1.5 space-y-1">
                      {e.motivo && (
                        <div className="flex items-start gap-1.5 text-[11px] text-gray-600">
                          <FileText className="w-3.5 h-3.5 text-gray-400 mt-px shrink-0" />
                          <span><b className="font-medium">Motivo:</b> {e.motivo}</span>
                        </div>
                      )}
                      {e.justs.map((j, i) => {
                        const st = JUST_STATUS[j.status] ?? { label: j.status, cls: 'text-gray-400' }
                        return (
                          <div key={i} className="flex items-start gap-1.5 text-[11px] text-gray-600">
                            <FileText className="w-3.5 h-3.5 text-gray-400 mt-px shrink-0" />
                            <span>
                              <b className="font-medium">{TIPO[j.tipo] ?? j.tipo}</b>
                              <span className={st.cls}> ({st.label})</span>
                              {j.descricao && <> — {j.descricao}</>}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Justificativas */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><FileText className="w-4 h-4" /> Justificativas pendentes <span className="text-gray-400">{justificativas.length}</span></h2>
        {justificativas.length === 0 ? (
          <p className="text-sm text-gray-400 py-3">Nada pendente.</p>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
            {justificativas.map(j => (
              <div key={j.id} className="px-4 py-3">
                <div className="flex items-start gap-3 mb-2">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">{j.rh_colaborador?.nome ?? '—'} <span className="text-[10px] font-medium text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 ml-1">{TIPO[j.tipo] ?? j.tipo}</span></div>
                    <div className="text-xs text-gray-500 tabular-nums">{dataBR(j.data_ini)}{j.data_fim !== j.data_ini && ` – ${dataBR(j.data_fim)}`}{j.descricao && <span className="text-gray-400"> · {j.descricao}</span>}</div>
                    {/* Atestado abre em aba nova pela rota autenticada — o arquivo
                        mora em rh-privado/ e não tem URL pública. */}
                    {j.doc_id && (
                      <a href={`/api/rh/documento/${j.doc_id}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-1 text-xs font-medium text-orange-700 hover:text-orange-800 transition">
                        <Paperclip className="w-3.5 h-3.5" /> Ver anexo
                      </a>
                    )}
                  </div>
                </div>
                {/* Corrigir marcação só existe em justificativa de UM dia: aprovar
                    aplica as mesmas horas a cada dia do intervalo, o que estaria
                    errado em qualquer dia além do primeiro. */}
                {j.data_ini === j.data_fim && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-2 rounded-lg bg-sky-50 px-2.5 py-2">
                    {/* É este período — e só ele — que sai da carga do dia.
                        Atraso na entrada e volta depois do fim do atendimento
                        continuam descontando (migration 212). */}
                    <span className="text-[11px] text-sky-800 font-medium">Abonar o atendimento das</span>
                    <input type="time" value={abonos[j.id]?.ausIni ?? ''} onChange={e => setAbono(j.id, 'ausIni', e.target.value)}
                      className="px-2 py-1 text-xs bg-white border border-sky-200 rounded-md text-gray-800" />
                    <span className="text-[11px] text-sky-800">às</span>
                    <input type="time" value={abonos[j.id]?.ausFim ?? ''} onChange={e => setAbono(j.id, 'ausFim', e.target.value)}
                      className="px-2 py-1 text-xs bg-white border border-sky-200 rounded-md text-gray-800" />
                    <span className="text-[11px] text-sky-700">
                      — em branco abona o dia inteiro
                    </span>
                  </div>
                )}
                {j.data_ini === j.data_fim ? (
                  <div className="mb-2 rounded-lg bg-gray-50 px-2.5 py-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] text-gray-500 font-medium">Como o dia fica ao aprovar:</span>
                      <span className="text-[11px] text-gray-400 tabular-nums">hoje: {(j.atuais ?? []).join(' · ') || 'sem marcação'}</span>
                    </div>
                    <MarcacoesEditor horas={pares[j.id] ?? ['', '']} onChange={v => setPares(p => ({ ...p, [j.id]: v }))} />
                    <p className="text-[11px] text-gray-400 mt-1.5">Igual às marcações atuais (ou tudo em branco) = só decide, não altera o ponto.</p>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400 mb-2">Vários dias — a decisão vale para os dias inteiros, sem alterar marcação.</p>
                )}
                <div className="flex items-center gap-2">
                  <button onClick={() => just(j.id, 'aprovado')} disabled={pending} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-50 transition"><Check className="w-3.5 h-3.5" /> Aprovar</button>
                  <button onClick={() => just(j.id, 'abonado')} disabled={pending} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-600 text-[#fff] hover:bg-sky-700 disabled:opacity-50 transition"><Check className="w-3.5 h-3.5" /> Abonar</button>
                  <button onClick={() => just(j.id, 'falta')} disabled={pending} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-[#fff] hover:bg-amber-700 disabled:opacity-50 transition"><CalendarX className="w-3.5 h-3.5" /> Dar falta</button>
                  <button onClick={() => just(j.id, 'rejeitado')} disabled={pending} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"><Ban className="w-3.5 h-3.5" /> Rejeitar</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
