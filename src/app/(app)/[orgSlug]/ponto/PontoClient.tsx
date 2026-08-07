'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, LogIn, Coffee, Undo2, Loader2, FileText, Check, FileSignature, Paperclip, X } from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '@/components/ui/Select'
import { MarcacoesEditor, validarMarcacoes } from '@/components/ponto/MarcacoesEditor'
import { downscaleImage } from '@/lib/image-resize'
import { baterPonto, criarJustificativa } from '@/app/actions/rh-ponto'

export interface PontoDia {
  data: string; entrada: string | null; intervalo_ini: string | null; intervalo_fim: string | null
  saida: string | null; minutos: number; saldo_min: number; acima_10h: boolean; extra_status: string | null
  // Marcação original, quando o RH ajustou o ponto via justificativa aprovada.
  ajuste_de?: { entrada?: string; intervalo_ini?: string; intervalo_fim?: string; saida?: string } | null
  ajuste_em?: string | null
  // Lista aberta de marcações do dia (N pares) + diagnóstico do almoço.
  marcacoes?: string[]
  intervalo_maior_min?: number | null
  intervalo_ok?: boolean | null
}

const hm = (t: string | null) => t ? t.slice(0, 5) : '—'
const saldoStr = (m: number) => { const s = m < 0 ? '-' : '+'; const a = Math.abs(m); return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}` }
const dataBR = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}` }

export function PontoClient({ orgSlug, colaboradorId, nome, diaHoje, recentes }: {
  orgSlug: string; colaboradorId: string; nome: string; hoje: string; diaHoje: PontoDia | null; recentes: PontoDia[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [just, setJust] = useState(false)
  const d = diaHoje

  // N marcações livres: ímpar = está trabalhando (próxima é saída/pausa),
  // par = está fora (próxima é entrada/retorno).
  const horas = d?.marcacoes ?? []
  const dentro = horas.length % 2 === 1
  const proxima = horas.length === 0
    ? { label: 'Entrada', icon: LogIn }
    : dentro ? { label: 'Saída (pausa ou fim do dia)', icon: Coffee }
             : { label: 'Retorno', icon: Undo2 }

  function bater() {
    start(async () => {
      const r = await baterPonto(orgSlug, colaboradorId)
      if (r?.error) toast.error(r.error)
      else { toast.success('Ponto registrado!'); router.refresh() }
    })
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Clock className="w-5 h-5 text-orange-600" /> Meu ponto</h1>
          <p className="text-gray-500 text-sm mt-0.5">{nome} · jornada 8h30–12h · 13h30–18h (mín. 1h de intervalo)</p>
        </div>
        <button onClick={() => setJust(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition">
          <FileText className="w-4 h-4" /> Justificar
        </button>
        <a href={`/${orgSlug}/ponto/espelho`}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
          <FileSignature className="w-4 h-4" /> Meu espelho
        </a>
      </div>

      {/* Marcações de hoje */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        {horas.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4 mb-2">Nenhuma marcação hoje.</p>
        ) : (
          <div className="flex flex-wrap gap-2 mb-5">
            {horas.map((h, i) => (
              <div key={i} className="rounded-xl border border-orange-200 bg-orange-50/50 px-3 py-2 text-center min-w-[5rem]">
                <div className="text-[11px] text-gray-400">{i === 0 ? 'Entrada' : i % 2 === 1 ? 'Saída' : 'Retorno'}</div>
                <div className="text-base font-semibold tabular-nums text-gray-900">{hm(h)}</div>
              </div>
            ))}
          </div>
        )}

        <button onClick={bater} disabled={pending}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-orange-600 text-[#fff] font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
          {pending ? <Loader2 className="w-5 h-5 animate-spin" /> : <proxima.icon className="w-5 h-5" />} Bater {proxima.label.toLowerCase()}
        </button>
        <p className="text-[11px] text-gray-400 text-center mt-2">
          Pode pausar quantas vezes precisar. Só o almoço (o maior intervalo do dia) precisa ter no mínimo 1h.
          Hora além da jornada <b className="text-amber-700">só é computada depois de aprovada</b> pelo gestor.
        </p>

        {d && !dentro && horas.length > 0 && (
          <div className="text-center pt-3 mt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">Trabalhado: <b className="tabular-nums">{Math.floor(d.minutos / 60)}h{String(d.minutos % 60).padStart(2, '0')}</b> · saldo <b className={`tabular-nums ${d.saldo_min < 0 ? 'text-red-600' : d.saldo_min > 0 ? 'text-emerald-600' : 'text-gray-500'}`}>{saldoStr(d.saldo_min)}</b>{d.extra_status === 'pendente' && ' · extra aguardando o gestor'}</p>
            {d.intervalo_ok === false && (
              <p className="text-[11px] text-amber-700 mt-1 inline-flex items-center gap-1">
                <Check className="w-3 h-3" /> Almoço de {Math.floor((d.intervalo_maior_min ?? 0) / 60)}h{String((d.intervalo_maior_min ?? 0) % 60).padStart(2, '0')} — abaixo de 1h, o RH vai revisar.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Últimos dias */}
      {recentes.length > 0 && (
        <div className="mt-5 rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-medium text-gray-400 border-b border-gray-100">Últimos dias</div>
          <table className="w-full text-sm">
            <tbody>
              {recentes.map(r => (
                <tr key={r.data} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2 text-gray-500 tabular-nums">{dataBR(r.data)}</td>
                  <td className="px-2 py-2 text-gray-600 tabular-nums">
                    {hm(r.entrada)}–{hm(r.intervalo_ini)} · {hm(r.intervalo_fim)}–{hm(r.saida)}
                    {r.ajuste_em && (
                      <span title={`Ajustado pelo RH. Marcação original: ${[r.ajuste_de?.entrada, r.ajuste_de?.saida].filter(Boolean).map(t => hm(t as string)).join(' – ') || '—'}`}
                        className="ml-1.5 text-[10px] text-amber-600">ajustado</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-500 tabular-nums">{Math.floor(r.minutos / 60)}h{String(r.minutos % 60).padStart(2, '0')}</td>
                  <td className={`px-4 py-2 text-right tabular-nums font-medium ${r.saldo_min < 0 ? 'text-red-600' : r.saldo_min > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{saldoStr(r.saldo_min)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {just && <JustificarModal orgSlug={orgSlug} colaboradorId={colaboradorId}
        dias={Object.fromEntries([...(d ? [d] : []), ...recentes].map(r => [r.data, (r.marcacoes ?? []).map(h => h.slice(0, 5))]))}
        onClose={() => setJust(false)} />}
    </div>
  )
}

/** Tipos que podem cobrir mais de um dia. "Esqueci de bater" e "Consulta médica"
 *  são sempre de UM dia — e é justamente neles que o horário correto é pedido. */
const TIPOS_MULTIDIA = new Set(['atestado', 'falta', 'outro'])

function JustificarModal({ orgSlug, colaboradorId, dias, onClose }: {
  orgSlug: string; colaboradorId: string
  /** Marcações atuais por data (hoje + últimos dias) — pré-carregam o editor. */
  dias: Record<string, string[]>
  onClose: () => void
}) {
  const router = useRouter()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const [tipo, setTipo] = useState('esqueci')
  const [dia, setDia] = useState(hoje)
  // Período (N dias) é exceção, não o padrão: o normal é justificar UM dia.
  const [varios, setVarios] = useState(false)
  const [dataFim, setDataFim] = useState(hoje)
  const [descricao, setDescricao] = useState('')
  // O dia completo em N pares, pré-carregado com as marcações reais do dia
  // escolhido: corrija um horário, complete o que faltou ou adicione uma pausa.
  const prefill = (data: string) => { const m = dias[data] ?? []; return m.length ? m : ['', ''] }
  const [horas, setHoras] = useState<string[]>(() => prefill(hoje))
  const [arquivo, setArquivo] = useState<File | null>(null)
  // Período que o atestado/declaração cobre. É o que sai da carga do dia — o
  // resto (atraso na entrada, volta depois do fim da consulta) continua contando.
  const [ausIni, setAusIni] = useState('')
  const [ausFim, setAusFim] = useState('')
  const [saving, start] = useTransition()

  const podeMultidia = TIPOS_MULTIDIA.has(tipo)
  // Período e correção de horário não convivem: a aprovação aplica as MESMAS
  // horas em cada dia do intervalo, o que seria errado em qualquer dia além do
  // primeiro. Com vários dias, o RH abona/dá falta ao dia inteiro.
  const periodo = podeMultidia && varios

  function trocarTipo(t: string) {
    setTipo(t)
    if (!TIPOS_MULTIDIA.has(t)) { setVarios(false); setDataFim(dia) }
  }

  function enviar() {
    const fim = periodo ? dataFim : dia
    if (fim < dia) { toast.error('O último dia não pode ser antes do primeiro.'); return }
    // Só envia correção se a lista mudou de verdade em relação às marcações
    // atuais do dia — enviar o dia igual criaria um "ajuste" que não muda nada.
    let marcacoes: string[] | null = null
    if (!periodo) {
      const v = validarMarcacoes(horas)
      if (!v.ok) { toast.error(v.erro); return }
      const atual = dias[dia] ?? []
      if (v.limpo.join() !== atual.join()) marcacoes = v.limpo.length ? v.limpo : null
    }
    start(async () => {
      // O anexo sobe primeiro: sem doc_id a justificativa seria criada e o
      // arquivo se perderia se o upload falhasse depois.
      let docId: string | null = null
      if (arquivo) {
        // Imagem vira WebP reduzido no cliente (padrão do app); PDF sobe como está.
        const enviar = arquivo.type.startsWith('image/') ? await downscaleImage(arquivo) : arquivo
        const fd = new FormData()
        fd.append('colaboradorId', colaboradorId)
        fd.append('file', enviar)
        const resp = await fetch('/api/rh/justificativa/anexo', { method: 'POST', body: fd })
        const json = await resp.json().catch(() => ({}))
        if (!resp.ok) { toast.error(json?.error || 'Falha ao enviar o anexo.'); return }
        docId = json.doc_id ?? null
      }

      const r = await criarJustificativa(orgSlug, colaboradorId, {
        tipo, data_ini: dia, data_fim: fim, descricao, doc_id: docId,
        ausencia_ini: periodo ? null : (ausIni || null),
        ausencia_fim: periodo ? null : (ausFim || null),
        marcacoes,
      })
      if (r?.error) toast.error(r.error)
      else { toast.success('Justificativa enviada ao RH.'); onClose(); router.refresh() }
    })
  }

  const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'
  const horaCls = 'w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'
  const subCls = 'block text-[11px] text-gray-500 mb-1'

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-md max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100"><h2 className="text-base font-semibold text-gray-900">Justificar ocorrência</h2>
          <p className="text-xs text-gray-500 mt-0.5">Vai para o RH decidir (aprovar, abonar ou dar falta).</p></div>
        <div className="px-6 py-5 space-y-3">
          <div><label className="block text-sm text-gray-600 mb-1.5">Tipo</label>
            <Select value={tipo} onChange={trocarTipo} options={[
              { value: 'esqueci', label: 'Esqueci de bater' }, { value: 'atestado', label: 'Atestado médico' },
              { value: 'medico', label: 'Consulta médica' }, { value: 'falta', label: 'Falta' }, { value: 'outro', label: 'Outro' },
            ]} /></div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm text-gray-600">{periodo ? 'Primeiro dia' : 'Dia'}</label>
              {podeMultidia && (
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                  <input type="checkbox" checked={varios}
                    onChange={e => { setVarios(e.target.checked); if (e.target.checked && dataFim < dia) setDataFim(dia) }}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
                  Mais de um dia
                </label>
              )}
            </div>
            <div className={periodo ? 'grid grid-cols-2 gap-3' : ''}>
              <input type="date" value={dia}
                onChange={e => { setDia(e.target.value); setHoras(prefill(e.target.value)) }}
                className={inputCls} />
              {periodo && (
                <div>
                  <input type="date" value={dataFim} min={dia} onChange={e => setDataFim(e.target.value)} className={inputCls} />
                  <p className="text-[11px] text-gray-400 mt-1">último dia</p>
                </div>
              )}
            </div>
          </div>

          {periodo ? (
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
              Justificativa de vários dias cobre os dias inteiros. Para corrigir horário de marcação, envie uma justificativa por dia.
            </p>
          ) : (
            <div className="rounded-xl bg-gray-50 p-3 space-y-3">
              <div>
                <div className="text-xs font-medium text-gray-600">Horário correto <span className="font-normal text-gray-400">(opcional)</span></div>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Monte o dia como ele deveria ficar: corrija um horário, complete o que
                  faltou ou adicione um par para uma pausa. Sem mudança, nada é corrigido.
                </p>
              </div>
              <MarcacoesEditor horas={horas} onChange={setHoras} />
              <p className="text-[11px] text-gray-400">Ex.: chegou 8h39 e só bateu 9h37 → corrija a Entrada. Ao aprovar, o RH grava essas marcações — a original fica no histórico.</p>
            </div>
          )}

          <div><label className="block text-sm text-gray-600 mb-1.5">Descrição</label><textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2} className={inputCls} placeholder="Opcional" /></div>

          {!periodo && (
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-xs font-medium text-gray-600">
                Horário do atendimento <span className="font-normal text-gray-400">(opcional)</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 mb-2">
                O que está na declaração (&ldquo;das 13:00 às 14:00&rdquo;). Só este período sai da
                sua jornada — atraso na entrada ou na volta continua contando.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={subCls}>Das</label>
                  <input type="time" value={ausIni} onChange={e => setAusIni(e.target.value)} className={horaCls} /></div>
                <div><label className={subCls}>Às</label>
                  <input type="time" value={ausFim} onChange={e => setAusFim(e.target.value)} className={horaCls} /></div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-600 mb-1.5">
              Anexo <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            {arquivo ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl">
                <Paperclip className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="text-sm text-gray-700 truncate flex-1">{arquivo.name}</span>
                <button type="button" onClick={() => setArquivo(null)} disabled={saving}
                  className="text-gray-400 hover:text-red-600 transition disabled:opacity-40" title="Remover">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-2 px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-500 cursor-pointer hover:bg-gray-200 transition">
                <Paperclip className="w-4 h-4" />
                Escolher PDF ou imagem
                <input type="file" accept="application/pdf,image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) setArquivo(f); e.target.value = '' }} />
              </label>
            )}
            <p className="text-[11px] text-gray-400 mt-1">
              Atestado, declaração de comparecimento. Só o RH e você enxergam.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          <button onClick={enviar} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Enviar
          </button>
        </div>
      </div>
    </div>
  )
}
