'use client'

import { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { UserCog, Plus, Loader2, Archive } from 'lucide-react'
import { toast } from 'sonner'
import { salvarColaborador } from '@/app/actions/rh'

export interface ColaboradorRow {
  id: string
  nome: string
  cargo: string | null
  tipo_vinculo: string | null
  status: string
  data_admissao: string | null
  data_demissao: string | null
  arquivado: boolean
}

const STATUS: Record<string, { label: string; cls: string }> = {
  ativo:     { label: 'Ativo',     cls: 'bg-emerald-50 text-emerald-700' },
  afastado:  { label: 'Afastado',  cls: 'bg-amber-50 text-amber-700' },
  desligado: { label: 'Desligado', cls: 'bg-gray-100 text-gray-500' },
}
const VINCULO: Record<string, string> = { clt: 'CLT', pj: 'PJ', estagio: 'Estágio', outro: 'Outro' }
const inputCls = 'w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'

export function PessoasClient({ orgSlug, colaboradores }: { orgSlug: string; colaboradores: ColaboradorRow[] }) {
  const [aba, setAba] = useState<'ativos' | 'todos' | 'arquivados'>('ativos')
  const [novo, setNovo] = useState(false)

  const lista = useMemo(() => colaboradores.filter(c =>
    aba === 'arquivados' ? c.arquivado : aba === 'ativos' ? (!c.arquivado && c.status !== 'desligado') : !c.arquivado
  ), [colaboradores, aba])

  const contagem = useMemo(() => ({
    ativos: colaboradores.filter(c => !c.arquivado && c.status !== 'desligado').length,
    todos: colaboradores.filter(c => !c.arquivado).length,
    arquivados: colaboradores.filter(c => c.arquivado).length,
  }), [colaboradores])

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><UserCog className="w-5 h-5 text-orange-600" /> Pessoas</h1>
          <p className="text-gray-500 text-sm mt-0.5">Colaboradores, ativos e ex — ficha e documentos.</p>
        </div>
        <button onClick={() => setNovo(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition">
          <Plus className="w-4 h-4" /> Nova pessoa
        </button>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {([['ativos', 'Ativos'], ['todos', 'Todos'], ['arquivados', 'Arquivados']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition ${aba === k ? 'border-orange-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label} <span className="text-gray-400">{contagem[k]}</span>
          </button>
        ))}
      </div>

      {lista.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          {aba === 'arquivados' ? 'Nenhum colaborador arquivado.' : 'Nenhum colaborador ainda. Clique em “Nova pessoa”.'}
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400">
                <th className="text-left px-4 py-3 font-medium">Nome</th>
                <th className="text-left px-4 py-3 font-medium">Cargo</th>
                <th className="text-left px-4 py-3 font-medium">Vínculo</th>
                <th className="text-left px-4 py-3 font-medium">Admissão</th>
                <th className="text-left px-4 py-3 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(c => {
                const st = STATUS[c.status] ?? STATUS.ativo
                return (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0 hover:bg-orange-50/40 transition">
                    <td className="px-4 py-3">
                      <Link href={`/${orgSlug}/rh/${c.id}`} className="font-medium text-gray-900 hover:text-orange-600 transition flex items-center gap-2">
                        {c.nome}
                        {c.arquivado && <Archive className="w-3.5 h-3.5 text-gray-300" />}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.cargo || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{c.tipo_vinculo ? (VINCULO[c.tipo_vinculo] ?? c.tipo_vinculo) : '—'}</td>
                    <td className="px-4 py-3 text-gray-500 tabular-nums">{fmt(c.data_admissao)}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {novo && <NovaPessoaModal orgSlug={orgSlug} onClose={() => setNovo(false)} />}
    </div>
  )
}

function NovaPessoaModal({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [cargo, setCargo] = useState('')
  const [admissao, setAdmissao] = useState('')
  const [saving, start] = useTransition()
  const [down, setDown] = useState(false)

  function salvar() {
    if (!nome.trim()) { toast.error('Informe o nome.'); return }
    start(async () => {
      const r = await salvarColaborador(orgSlug, null, { nome, cargo: cargo || null, data_admissao: admissao || null })
      if (r?.error) toast.error(r.error)
      else if (r?.id) { toast.success('Colaborador criado.'); router.push(`/${orgSlug}/rh/${r.id}`) }
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onMouseDown={() => setDown(true)}
      onClick={e => { if (down && e.target === e.currentTarget) onClose(); setDown(false) }}>
      <div className="modal-card w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200" onMouseDown={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100"><h2 className="text-base font-semibold text-gray-900">Nova pessoa</h2></div>
        <div className="px-6 py-5 space-y-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Nome *</label>
            <input autoFocus value={nome} onChange={e => setNome(e.target.value)} className={inputCls} placeholder="Nome completo" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Cargo</label>
            <input value={cargo} onChange={e => setCargo(e.target.value)} className={inputCls} placeholder="ex.: Designer" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Admissão</label>
            <input type="date" value={admissao} onChange={e => setAdmissao(e.target.value)} className={inputCls} /></div>
          <p className="text-[12px] text-gray-400">Você completa CPF, salário, documentos e demais dados na ficha.</p>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button onClick={salvar} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar
          </button>
        </div>
      </div>
    </div>
  )
}

function fmt(d: string | null): string {
  if (!d) return '—'
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}
