'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ClipboardCheck, Plus, Loader2, Sparkles, X, Check, Users, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '@/components/ui/Select'
import { salvarCiclo, semearCompetencias, type Ciclo } from '@/app/actions/rh-avaliacao'

const dataBR = (d: string | null) => d ? d.split('-').reverse().join('/') : '—'

const STATUS: Record<string, { l: string; c: string }> = {
  rascunho:  { l: 'Rascunho',  c: 'bg-gray-100 text-gray-600' },
  aberto:    { l: 'Em curso',  c: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  encerrado: { l: 'Encerrado', c: 'bg-sky-50 text-sky-700 border border-sky-200' },
}

export function AvaliacaoClient({ orgSlug, ciclos, temCompetencias, semFuncao }: {
  orgSlug: string; ciclos: Ciclo[]; temCompetencias: boolean
  semFuncao: { id: string; nome: string }[]
}) {
  const router = useRouter()
  const [novo, setNovo] = useState(false)
  const [pending, start] = useTransition()

  function semear() {
    start(async () => {
      const r = await semearCompetencias(orgSlug)
      if (r?.error) toast.error(r.error)
      else { toast.success(`${r.criadas} competências criadas. Ajuste o texto quando quiser.`); router.refresh() }
    })
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
            <ClipboardCheck className="w-5 h-5 text-orange-600" /> Avaliação
          </h1>
          <p className="text-gray-500 text-sm">Ciclos de 360, autoavaliação e clima. O resultado é agregado — nunca uma nota solta.</p>
        </div>
        <button onClick={() => setNovo(true)} disabled={!temCompetencias}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-40 transition">
          <Plus className="w-4 h-4" /> Novo ciclo
        </button>
      </div>

      {!temCompetencias && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50/60 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 mb-1">
            <Sparkles className="w-4 h-4 text-orange-600" /> Comece pelo questionário
          </h2>
          <p className="text-sm text-gray-600 mb-3">
            Vou criar o núcleo comum (prazo, qualidade, colaboração, comunicação, autonomia, feedback)
            e os blocos por função — redação, design, atendimento, mídia, gestão e administrativo.
            Cada competência já vem com âncora de comportamento; você edita o texto depois.
          </p>
          <button onClick={semear} disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Criar competências
          </button>
        </div>
      )}

      {temCompetencias && semFuncao.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-6 text-sm text-amber-800">
          <b>{semFuncao.length} pessoa{semFuncao.length > 1 ? 's' : ''} sem função de avaliação</b> ({semFuncao.map(s => s.nome.split(' ')[0]).join(', ')}).
          Elas respondem só o núcleo comum. Defina a função na ficha, em RH → Pessoas.
        </div>
      )}

      {ciclos.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">Nenhum ciclo ainda.</p>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
          {ciclos.map(c => {
            const s = STATUS[c.status] ?? STATUS.rascunho
            return (
              <Link key={c.id} href={`/${orgSlug}/rh/avaliacao/${c.id}`}
                className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50/70 transition">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                    {c.nome}
                    <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 ${s.c}`}>{s.l}</span>
                    {c.tipo === 'clima' && <span className="text-[10px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">Clima</span>}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className="tabular-nums">{dataBR(c.abre_em)} – {dataBR(c.fecha_em)}</span>
                    <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> mín. {c.min_respondentes} respondentes</span>
                    {!c.ident_ascendente && (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <Lock className="w-3 h-3" /> feedback para o gestor é anônimo
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {novo && <NovoCiclo orgSlug={orgSlug} onClose={() => setNovo(false)} />}
    </div>
  )
}

function NovoCiclo({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  const router = useRouter()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('360')
  const [abre, setAbre] = useState(hoje)
  const [fecha, setFecha] = useState('')
  const [min, setMin] = useState(3)
  const [identPar, setIdentPar] = useState(true)
  const [identAsc, setIdentAsc] = useState(false)
  const [saving, start] = useTransition()
  const [down, setDown] = useState(false)

  function salvar() {
    if (!nome.trim()) { toast.error('Dê um nome ao ciclo.'); return }
    if (fecha && fecha < abre) { toast.error('O fim não pode ser antes do começo.'); return }
    start(async () => {
      const r = await salvarCiclo(orgSlug, null, {
        nome, tipo, abre_em: abre || null, fecha_em: fecha || null,
        min_respondentes: min, ident_par: identPar, ident_ascendente: identAsc,
      })
      if (r?.error) toast.error(r.error)
      else { toast.success('Ciclo criado. Agora monte a matriz.'); router.push(`/${orgSlug}/rh/avaliacao/${r.id}`) }
    })
  }

  const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onMouseDown={() => setDown(true)}
      onClick={e => { if (down && e.target === e.currentTarget) onClose(); setDown(false) }}>
      <div className="modal-card w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Novo ciclo</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">Nome</label>
            <input value={nome} onChange={e => setNome(e.target.value)} className={inputCls}
              placeholder="ex.: 2º semestre de 2026" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">Tipo</label>
            <Select value={tipo} onChange={setTipo} options={[
              { value: '360', label: '360 — avaliação de pessoas' },
              { value: 'clima', label: 'Clima — percepção sobre a empresa' },
            ]} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1.5">Abre em</label>
              <input type="date" value={abre} onChange={e => setAbre(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1.5">Fecha em</label>
              <input type="date" value={fecha} min={abre} onChange={e => setFecha(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="rounded-xl bg-gray-50 p-4 space-y-3">
            <div className="text-xs font-medium text-gray-600">Privacidade</div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Mínimo de respondentes para mostrar a média de um grupo</label>
              <input type="number" min={1} max={10} value={min} onChange={e => setMin(Number(e.target.value))}
                className="w-20 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-orange-500" />
              <p className="text-[11px] text-gray-400 mt-1">
                Abaixo disso a média do grupo não aparece. Num time de 10, mostrar a média de 2 pessoas
                é quase dizer quem falou.
              </p>
            </div>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={identPar} onChange={e => setIdentPar(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-orange-600" />
              <span className="text-[12px] text-gray-600">
                <b className="text-gray-900">Gestor e RH veem o nome de quem respondeu</b> (avaliação entre colegas).
                A pessoa avaliada nunca vê nomes.
              </span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={identAsc} onChange={e => setIdentAsc(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-orange-600" />
              <span className="text-[12px] text-gray-600">
                <b className="text-gray-900">…inclusive quando alguém avalia o próprio gestor.</b>{' '}
                <span className="text-amber-700">Deixe desmarcado:</span> é o único caso com risco de retaliação —
                identificado, o liderado tende a dizer só o que agrada.
              </span>
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          <button onClick={salvar} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Criar
          </button>
        </div>
      </div>
    </div>
  )
}
