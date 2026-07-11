'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Plus, Trash2, ArrowUp, ArrowDown, Highlighter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setOrgDocs } from '@/app/actions/org-settings'
import type { OrgDocs, DocNote, AgencyInfo } from '@/lib/agency'

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

export function DocumentosClient({ orgSlug, orgId, initial }: { orgSlug: string; orgId: string; initial: OrgDocs }) {
  const [agency, setAgency] = useState<AgencyInfo>(initial.agency)
  const [nf, setNf] = useState<DocNote[]>(initial.nfNotes)
  const [midia, setMidia] = useState<DocNote[]>(initial.midiaNotes)
  const [saving, start] = useTransition()

  const setA = (k: keyof AgencyInfo, v: string) => setAgency(a => ({ ...a, [k]: v }))

  function save() {
    start(async () => {
      const r = await setOrgDocs(orgSlug, orgId, agency, nf.filter(n => n.text.trim()), midia.filter(n => n.text.trim()))
      if (r?.error) toast.error(r.error)
      else toast.success('Documentos atualizados.')
    })
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Documentos</h2>
          <p className="text-gray-500 text-sm mt-0.5">Dados da agência e observações legais que aparecem nos orçamentos, pedidos e autorizações de mídia.</p>
        </div>
        <button onClick={save} disabled={saving}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
        </button>
      </div>

      {/* Dados da agência */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-4">Dados da agência</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className={labelCls}>Nome</label><input value={agency.nome} onChange={e => setA('nome', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Razão social</label><input value={agency.razao} onChange={e => setA('razao', e.target.value)} className={inputCls} /></div>
          <div className="sm:col-span-2"><label className={labelCls}>Endereço</label><input value={agency.endereco} onChange={e => setA('endereco', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>CNPJ / Fone</label><input value={agency.cnpjFone} onChange={e => setA('cnpjFone', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Cidade (na data por extenso)</label><input value={agency.cidade} onChange={e => setA('cidade', e.target.value)} className={inputCls} /></div>
        </div>
      </section>

      <NotesEditor
        title="Observações — Produção (Orçamento, Pedido, Fee)"
        hint="Instruções de NF impressas no rodapé dos documentos de produção."
        notes={nf} setNotes={setNf}
      />
      <NotesEditor
        title="Observações — Mídia (autorizações)"
        hint="Aparecem sob “Observações sobre faturamento” nas autorizações de mídia."
        notes={midia} setNotes={setMidia}
      />

      <p className="text-xs text-gray-400 mt-2">Marque com o <Highlighter className="w-3 h-3 inline text-orange-500" /> as observações que devem sair em destaque (fundo amarelo) no documento.</p>
    </div>
  )
}

function NotesEditor({ title, hint, notes, setNotes }: { title: string; hint: string; notes: DocNote[]; setNotes: (n: DocNote[]) => void }) {
  const upd = (i: number, patch: Partial<DocNote>) => setNotes(notes.map((n, idx) => idx === i ? { ...n, ...patch } : n))
  const del = (i: number) => setNotes(notes.filter((_, idx) => idx !== i))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= notes.length) return
    const next = [...notes];[next[i], next[j]] = [next[j], next[i]]; setNotes(next)
  }
  const add = () => setNotes([...notes, { text: '', highlight: false }])

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
        <button type="button" onClick={add} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus className="w-3 h-3" /> Observação</button>
      </div>
      <p className="text-[11px] text-gray-400 mb-3">{hint}</p>
      {notes.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhuma observação.</p>
      ) : (
        <div className="space-y-2">
          {notes.map((n, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex flex-col pt-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === notes.length - 1} className="text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
              </div>
              <textarea
                value={n.text} onChange={e => upd(i, { text: e.target.value })} rows={2}
                className={cn('flex-1 px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 resize-y min-h-[42px] focus:outline-none focus:ring-2 focus:ring-orange-500', n.highlight && 'bg-yellow-50 ring-1 ring-yellow-200')}
              />
              <button type="button" onClick={() => upd(i, { highlight: !n.highlight })} title="Destacar (fundo amarelo no documento)"
                className={cn('shrink-0 mt-1 p-1.5 rounded-lg transition-colors', n.highlight ? 'bg-yellow-100 text-yellow-700' : 'text-gray-300 hover:text-gray-600 hover:bg-gray-100')}>
                <Highlighter className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => del(i)} title="Remover" className="shrink-0 mt-1 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
