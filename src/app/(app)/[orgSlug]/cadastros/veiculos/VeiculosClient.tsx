'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, X, Check, Loader2, Archive, ArchiveRestore, Pencil, Tv } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { createVeiculo, updateVeiculo, setVeiculoArchived } from '@/app/actions/veiculo'
import { ContatoBlocks, type ContatoData } from '@/components/ui/ContatoBlocks'

export interface Veiculo {
  id: string
  name: string
  type: string | null
  tax_id: string | null
  commission_pct: number | null
  notes: string | null
  archived: boolean
  enderecos?: ContatoData['enderecos']
  telefones?: ContatoData['telefones']
  emails?: ContatoData['emails']
  contas_bancarias?: ContatoData['contas_bancarias']
}

const TYPE_OPTIONS = [
  { value: 'impressa', label: 'Impressa' },
  { value: 'eletronica', label: 'Eletrônica' },
  { value: 'externa', label: 'Externa' },
  { value: 'digital', label: 'Digital' },
  { value: 'outros', label: 'Outros' },
]
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map(o => [o.value, o.label]))

const inputCls =
  'w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

export function VeiculosClient({ orgSlug, veiculos, archivedView }: {
  orgSlug: string; veiculos: Veiculo[]; archivedView: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<Veiculo | null>(null)
  const [creating, setCreating] = useState(false)
  const [isPending, startTransition] = useTransition()

  function archive(v: Veiculo) {
    startTransition(async () => {
      await setVeiculoArchived(orgSlug, v.id, !v.archived)
      router.refresh()
    })
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Veículos</h1>
          <p className="text-gray-500 text-sm mt-0.5">Jornais, emissoras, mídia externa e plataformas digitais</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
            <Link href={`/${orgSlug}/cadastros/veiculos`}
              className={cn('px-2.5 py-1 rounded-md transition', !archivedView ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>
              Ativos
            </Link>
            <Link href={`/${orgSlug}/cadastros/veiculos?view=arquivados`}
              className={cn('px-2.5 py-1 rounded-md transition', archivedView ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>
              Arquivados
            </Link>
          </div>
          {!archivedView && (
            <button onClick={() => setCreating(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-indigo-700 transition">
              <Plus className="w-4 h-4" /> Adicionar veículo
            </button>
          )}
        </div>
      </div>

      {veiculos.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Veículo</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Tipo</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">CNPJ</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-400">Comissão</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {veiculos.map(v => (
                <tr key={v.id} className="hover:bg-gray-50/50 transition">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{v.name}</p>
                    {v.notes && <p className="text-xs text-gray-400 truncate max-w-xs">{v.notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{v.type ? TYPE_LABEL[v.type] ?? v.type : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{v.tax_id || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-right">{(v.commission_pct ?? 0).toString().replace('.', ',')}%</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setEditing(v)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition" title="Editar">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => archive(v)} disabled={isPending}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition disabled:opacity-50"
                        title={v.archived ? 'Desarquivar' : 'Arquivar'}>
                        {v.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <Tv className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">
            {archivedView ? 'Nenhum veículo arquivado' : 'Nenhum veículo ainda'}
          </h3>
          <p className="text-gray-500 text-sm mt-1">
            {archivedView ? 'Veículos arquivados aparecem aqui.' : 'Cadastre o primeiro veículo.'}
          </p>
        </div>
      )}

      {(creating || editing) && (
        <VeiculoModal
          orgSlug={orgSlug}
          veiculo={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function VeiculoModal({ orgSlug, veiculo, onClose }: {
  orgSlug: string; veiculo: Veiculo | null; onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: veiculo?.name ?? '',
    type: veiculo?.type ?? '',
    tax_id: veiculo?.tax_id ?? '',
    commission_pct: veiculo?.commission_pct != null ? String(veiculo.commission_pct).replace('.', ',') : '20',
    notes: veiculo?.notes ?? '',
  })
  const [contato, setContato] = useState<ContatoData>({
    enderecos: veiculo?.enderecos ?? [], telefones: veiculo?.telefones ?? [], emails: veiculo?.emails ?? [], contas_bancarias: veiculo?.contas_bancarias ?? [],
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Nome obrigatório'); return }
    const fd = new FormData()
    fd.set('name', form.name)
    fd.set('type', form.type)
    fd.set('tax_id', form.tax_id)
    fd.set('commission_pct', form.commission_pct.replace(',', '.'))
    fd.set('notes', form.notes)
    fd.set('enderecos', JSON.stringify(contato.enderecos))
    fd.set('telefones', JSON.stringify(contato.telefones))
    fd.set('emails', JSON.stringify(contato.emails))
    fd.set('contas_bancarias', JSON.stringify(contato.contas_bancarias))
    startTransition(async () => {
      const res = veiculo
        ? await updateVeiculo(orgSlug, veiculo.id, fd)
        : await createVeiculo(orgSlug, fd)
      if (res?.error) { setError(res.error); return }
      onClose()
      router.refresh()
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="text-base font-semibold text-gray-900">{veiculo ? 'Editar veículo' : 'Novo veículo'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label className={labelCls}>Nome <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ex.: Meta, Google, Gazeta do Povo" className={inputCls} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tipo</label>
              <Select value={form.type} onChange={v => setForm(f => ({ ...f, type: v }))}
                options={TYPE_OPTIONS} placeholder="Selecionar" />
            </div>
            <div>
              <label className={labelCls}>Comissão padrão (%)</label>
              <input type="text" inputMode="decimal" value={form.commission_pct}
                onChange={e => setForm(f => ({ ...f, commission_pct: e.target.value }))} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>CNPJ</label>
            <input type="text" value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))}
              placeholder="00.000.000/0000-00" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Observações</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className={cn(inputCls, 'resize-none')} />
          </div>

          <div className="border-t border-gray-100 pt-4">
            <ContatoBlocks value={contato} onChange={setContato} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
            <button type="submit" disabled={isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
