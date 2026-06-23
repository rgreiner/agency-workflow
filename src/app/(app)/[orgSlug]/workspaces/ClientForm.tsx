'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ContatoBlocks, emptyContato, type ContatoData } from '@/components/ui/ContatoBlocks'

export interface ClientFormValues {
  name: string
  description: string
  color: string
  legal_name: string
  trade_name: string
  tax_id: string
  state_registration: string
  city_registration: string
  finance_email: string
  phone: string
  contact_name: string
  address_zip: string
  address_street: string
  address_number: string
  address_complement: string
  address_district: string
  address_city: string
  address_state: string
  payment_terms: string
  atividade: string
}

const EMPTY: ClientFormValues = {
  name: '', description: '', color: '#6366f1',
  legal_name: '', trade_name: '', tax_id: '', state_registration: '', city_registration: '',
  finance_email: '', phone: '', contact_name: '',
  address_zip: '', address_street: '', address_number: '', address_complement: '',
  address_district: '', address_city: '', address_state: '', payment_terms: '', atividade: '',
}

const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#64748b', '#1f2937',
]

const inputCls =
  'w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

interface Props {
  initial?: Partial<ClientFormValues>
  initialContato?: ContatoData
  submitLabel?: string
  onSubmit: (fd: FormData) => Promise<{ error?: string } | void>
  onSuccess?: () => void
  onCancel?: () => void
  /** Ações extras à esquerda do rodapé (ex.: arquivar/excluir no modo edição). */
  footerLeft?: React.ReactNode
}

export function ClientForm({ initial, initialContato, submitLabel = 'Salvar', onSubmit, onSuccess, onCancel, footerLeft }: Props) {
  const [form, setForm] = useState<ClientFormValues>({ ...EMPTY, ...initial })
  const [contato, setContato] = useState<ContatoData>(initialContato ?? emptyContato())
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function set<K extends keyof ClientFormValues>(key: K, value: ClientFormValues[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function field(key: keyof ClientFormValues, label: string, opts: { placeholder?: string; type?: string } = {}) {
    return (
      <div>
        <label className={labelCls}>{label}</label>
        <input
          type={opts.type ?? 'text'}
          value={form[key]}
          onChange={e => set(key, e.target.value)}
          placeholder={opts.placeholder}
          className={inputCls}
        />
      </div>
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Nome obrigatório'); return }
    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => fd.set(k, v))
    fd.set('enderecos', JSON.stringify(contato.enderecos))
    fd.set('telefones', JSON.stringify(contato.telefones))
    fd.set('emails', JSON.stringify(contato.emails))
    fd.set('contas_bancarias', JSON.stringify(contato.contas_bancarias))
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res?.error) { setError(res.error); return }
      onSuccess?.()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {/* Identificação principal */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className={labelCls}>Nome do cliente <span className="text-red-500">*</span></label>
          <input
            type="text" value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="Como o cliente aparece no sistema (apelido)" className={inputCls} required
          />
        </div>
        {field('legal_name', 'Razão social', { placeholder: 'Razão social' })}
        {field('trade_name', 'Nome fantasia', { placeholder: 'Nome fantasia' })}
        {field('tax_id', 'CNPJ / CPF', { placeholder: '00.000.000/0000-00' })}
        <div className="grid grid-cols-2 gap-3">
          {field('state_registration', 'Inscrição estadual')}
          {field('city_registration', 'Inscrição municipal')}
        </div>
      </div>

      {/* Cor de identificação */}
      <div>
        <label className={labelCls}>Cor de identificação</label>
        <div className="flex gap-2 flex-wrap">
          {COLORS.map(c => (
            <button
              key={c} type="button" onClick={() => set('color', c)}
              className={cn('w-7 h-7 rounded-full border-2 transition flex items-center justify-center',
                form.color === c ? 'border-gray-900 scale-110' : 'border-transparent hover:scale-105')}
              style={{ backgroundColor: c }}
            >
              {form.color === c && <Check className="w-3.5 h-3.5 text-[#fff] drop-shadow" />}
            </button>
          ))}
        </div>
      </div>

      {/* Contato */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Contato</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('finance_email', 'E-mail financeiro', { type: 'email', placeholder: 'financeiro@cliente.com.br' })}
          {field('phone', 'Telefone')}
          {field('contact_name', 'Pessoa de contato')}
        </div>
      </div>

      {/* Endereço */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Endereço</h3>
        <div className="grid grid-cols-6 gap-3">
          <div className="col-span-6 sm:col-span-2">{field('address_zip', 'CEP')}</div>
          <div className="col-span-6 sm:col-span-3">{field('address_street', 'Rua')}</div>
          <div className="col-span-3 sm:col-span-1">{field('address_number', 'Número')}</div>
          <div className="col-span-3 sm:col-span-2">{field('address_complement', 'Complemento')}</div>
          <div className="col-span-3 sm:col-span-2">{field('address_district', 'Bairro')}</div>
          <div className="col-span-4 sm:col-span-1">{field('address_city', 'Cidade')}</div>
          <div className="col-span-2 sm:col-span-1">{field('address_state', 'UF')}</div>
        </div>
      </div>

      {/* Comercial */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Comercial</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('atividade', 'Atividade', { placeholder: 'Ex.: Indústria, Serviços' })}
            {field('payment_terms', 'Condição / prazo de pagamento padrão', { placeholder: 'Ex.: 30 dias úteis' })}
          </div>
          <div>
            <label className={labelCls}>Observações</label>
            <textarea
              rows={3} value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="Observações sobre o cliente..."
              className={cn(inputCls, 'resize-none')}
            />
          </div>
        </div>
      </div>

      {/* Contatos (múltiplos) */}
      <div className="border-t border-gray-100 pt-4">
        <ContatoBlocks value={contato} onChange={setContato} />
      </div>

      {/* Rodapé */}
      <div className="flex items-center justify-between pt-2">
        <div>{footerLeft}</div>
        <div className="flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={isPending}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">
              Cancelar
            </button>
          )}
          <button type="submit" disabled={isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  )
}
