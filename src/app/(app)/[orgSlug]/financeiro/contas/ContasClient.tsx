'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, X, Check, Loader2, Pencil, Landmark, Power } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/midia'
import { Select } from '@/components/ui/Select'
import { createConta, updateConta } from '@/app/actions/financeiro'

export interface Conta {
  id: string
  nome: string
  tipo: string | null
  saldo_inicial: number | string
  cor: string | null
  ativo: boolean
  ordem: number
}

const TIPO_OPTIONS = [
  { value: 'banco', label: 'Conta bancária' },
  { value: 'caixa', label: 'Caixa' },
  { value: 'aplicacao', label: 'Aplicação' },
  { value: 'outro', label: 'Outro' },
]
const TIPO_LABEL: Record<string, string> = Object.fromEntries(TIPO_OPTIONS.map(o => [o.value, o.label]))

const COR_PRESETS = ['#f97316', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#eab308', '#14b8a6', '#6b7280']

const inputCls =
  'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

export function ContasClient({ orgSlug, contas }: { orgSlug: string; contas: Conta[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Conta | null>(null)
  const [creating, setCreating] = useState(false)
  const [isPending, startTransition] = useTransition()

  function toggleAtivo(c: Conta) {
    startTransition(async () => {
      await updateConta(orgSlug, c.id, { ativo: !c.ativo })
      router.refresh()
    })
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Contas financeiras</h1>
          <p className="text-gray-500 text-sm mt-0.5">Bancos e caixa — usadas na baixa e na posição das contas</p>
        </div>
        <button onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition shrink-0">
          <Plus className="w-4 h-4" /> Adicionar conta
        </button>
      </div>

      {contas.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Conta</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Tipo</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-400">Saldo inicial</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-400">Situação</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {contas.map(c => (
                <tr key={c.id} className={cn('hover:bg-gray-50/50 transition', !c.ativo && 'opacity-50')}>
                  <td className="px-4 py-3">
                    <Link href={`/${orgSlug}/financeiro/contas/${c.id}`} className="flex items-center gap-2.5 group/conta">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.cor ?? '#cbd5e1' }} />
                      <span className="text-sm font-medium text-gray-900 group-hover/conta:text-orange-600 transition-colors">{c.nome}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c.tipo ? TIPO_LABEL[c.tipo] ?? c.tipo : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-right">{formatBRL(Number(c.saldo_inicial ?? 0))}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn('inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full',
                      c.ativo ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500')}>
                      {c.ativo ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link href={`/${orgSlug}/financeiro/contas/${c.id}`}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition" title="Movimentações e conciliação (OFX)">
                        <Landmark className="w-3.5 h-3.5" />
                      </Link>
                      <button onClick={() => setEditing(c)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition" title="Editar">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => toggleAtivo(c)} disabled={isPending}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition disabled:opacity-50"
                        title={c.ativo ? 'Inativar' : 'Ativar'}>
                        <Power className="w-3.5 h-3.5" />
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
          <Landmark className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Nenhuma conta ainda</h3>
          <p className="text-gray-500 text-sm mt-1">Cadastre suas contas bancárias e o caixa.</p>
        </div>
      )}

      {(creating || editing) && (
        <ContaModal orgSlug={orgSlug} conta={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      )}
    </div>
  )
}

function ContaModal({ orgSlug, conta, onClose }: { orgSlug: string; conta: Conta | null; onClose: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    nome: conta?.nome ?? '',
    tipo: conta?.tipo ?? 'banco',
    saldo_inicial: conta?.saldo_inicial != null ? String(conta.saldo_inicial).replace('.', ',') : '0',
    cor: conta?.cor ?? COR_PRESETS[0],
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.nome.trim()) { setError('Nome obrigatório'); return }
    const data = {
      nome: form.nome.trim(),
      tipo: form.tipo,
      saldo_inicial: form.saldo_inicial.replace(/\./g, '').replace(',', '.'),
      cor: form.cor,
      ativo: conta?.ativo ?? true,
    }
    startTransition(async () => {
      const res = conta
        ? await updateConta(orgSlug, conta.id, data)
        : await createConta(orgSlug, data)
      if (res?.error) { setError(res.error); return }
      onClose()
      router.refresh()
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{conta ? 'Editar conta' : 'Nova conta'}</h2>
          <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label className={labelCls}>Nome <span className="text-red-500">*</span></label>
            <input type="text" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
              placeholder="Ex.: BTG Pactual, Caixinha" className={inputCls} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tipo</label>
              <Select value={form.tipo} onChange={v => setForm(f => ({ ...f, tipo: v }))} options={TIPO_OPTIONS} />
            </div>
            <div>
              <label className={labelCls}>Saldo inicial (R$)</label>
              <input type="text" inputMode="decimal" value={form.saldo_inicial}
                onChange={e => setForm(f => ({ ...f, saldo_inicial: e.target.value }))} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Cor</label>
            <div className="flex items-center gap-2 flex-wrap">
              {COR_PRESETS.map(c => (
                <button key={c} type="button" onClick={() => setForm(f => ({ ...f, cor: c }))}
                  className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                  style={{ backgroundColor: c, borderColor: form.cor === c ? c : 'transparent', outline: form.cor === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />
              ))}
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input type="color" value={form.cor} onChange={e => setForm(f => ({ ...f, cor: e.target.value }))}
                  className="w-7 h-7 rounded cursor-pointer border border-gray-200" />
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
            <button type="submit" disabled={isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
