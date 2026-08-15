'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Plus, Power, Repeat, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { salvarRotina, ativarRotinaCatalogo, type RotinaInput } from '@/app/actions/midia-hub'

export interface RotinaCat {
  id: string; nome: string; descricao: string | null
  frequencia: string; dia_mes: number | null; dia_semana: number | null
  status_retorno: string; pasta: string | null
  padrao: boolean; ordem: number; ativo: boolean
}

const FREQUENCIAS = [
  { value: 'weekly', label: 'Semanal' },
  { value: 'biweekly', label: 'Quinzenal' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'bimonthly', label: 'Bimestral' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'semiannual', label: 'Semestral' },
  { value: 'annual', label: 'Anual' },
]
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

/** Só a frequência semanal usa dia da semana; as demais usam dia do mês. */
const usaDiaSemana = (f: string) => f === 'weekly' || f === 'biweekly'

function quando(r: RotinaCat): string {
  const base = FREQUENCIAS.find(f => f.value === r.frequencia)?.label ?? r.frequencia
  if (r.dia_mes) return `${base} · dia ${r.dia_mes}`
  if (r.dia_semana != null) return `${base} · ${DIAS_SEMANA[r.dia_semana].toLowerCase()}`
  return base
}

export function RotinasCatalogo({ orgSlug, rotinas, status, uso }: {
  orgSlug: string
  rotinas: RotinaCat[]
  status: { valor: string; label: string }[]
  uso: Record<string, number>
}) {
  const [editando, setEditando] = useState<RotinaCat | 'nova' | null>(null)
  const ativas = rotinas.filter(r => r.ativo)
  const inativas = rotinas.filter(r => !r.ativo)

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Catálogo de rotinas</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            O que a mídia repete em todo cliente. Cada rotina vira uma tarefa recorrente quando você a
            cria num cliente — mudar aqui não mexe nas tarefas que já existem.
          </p>
        </div>
        <button onClick={() => setEditando('nova')}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors">
          <Plus className="w-4 h-4" /> Nova rotina
        </button>
      </div>

      <ul className="space-y-2">
        {ativas.map(r => <Linha key={r.id} orgSlug={orgSlug} r={r} usos={uso[r.id] ?? 0} onEditar={() => setEditando(r)} />)}
      </ul>

      {inativas.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Desativadas <span className="text-gray-300 font-normal">· {inativas.length}</span>
          </h2>
          <ul className="space-y-2">
            {inativas.map(r => <Linha key={r.id} orgSlug={orgSlug} r={r} usos={uso[r.id] ?? 0} onEditar={() => setEditando(r)} />)}
          </ul>
        </section>
      )}

      {editando && (
        <ModalRotina orgSlug={orgSlug} status={status}
          rotina={editando === 'nova' ? null : editando}
          proximaOrdem={(rotinas.at(-1)?.ordem ?? 0) + 10}
          onClose={() => setEditando(null)} />
      )}
    </div>
  )
}

function Linha({ orgSlug, r, usos, onEditar }: {
  orgSlug: string; r: RotinaCat; usos: number; onEditar: () => void
}) {
  const [pending, start] = useTransition()
  function alterna() {
    start(async () => {
      const res = await ativarRotinaCatalogo(orgSlug, r.id, !r.ativo)
      if (res?.error) toast.error(res.error)
      else toast.success(r.ativo ? 'Rotina desativada. As tarefas já criadas continuam.' : 'Rotina reativada.')
    })
  }
  return (
    <li className={cn('bg-white border rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap',
      r.ativo ? 'border-gray-200' : 'border-gray-100 opacity-60')}>
      <button onClick={onEditar} className="min-w-0 flex-1 text-left">
        <span className="text-sm font-medium text-gray-900 block truncate">{r.nome}</span>
        <span className="text-[11px] text-gray-400 inline-flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1"><Repeat className="w-3 h-3" /> {quando(r)}</span>
          {r.pasta && <span className="inline-flex items-center gap-1"><FolderOpen className="w-3 h-3" /> {r.pasta}</span>}
          {r.padrao && <span className="text-emerald-600">sugerida por padrão</span>}
        </span>
      </button>
      {usos > 0 && (
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0 tabular-nums">
          {usos} cliente{usos === 1 ? '' : 's'}
        </span>
      )}
      <button onClick={alterna} disabled={pending} title={r.ativo ? 'Desativar' : 'Reativar'}
        className={cn('shrink-0 transition-colors', r.ativo ? 'text-gray-300 hover:text-red-600' : 'text-gray-300 hover:text-emerald-600')}>
        {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
      </button>
    </li>
  )
}

function ModalRotina({ orgSlug, status, rotina, proximaOrdem, onClose }: {
  orgSlug: string
  status: { valor: string; label: string }[]
  rotina: RotinaCat | null
  proximaOrdem: number
  onClose: () => void
}) {
  const [pending, start] = useTransition()
  const [form, setForm] = useState({
    nome: rotina?.nome ?? '',
    descricao: rotina?.descricao ?? '',
    frequencia: rotina?.frequencia ?? 'monthly',
    diaMes: rotina?.dia_mes != null ? String(rotina.dia_mes) : '',
    diaSemana: rotina?.dia_semana != null ? String(rotina.dia_semana) : '',
    statusRetorno: rotina?.status_retorno ?? 'midia',
    pasta: rotina?.pasta ?? '',
    padrao: rotina?.padrao ?? true,
  })
  const semanal = usaDiaSemana(form.frequencia)

  function salvar() {
    if (!form.nome.trim()) { toast.error('Dê um nome à rotina.'); return }
    const dados: RotinaInput = {
      id: rotina?.id ?? null,
      nome: form.nome,
      descricao: form.descricao,
      frequencia: form.frequencia,
      // Guarda só o que a frequência usa: dia do mês numa rotina semanal ficaria
      // órfão e voltaria a valer se alguém trocasse a frequência depois.
      diaMes: !semanal && form.diaMes ? Number(form.diaMes) : null,
      diaSemana: semanal && form.diaSemana ? Number(form.diaSemana) : null,
      statusRetorno: form.statusRetorno,
      pasta: form.pasta,
      padrao: form.padrao,
      ordem: rotina?.ordem ?? proximaOrdem,
    }
    start(async () => {
      const r = await salvarRotina(orgSlug, dados)
      if ('error' in r && r.error) { toast.error(r.error); return }
      toast.success(rotina ? 'Rotina atualizada.' : 'Rotina criada.')
      onClose()
    })
  }

  const campo = 'w-full mt-0.5 bg-gray-100 border border-transparent rounded-xl px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:bg-white focus:border-orange-300 focus:outline-none transition-colors'

  return (
    <Modal open onClose={onClose} size="xl" label={rotina ? 'Editar rotina' : 'Nova rotina'}
      dismissOnBackdrop={false} dismissable={!pending}>
      <ModalHeader title={rotina ? 'Editar rotina' : 'Nova rotina'} onClose={onClose} />
      <div className="space-y-3 px-6 py-5">
        <label className="block">
          <span className="text-[11px] text-gray-400">Nome</span>
          <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
            placeholder="Liberação de mídia mensal" className={campo} />
        </label>

        <label className="block">
          <span className="text-[11px] text-gray-400">O que precisa ser feito</span>
          <input value={form.descricao} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
            placeholder="Vai na descrição da tarefa criada" className={campo} />
        </label>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] text-gray-400">Com que frequência</span>
            <div className="mt-0.5">
              <Select value={form.frequencia} onChange={v => setForm(f => ({ ...f, frequencia: v }))} options={FREQUENCIAS} />
            </div>
          </label>
          {semanal ? (
            <label className="block">
              <span className="text-[11px] text-gray-400">Dia da semana</span>
              <div className="mt-0.5">
                <Select value={form.diaSemana} onChange={v => setForm(f => ({ ...f, diaSemana: v }))}
                  options={[{ value: '', label: 'Qualquer dia' }, ...DIAS_SEMANA.map((d, i) => ({ value: String(i), label: d }))]} />
              </div>
            </label>
          ) : (
            <label className="block">
              <span className="text-[11px] text-gray-400">Dia do mês</span>
              <input type="number" min={1} max={28} value={form.diaMes}
                onChange={e => setForm(f => ({ ...f, diaMes: e.target.value }))}
                placeholder="3" className={campo} />
              <span className="text-[11px] text-gray-400 mt-0.5 block">
                Até 28 — dia 29 a 31 não existe em todo mês e a rotina pularia fevereiro.
              </span>
            </label>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] text-gray-400">Status da tarefa</span>
            <div className="mt-0.5">
              <Select value={form.statusRetorno} onChange={v => setForm(f => ({ ...f, statusRetorno: v }))}
                options={status.map(s => ({ value: s.valor, label: s.label }))} />
            </div>
            <span className="text-[11px] text-gray-400 mt-0.5 block">Onde ela nasce e para onde volta a cada ciclo.</span>
          </label>
          <label className="block">
            <span className="text-[11px] text-gray-400">Pasta que alimenta (drive Mídia)</span>
            <input value={form.pasta} onChange={e => setForm(f => ({ ...f, pasta: e.target.value }))}
              placeholder="Boletos Digitais" className={campo} />
          </label>
        </div>

        <button type="button" onClick={() => setForm(f => ({ ...f, padrao: !f.padrao }))}
          className={cn('w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors',
            form.padrao ? 'border-orange-200 bg-orange-50/50' : 'border-gray-200 hover:border-gray-300')}>
          <span className={cn('w-4 h-4 mt-0.5 rounded border flex items-center justify-center shrink-0',
            form.padrao ? 'bg-orange-600 border-orange-600' : 'border-gray-300')}>
            {form.padrao && <Check className="w-3 h-3 text-[#fff]" />}
          </span>
          <span>
            <span className="block text-sm text-gray-800">Sugerir em todo cliente novo</span>
            <span className="block text-[11px] text-gray-400">Entra no botão &ldquo;Criar as padrão&rdquo; da tela de clientes.</span>
          </span>
        </button>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3.5 py-2 text-sm font-medium rounded-xl text-gray-600 hover:bg-gray-100 transition-colors">
            Cancelar
          </button>
          <button onClick={salvar} disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors disabled:opacity-60">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
          </button>
        </div>
      </div>
    </Modal>
  )
}
