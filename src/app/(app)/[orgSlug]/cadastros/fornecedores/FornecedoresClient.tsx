'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, X, Check, Loader2, Archive, ArchiveRestore, Pencil, Truck, Search } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { createFornecedor, updateFornecedor, setFornecedorArchived } from '@/app/actions/fornecedor'
import { ContatoBlocks, type ContatoData } from '@/components/ui/ContatoBlocks'
import { buscarCnpj } from '@/app/actions/lookup'

export interface Fornecedor {
  id: string; name: string; tipo: string | null; tax_id: string | null; notes: string | null; archived: boolean
  enderecos?: ContatoData['enderecos']; telefones?: ContatoData['telefones']; emails?: ContatoData['emails']; contas_bancarias?: ContatoData['contas_bancarias']
}

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

export function FornecedoresClient({ orgSlug, fornecedores, archivedView }: {
  orgSlug: string; fornecedores: Fornecedor[]; archivedView: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<Fornecedor | null>(null)
  const [creating, setCreating] = useState(false)
  const [isPending, startTransition] = useTransition()

  function archive(f: Fornecedor) {
    startTransition(async () => { await setFornecedorArchived(orgSlug, f.id, !f.archived); router.refresh() })
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Fornecedores</h1>
          <p className="text-gray-500 text-sm mt-0.5">Gráficas, brindes, produtoras e demais fornecedores</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
            <Link href={`/${orgSlug}/cadastros/fornecedores`} className={cn('px-2.5 py-1 rounded-md transition', !archivedView ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>Ativos</Link>
            <Link href={`/${orgSlug}/cadastros/fornecedores?view=arquivados`} className={cn('px-2.5 py-1 rounded-md transition', archivedView ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>Arquivados</Link>
          </div>
          {!archivedView && (
            <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition">
              <Plus className="w-4 h-4" /> Adicionar fornecedor
            </button>
          )}
        </div>
      </div>

      {fornecedores.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
                <th className="text-left px-4 py-3">Fornecedor</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-left px-4 py-3">CNPJ</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {fornecedores.map(f => (
                <tr key={f.id} className="hover:bg-gray-50/50 transition">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{f.name}</p>
                    {f.notes && <p className="text-xs text-gray-400 truncate max-w-xs">{f.notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{f.tipo || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{f.tax_id || '—'}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setEditing(f)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => archive(f)} disabled={isPending} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition disabled:opacity-50" title={f.archived ? 'Desarquivar' : 'Arquivar'}>
                        {f.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
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
          <Truck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">{archivedView ? 'Nenhum fornecedor arquivado' : 'Nenhum fornecedor ainda'}</h3>
          <p className="text-gray-500 text-sm mt-1">{archivedView ? 'Fornecedores arquivados aparecem aqui.' : 'Cadastre o primeiro fornecedor.'}</p>
        </div>
      )}

      {(creating || editing) && (
        <FornecedorModal orgSlug={orgSlug} fornecedor={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      )}
    </div>
  )
}

function FornecedorModal({ orgSlug, fornecedor, onClose }: { orgSlug: string; fornecedor: Fornecedor | null; onClose: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: fornecedor?.name ?? '', tipo: fornecedor?.tipo ?? '', tax_id: fornecedor?.tax_id ?? '', notes: fornecedor?.notes ?? '',
  })
  const [contato, setContato] = useState<ContatoData>({
    enderecos: fornecedor?.enderecos ?? [], telefones: fornecedor?.telefones ?? [], emails: fornecedor?.emails ?? [], contas_bancarias: fornecedor?.contas_bancarias ?? [],
  })
  const [cnpjBusy, setCnpjBusy] = useState(false)

  async function fetchCnpj() {
    if (cnpjBusy) return
    setCnpjBusy(true)
    const r = await buscarCnpj(form.tax_id)
    setCnpjBusy(false)
    if (r.error || !r.data) { toast.error(r.error ?? 'CNPJ não encontrado'); return }
    const d = r.data
    setForm(f => ({ ...f, name: f.name.trim() ? f.name : (d.nome_fantasia || d.razao_social) }))
    setContato(c => {
      const end = { tipo: 'Comercial', logradouro: d.logradouro, numero: d.numero, complemento: d.complemento, bairro: d.bairro, cidade: d.cidade, uf: d.uf, cep: d.cep }
      const enderecos = c.enderecos.length ? c.enderecos.map((e, i) => i === 0 ? { ...e, ...end } : e) : [end]
      const telefones = d.telefone && !c.telefones.some(t => t.numero.trim()) ? [{ tipo: 'Comercial', numero: d.telefone }, ...c.telefones] : c.telefones
      const emails = d.email && !c.emails.some(e => e.email.trim()) ? [{ tipo: 'Financeiro', email: d.email }, ...c.emails] : c.emails
      return { ...c, enderecos, telefones, emails }
    })
    toast.success('Dados do CNPJ preenchidos.')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Nome obrigatório'); return }
    const fd = new FormData()
    fd.set('name', form.name); fd.set('tipo', form.tipo); fd.set('tax_id', form.tax_id); fd.set('notes', form.notes)
    fd.set('enderecos', JSON.stringify(contato.enderecos)); fd.set('telefones', JSON.stringify(contato.telefones))
    fd.set('emails', JSON.stringify(contato.emails)); fd.set('contas_bancarias', JSON.stringify(contato.contas_bancarias))
    startTransition(async () => {
      const res = fornecedor ? await updateFornecedor(orgSlug, fornecedor.id, fd) : await createFornecedor(orgSlug, fd)
      if (res?.error) { setError(res.error); return }
      onClose(); router.refresh()
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{fornecedor ? 'Editar fornecedor' : 'Novo fornecedor'}</h2>
          <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div><label className={labelCls}>Nome <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Tipo</label><input value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))} placeholder="Gráfica, brindes…" className={inputCls} /></div>
            <div><label className={labelCls}>CNPJ</label>
              <div className="flex gap-2">
                <input value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))} placeholder="00.000.000/0000-00" className={inputCls} />
                <button type="button" onClick={fetchCnpj} disabled={cnpjBusy} title="Buscar dados públicos do CNPJ"
                  className="inline-flex items-center gap-1.5 px-3 rounded-xl bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200 transition disabled:opacity-50 shrink-0">
                  {cnpjBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <div><label className={labelCls}>Observações</label><textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={cn(inputCls, 'resize-none')} /></div>
          <div className="border-t border-gray-100 pt-4"><ContatoBlocks value={contato} onChange={setContato} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
            <button type="submit" disabled={isPending} className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
