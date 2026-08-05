'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, FileText, Check, X, Ban, CalendarX, CalendarClock, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { decidirExtra, decidirJustificativa, setPontoObrigatorio } from '@/app/actions/rh-ponto'
import { JornadaEditor, type JornadaVals } from '../JornadaEditor'
import { ImportarPontomais } from './ImportarPontomais'

interface Colab { nome: string | null }
export interface ExtraPend { id: string; data: string; minutos: number; saldo_min: number; acima_10h: boolean; rh_colaborador: Colab | null }
export interface JustPend {
  id: string; data_ini: string; data_fim: string; tipo: string; descricao: string | null; status: string
  /** Anexo enviado junto da justificativa (atestado, declaração). */
  doc_id: string | null
  hora_entrada: string | null; hora_intervalo_ini: string | null
  hora_intervalo_fim: string | null; hora_saida: string | null
  rh_colaborador: Colab | null
}

const dataBR = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}` }
const saldoStr = (m: number) => `+${Math.floor(Math.abs(m) / 60)}h${String(Math.abs(m) % 60).padStart(2, '0')}`
const TIPO: Record<string, string> = { esqueci: 'Esqueceu de bater', atestado: 'Atestado', medico: 'Consulta médica', falta: 'Falta', outro: 'Outro' }

const hhmm = (t: string | null) => (t ?? '').slice(0, 5)

interface MarcHoras { ent: string; intIni: string; intFim: string; sai: string }
const VAZIO: MarcHoras = { ent: '', intIni: '', intFim: '', sai: '' }

export function PontoGestaoClient({ orgSlug, extras, justificativas, jornadaPadrao, pontoObrigatorio = false }: {
  orgSlug: string; extras: ExtraPend[]; justificativas: JustPend[]
  jornadaPadrao: Partial<JornadaVals> | null
  /** Trava do Flow sem ponto batido (migration 199). */
  pontoObrigatorio?: boolean
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
  // As 4 marcações que o RH vai gravar ao aprovar, pré-carregadas com o que a
  // pessoa pediu. Precisam ser as QUATRO: a action regrava as quatro colunas, e
  // mandar só entrada/saída apagaria o intervalo que a pessoa tinha informado.
  const [horas, setHoras] = useState<Record<string, MarcHoras>>(() =>
    Object.fromEntries(justificativas.map(j => [j.id, {
      ent: hhmm(j.hora_entrada), intIni: hhmm(j.hora_intervalo_ini),
      intFim: hhmm(j.hora_intervalo_fim), sai: hhmm(j.hora_saida),
    }])))
  const setHora = (id: string, k: keyof MarcHoras, v: string) =>
    setHoras(p => ({ ...p, [id]: { ...(p[id] ?? VAZIO), [k]: v } }))

  function extra(id: string, status: string) {
    start(async () => {
      const r = await decidirExtra(orgSlug, id, status)
      if (r?.error) toast.error(r.error); else { toast.success(status === 'aprovado' ? 'Hora extra aprovada.' : 'Hora extra rejeitada.'); router.refresh() }
    })
  }
  function just(id: string, status: string) {
    const h = horas[id]
    start(async () => {
      const r = await decidirJustificativa(orgSlug, id, status, {
        hora_entrada: h?.ent || null, hora_intervalo_ini: h?.intIni || null,
        hora_intervalo_fim: h?.intFim || null, hora_saida: h?.sai || null,
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
            {extras.map(e => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">{e.rh_colaborador?.nome ?? '—'}</div>
                  <div className="text-xs text-gray-500 tabular-nums">{dataBR(e.data)} · saldo <b className="text-emerald-600">{saldoStr(e.saldo_min)}</b>{e.acima_10h && <span className="text-red-500"> · acima de 10h</span>}</div>
                </div>
                <button onClick={() => extra(e.id, 'aprovado')} disabled={pending}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-50 transition"><Check className="w-3.5 h-3.5" /> Aprovar</button>
                <button onClick={() => extra(e.id, 'rejeitado')} disabled={pending}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"><X className="w-3.5 h-3.5" /> Rejeitar</button>
              </div>
            ))}
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
                {j.data_ini === j.data_fim ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-2 rounded-lg bg-gray-50 px-2.5 py-2">
                    <span className="text-[11px] text-gray-500">Corrigir marcação:</span>
                    {([['ent', 'entrada'], ['intIni', 'saída p/ intervalo'], ['intFim', 'volta'], ['sai', 'saída']] as const).map(([k, rotulo]) => (
                      <span key={k} className="inline-flex items-center gap-1">
                        <label className="text-[11px] text-gray-400">{rotulo}</label>
                        <input type="time" value={horas[j.id]?.[k] ?? ''} onChange={e => setHora(j.id, k, e.target.value)}
                          className="px-2 py-1 text-xs bg-white border border-gray-200 rounded-md text-gray-800" />
                      </span>
                    ))}
                    <span className="text-[11px] text-gray-400">— tudo em branco = só decide, não altera o ponto</span>
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
