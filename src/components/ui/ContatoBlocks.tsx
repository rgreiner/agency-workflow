'use client'

import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Endereco { tipo: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string }
export interface Telefone { tipo: string; numero: string }
export interface EmailC { tipo: string; email: string }
export interface ContaBancaria { banco: string; agencia: string; conta: string; tipo: string; pix: string }
export interface ContatoData { enderecos: Endereco[]; telefones: Telefone[]; emails: EmailC[]; contas_bancarias: ContaBancaria[] }

export const emptyContato = (): ContatoData => ({ enderecos: [], telefones: [], emails: [], contas_bancarias: [] })

const cellCls = 'w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
const sect = 'text-xs font-semibold uppercase tracking-wide text-gray-400'
const addBtn = 'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition'

export function ContatoBlocks({ value, onChange }: { value: ContatoData; onChange: (v: ContatoData) => void }) {
  const v = { enderecos: value.enderecos ?? [], telefones: value.telefones ?? [], emails: value.emails ?? [], contas_bancarias: value.contas_bancarias ?? [] }

  const setEnd = (i: number, k: keyof Endereco, val: string) => onChange({ ...v, enderecos: v.enderecos.map((e, idx) => idx === i ? { ...e, [k]: val } : e) })
  const setTel = (i: number, k: keyof Telefone, val: string) => onChange({ ...v, telefones: v.telefones.map((e, idx) => idx === i ? { ...e, [k]: val } : e) })
  const setEmail = (i: number, k: keyof EmailC, val: string) => onChange({ ...v, emails: v.emails.map((e, idx) => idx === i ? { ...e, [k]: val } : e) })
  const setConta = (i: number, k: keyof ContaBancaria, val: string) => onChange({ ...v, contas_bancarias: v.contas_bancarias.map((e, idx) => idx === i ? { ...e, [k]: val } : e) })

  return (
    <div className="space-y-5">
      {/* Endereços */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className={sect}>Endereços</span>
          <button type="button" className={addBtn} onClick={() => onChange({ ...v, enderecos: [...v.enderecos, { tipo: 'Comercial', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '' }] })}><Plus className="w-3 h-3" /> Endereço</button>
        </div>
        <div className="space-y-2">
          {v.enderecos.map((e, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input value={e.tipo} onChange={ev => setEnd(i, 'tipo', ev.target.value)} placeholder="Tipo" className={cn(cellCls, 'col-span-2')} />
              <input value={e.logradouro} onChange={ev => setEnd(i, 'logradouro', ev.target.value)} placeholder="Logradouro" className={cn(cellCls, 'col-span-4')} />
              <input value={e.numero} onChange={ev => setEnd(i, 'numero', ev.target.value)} placeholder="Nº" className={cn(cellCls, 'col-span-1')} />
              <input value={e.bairro} onChange={ev => setEnd(i, 'bairro', ev.target.value)} placeholder="Bairro" className={cn(cellCls, 'col-span-2')} />
              <input value={e.cidade} onChange={ev => setEnd(i, 'cidade', ev.target.value)} placeholder="Cidade" className={cn(cellCls, 'col-span-2')} />
              <button aria-label="Remover" type="button" onClick={() => onChange({ ...v, enderecos: v.enderecos.filter((_, idx) => idx !== i) })} className="col-span-1 text-gray-300 hover:text-red-500 transition justify-self-center"><Trash2 className="w-4 h-4" /></button>
              <input value={e.complemento} onChange={ev => setEnd(i, 'complemento', ev.target.value)} placeholder="Complemento" className={cn(cellCls, 'col-span-5')} />
              <input value={e.uf} onChange={ev => setEnd(i, 'uf', ev.target.value)} placeholder="UF" className={cn(cellCls, 'col-span-2')} />
              <input value={e.cep} onChange={ev => setEnd(i, 'cep', ev.target.value)} placeholder="CEP" className={cn(cellCls, 'col-span-4')} />
            </div>
          ))}
        </div>
      </div>

      {/* Telefones + Emails */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <div className="flex items-center justify-between mb-2"><span className={sect}>Telefones</span>
            <button type="button" className={addBtn} onClick={() => onChange({ ...v, telefones: [...v.telefones, { tipo: 'WhatsApp', numero: '' }] })}><Plus className="w-3 h-3" /> Telefone</button></div>
          <div className="space-y-2">
            {v.telefones.map((t, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input value={t.tipo} onChange={ev => setTel(i, 'tipo', ev.target.value)} placeholder="Tipo" className={cn(cellCls, 'w-28')} />
                <input value={t.numero} onChange={ev => setTel(i, 'numero', ev.target.value)} placeholder="Número" className={cellCls} />
                <button aria-label="Remover" type="button" onClick={() => onChange({ ...v, telefones: v.telefones.filter((_, idx) => idx !== i) })} className="text-gray-300 hover:text-red-500 transition shrink-0"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2"><span className={sect}>Emails</span>
            <button type="button" className={addBtn} onClick={() => onChange({ ...v, emails: [...v.emails, { tipo: 'Financeiro', email: '' }] })}><Plus className="w-3 h-3" /> Email</button></div>
          <div className="space-y-2">
            {v.emails.map((e, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input value={e.tipo} onChange={ev => setEmail(i, 'tipo', ev.target.value)} placeholder="Tipo" className={cn(cellCls, 'w-28')} />
                <input value={e.email} onChange={ev => setEmail(i, 'email', ev.target.value)} placeholder="email@..." className={cellCls} />
                <button aria-label="Remover" type="button" onClick={() => onChange({ ...v, emails: v.emails.filter((_, idx) => idx !== i) })} className="text-gray-300 hover:text-red-500 transition shrink-0"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Contas bancárias */}
      <div>
        <div className="flex items-center justify-between mb-2"><span className={sect}>Contas bancárias</span>
          <button type="button" className={addBtn} onClick={() => onChange({ ...v, contas_bancarias: [...v.contas_bancarias, { banco: '', agencia: '', conta: '', tipo: 'Corrente', pix: '' }] })}><Plus className="w-3 h-3" /> Conta</button></div>
        <div className="space-y-2">
          {v.contas_bancarias.map((c, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input value={c.banco} onChange={ev => setConta(i, 'banco', ev.target.value)} placeholder="Banco" className={cn(cellCls, 'col-span-3')} />
              <input value={c.agencia} onChange={ev => setConta(i, 'agencia', ev.target.value)} placeholder="Agência" className={cn(cellCls, 'col-span-2')} />
              <input value={c.conta} onChange={ev => setConta(i, 'conta', ev.target.value)} placeholder="Conta" className={cn(cellCls, 'col-span-2')} />
              <input value={c.tipo} onChange={ev => setConta(i, 'tipo', ev.target.value)} placeholder="Tipo" className={cn(cellCls, 'col-span-2')} />
              <input value={c.pix} onChange={ev => setConta(i, 'pix', ev.target.value)} placeholder="PIX" className={cn(cellCls, 'col-span-2')} />
              <button aria-label="Remover" type="button" onClick={() => onChange({ ...v, contas_bancarias: v.contas_bancarias.filter((_, idx) => idx !== i) })} className="col-span-1 text-gray-300 hover:text-red-500 transition justify-self-center"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
