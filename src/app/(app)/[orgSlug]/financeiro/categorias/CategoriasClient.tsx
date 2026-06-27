'use client'

import { useState, useTransition } from 'react'
import { Plus, Trash2, Loader2, Building2, ChevronRight, CornerDownRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setFinanceConfig, type FinanceCategoriaGrupo, type FinanceCentro } from '@/app/actions/financeiro'
import { toast } from 'sonner'

const COR_PRESETS = ['#22c55e', '#3b82f6', '#8b5cf6', '#f97316', '#ec4899', '#eab308', '#14b8a6', '#ef4444', '#6b7280']
const corReceita = '#22c55e'
const corDespesa = '#ef4444'

const inputCls =
  'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'

type Tab = 'entrada' | 'saida'

export function CategoriasClient({ orgSlug, categorias: initCats, centros: initCentros }: {
  orgSlug: string; categorias: FinanceCategoriaGrupo[]; centros: FinanceCentro[]
}) {
  const [grupos, setGrupos] = useState<FinanceCategoriaGrupo[]>(initCats)
  const [centros, setCentros] = useState<FinanceCentro[]>(initCentros)
  const [tab, setTab] = useState<Tab>('entrada')
  const [isPending, startTransition] = useTransition()

  // helpers que operam sobre o índice REAL no array `grupos` (não o filtrado)
  const updateGrupo = (gi: number, patch: Partial<FinanceCategoriaGrupo>) =>
    setGrupos(prev => prev.map((g, i) => i === gi ? { ...g, ...patch } : g))
  const removeGrupo = (gi: number) => setGrupos(prev => prev.filter((_, i) => i !== gi))
  const addFilho = (gi: number) =>
    setGrupos(prev => prev.map((g, i) => i === gi ? { ...g, filhos: [...g.filhos, { nome: '', cor: g.cor }] } : g))
  const updateFilho = (gi: number, fi: number, nome: string) =>
    setGrupos(prev => prev.map((g, i) => i === gi ? { ...g, filhos: g.filhos.map((f, j) => j === fi ? { ...f, nome } : f) } : g))
  const removeFilho = (gi: number, fi: number) =>
    setGrupos(prev => prev.map((g, i) => i === gi ? { ...g, filhos: g.filhos.filter((_, j) => j !== fi) } : g))
  const addGrupo = () =>
    setGrupos(prev => [...prev, { nome: '', tipo: tab, cor: tab === 'entrada' ? corReceita : corDespesa, filhos: [] }])

  function save() {
    const clean = grupos
      .map(g => ({ ...g, filhos: g.filhos.filter(f => f.nome.trim()) }))
      .filter(g => g.nome.trim())
    const cleanCentros = centros.filter(c => c.nome.trim())
    startTransition(async () => {
      const res = await setFinanceConfig(orgSlug, clean, cleanCentros)
      if (res?.error) toast.error(res.error)
      else { toast.success('Configuração salva!'); setGrupos(clean); setCentros(cleanCentros) }
    })
  }

  const totalLeaves = (t: Tab) => grupos.filter(g => g.tipo === t).reduce((s, g) => s + Math.max(g.filhos.length, 1), 0)

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Categorias e centros de custo</h1>
          <p className="text-gray-500 text-sm mt-0.5">Grupo → categoria, separados por receita e despesa. Cada um com sua cor.</p>
        </div>
        <button onClick={save} disabled={isPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-[#fff] text-sm font-semibold rounded-xl hover:bg-orange-700 transition disabled:opacity-50 shrink-0">
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Salvar
        </button>
      </div>

      {/* Tabs Receita / Despesa */}
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm mb-4">
        <button onClick={() => setTab('entrada')}
          className={cn('px-4 py-1.5 rounded-md transition', tab === 'entrada' ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>
          Receita · {totalLeaves('entrada')}
        </button>
        <button onClick={() => setTab('saida')}
          className={cn('px-4 py-1.5 rounded-md transition', tab === 'saida' ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>
          Despesa · {totalLeaves('saida')}
        </button>
      </div>

      {/* Árvore de grupos da aba ativa */}
      <div className="space-y-3 mb-8">
        {grupos.map((g, gi) => g.tipo !== tab ? null : (
          <div key={gi} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* Grupo */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50/60 border-b border-gray-100">
              <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
              <ColorDot color={g.cor} onChange={cor => updateGrupo(gi, { cor })} />
              <input value={g.nome} placeholder="Nome do grupo (ex.: 3.01 Receitas de Vendas)"
                onChange={e => updateGrupo(gi, { nome: e.target.value })}
                className={cn(inputCls, 'flex-1 font-medium')} />
              <button onClick={() => addFilho(gi)} title="Adicionar categoria"
                className="p-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition"><Plus className="w-4 h-4" /></button>
              <button onClick={() => removeGrupo(gi)} title="Remover grupo"
                className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            {/* Filhos */}
            <div className="divide-y divide-gray-50">
              {g.filhos.length === 0 && (
                <p className="text-xs text-gray-400 px-4 py-2.5 pl-11">Grupo sem categorias — vira uma categoria avulsa, ou adicione filhos no “+”.</p>
              )}
              {g.filhos.map((f, fi) => (
                <div key={fi} className="flex items-center gap-2 px-3 py-2 pl-9">
                  <CornerDownRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: f.cor ?? g.cor ?? '#cbd5e1' }} />
                  <input value={f.nome} placeholder="Nome da categoria"
                    onChange={e => updateFilho(gi, fi, e.target.value)} className={cn(inputCls, 'flex-1')} />
                  <button onClick={() => removeFilho(gi, fi)} title="Remover"
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {grupos.filter(g => g.tipo === tab).length === 0 && (
          <p className="text-sm text-gray-400 px-1 py-4">Nenhum grupo de {tab === 'entrada' ? 'receita' : 'despesa'}. Adicione abaixo.</p>
        )}
        <button onClick={addGrupo}
          className="flex items-center gap-2 px-4 py-2.5 text-sm text-orange-600 hover:bg-orange-50/50 rounded-xl border border-dashed border-orange-200 transition w-full justify-center">
          <Plus className="w-4 h-4" /> Adicionar grupo de {tab === 'entrada' ? 'receita' : 'despesa'}
        </button>
      </div>

      {/* Centros de custo (sem hierarquia) */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900">Centros de custo</h2>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50">
          {centros.length === 0 && <p className="text-sm text-gray-400 px-4 py-4">Nenhum centro de custo. Adicione abaixo.</p>}
          {centros.map((ce, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2.5">
              <ColorDot color={ce.cor} onChange={cor => setCentros(prev => prev.map((c, j) => j === i ? { ...c, cor } : c))} />
              <input value={ce.nome} placeholder="Nome do centro de custo"
                onChange={e => setCentros(prev => prev.map((c, j) => j === i ? { ...c, nome: e.target.value } : c))}
                className={cn(inputCls, 'flex-1')} />
              <button onClick={() => setCentros(prev => prev.filter((_, j) => j !== i))}
                className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition" title="Remover">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button onClick={() => setCentros(prev => [...prev, { nome: '', cor: COR_PRESETS[prev.length % COR_PRESETS.length] }])}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-orange-600 hover:bg-orange-50/50 transition w-full">
            <Plus className="w-4 h-4" /> Adicionar centro de custo
          </button>
        </div>
      </section>

      <div className="flex justify-end">
        <button onClick={save} disabled={isPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-[#fff] text-sm font-semibold rounded-xl hover:bg-orange-700 transition disabled:opacity-50">
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Salvar
        </button>
      </div>
    </div>
  )
}

function ColorDot({ color, onChange }: { color: string | null; onChange: (c: string) => void }) {
  return (
    <label className="relative w-6 h-6 rounded-full shrink-0 cursor-pointer border border-gray-200 overflow-hidden" title="Cor"
      style={{ backgroundColor: color ?? '#cbd5e1' }}>
      <input type="color" value={color ?? '#6b7280'} onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer" />
    </label>
  )
}
