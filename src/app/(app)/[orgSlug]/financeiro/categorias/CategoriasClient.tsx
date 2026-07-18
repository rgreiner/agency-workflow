'use client'

import { useMemo, useState, useTransition } from 'react'
import { Plus, Trash2, Loader2, Building2, ChevronRight, Search, CornerDownRight, Archive, ArchiveRestore } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setFinanceConfig, type FinanceCategoriaGrupo, type FinanceCentro } from '@/app/actions/financeiro'
import { toast } from 'sonner'

const COR_PRESETS = ['#22c55e', '#3b82f6', '#8b5cf6', '#f97316', '#ec4899', '#eab308', '#14b8a6', '#ef4444', '#6b7280']
const corReceita = '#22c55e'
const corDespesa = '#ef4444'

const rowInput =
  'flex-1 min-w-0 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none rounded px-1 py-0.5 focus:bg-gray-50'

type Tab = 'entrada' | 'saida'

export function CategoriasClient({ orgSlug, categorias: initCats, centros: initCentros }: {
  orgSlug: string; categorias: FinanceCategoriaGrupo[]; centros: FinanceCentro[]
}) {
  const [grupos, setGrupos] = useState<FinanceCategoriaGrupo[]>(initCats)
  const [centros, setCentros] = useState<FinanceCentro[]>(initCentros)
  const [tab, setTab] = useState<Tab>('entrada')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [showArq, setShowArq] = useState(false)
  const [isPending, startTransition] = useTransition()

  const setCentro = (i: number, patch: Partial<FinanceCentro>) => setCentros(prev => prev.map((c, j) => j === i ? { ...c, ...patch } : c))
  const removeCentro = (i: number) => setCentros(prev => prev.filter((_, j) => j !== i))

  const updateGrupo = (gi: number, patch: Partial<FinanceCategoriaGrupo>) =>
    setGrupos(prev => prev.map((g, i) => i === gi ? { ...g, ...patch } : g))
  const removeGrupo = (gi: number) => setGrupos(prev => prev.filter((_, i) => i !== gi))
  const addFilho = (gi: number) => {
    setGrupos(prev => prev.map((g, i) => i === gi ? { ...g, filhos: [...g.filhos, { nome: '', cor: g.cor }] } : g))
    setOpen(prev => new Set(prev).add(gi))
  }
  const updateFilho = (gi: number, fi: number, nome: string) =>
    setGrupos(prev => prev.map((g, i) => i === gi ? { ...g, filhos: g.filhos.map((f, j) => j === fi ? { ...f, nome } : f) } : g))
  const removeFilho = (gi: number, fi: number) =>
    setGrupos(prev => prev.map((g, i) => i === gi ? { ...g, filhos: g.filhos.filter((_, j) => j !== fi) } : g))
  const addGrupo = () =>
    setGrupos(prev => [...prev, { nome: '', tipo: tab, cor: tab === 'entrada' ? corReceita : corDespesa, filhos: [] }])
  const toggle = (gi: number) => setOpen(prev => { const n = new Set(prev); if (n.has(gi)) n.delete(gi); else n.add(gi); return n })

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

  const count = (t: Tab) => grupos.filter(g => g.tipo === t || g.tipo === 'ambos').length

  // Itens da aba (inclui 'ambos'), filtrados pela busca.
  const visiveis = useMemo(() => {
    const q = query.trim().toLowerCase()
    return grupos
      .map((g, gi) => ({ g, gi }))
      .filter(({ g }) => g.tipo === tab || g.tipo === 'ambos')
      .filter(({ g }) => !q || g.nome.toLowerCase().includes(q) || g.filhos.some(f => f.nome.toLowerCase().includes(q)))
  }, [grupos, tab, query])

  const centrosAtivos = useMemo(() => centros.map((ce, i) => ({ ce, i })).filter(({ ce }) => !ce.arquivado), [centros])
  const centrosArquivados = useMemo(() => centros.map((ce, i) => ({ ce, i })).filter(({ ce }) => ce.arquivado), [centros])

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Categorias e centros de custo</h1>
          <p className="text-gray-500 text-sm mt-0.5">Categorias por receita e despesa (agrupe quando fizer sentido) e centros de custo.</p>
        </div>
        <SaveButton onClick={save} pending={isPending} />
      </div>

      {/* Abas + busca */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          <button onClick={() => setTab('entrada')}
            className={cn('px-4 py-1.5 rounded-md transition', tab === 'entrada' ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>
            Receita · {count('entrada')}
          </button>
          <button onClick={() => setTab('saida')}
            className={cn('px-4 py-1.5 rounded-md transition', tab === 'saida' ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>
            Despesa · {count('saida')}
          </button>
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar categoria"
            className="w-full pl-9 pr-3 py-2 bg-gray-100 border border-transparent rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
        </div>
      </div>

      {/* Grade compacta: linha slim quando não tem subcategoria; card colapsável quando tem. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {visiveis.map(({ g, gi }) => g.filhos.length === 0 ? (
          <div key={gi} className="group flex items-center gap-2 bg-white border border-gray-200 rounded-lg pl-2.5 pr-1.5 py-1.5 hover:border-gray-300 transition-colors">
            <ColorDot color={g.cor} onChange={cor => updateGrupo(gi, { cor })} />
            <input value={g.nome} placeholder="Nome da categoria"
              onChange={e => updateGrupo(gi, { nome: e.target.value })} className={cn(rowInput, 'font-medium')} />
            {g.tipo === 'ambos' && <span className="text-[10px] font-medium text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 shrink-0">ambos</span>}
            <button onClick={() => addFilho(gi)} title="Adicionar subcategoria"
              className="p-1 rounded text-gray-300 hover:text-orange-600 opacity-0 group-hover:opacity-100 transition shrink-0"><Plus className="w-3.5 h-3.5" /></button>
            <button onClick={() => removeGrupo(gi)} title="Remover"
              className="p-1 rounded text-gray-300 hover:text-red-500 transition shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ) : (
          <div key={gi} className="sm:col-span-2 bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 pl-1.5 pr-1.5 py-1.5 bg-gray-50/60">
              <button onClick={() => toggle(gi)} className="p-1 rounded text-gray-400 hover:bg-gray-100 transition shrink-0">
                <ChevronRight className={cn('w-4 h-4 transition-transform', open.has(gi) && 'rotate-90')} />
              </button>
              <ColorDot color={g.cor} onChange={cor => updateGrupo(gi, { cor })} />
              <input value={g.nome} placeholder="Nome do grupo"
                onChange={e => updateGrupo(gi, { nome: e.target.value })} className={cn(rowInput, 'font-medium')} />
              <span className="text-[11px] text-gray-400 shrink-0">{g.filhos.length}</span>
              {g.tipo === 'ambos' && <span className="text-[10px] font-medium text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 shrink-0">ambos</span>}
              <button onClick={() => addFilho(gi)} title="Adicionar subcategoria"
                className="p-1 rounded text-gray-400 hover:text-orange-600 transition shrink-0"><Plus className="w-3.5 h-3.5" /></button>
              <button onClick={() => removeGrupo(gi)} title="Remover grupo"
                className="p-1 rounded text-gray-300 hover:text-red-500 transition shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            {open.has(gi) && (
              <div className="divide-y divide-gray-50">
                {g.filhos.map((f, fi) => (
                  <div key={fi} className="flex items-center gap-2 pl-9 pr-1.5 py-1.5">
                    <CornerDownRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: f.cor ?? g.cor ?? '#cbd5e1' }} />
                    <input value={f.nome} placeholder="Nome da subcategoria"
                      onChange={e => updateFilho(gi, fi, e.target.value)} className={rowInput} />
                    <button onClick={() => removeFilho(gi, fi)} title="Remover"
                      className="p-1 rounded text-gray-300 hover:text-red-500 transition shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {visiveis.length === 0 && (
        <p className="text-sm text-gray-400 px-1 py-4">{query ? 'Nenhuma categoria encontrada.' : `Nenhuma categoria de ${tab === 'entrada' ? 'receita' : 'despesa'}.`}</p>
      )}

      <button onClick={addGrupo}
        className="flex items-center justify-center gap-2 px-4 py-2.5 mb-8 text-sm text-orange-600 hover:bg-orange-50/50 rounded-xl border border-dashed border-orange-200 transition w-full">
        <Plus className="w-4 h-4" /> Adicionar categoria de {tab === 'entrada' ? 'receita' : 'despesa'}
      </button>

      {/* Centros de custo — grade compacta, com arquivamento */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900">Centros de custo</h2>
          <span className="text-xs text-gray-400">{centrosAtivos.length}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {centrosAtivos.map(({ ce, i }) => (
            <div key={i} className="group flex items-center gap-2 bg-white border border-gray-200 rounded-lg pl-2.5 pr-1.5 py-1.5 hover:border-gray-300 transition-colors">
              <ColorDot color={ce.cor} onChange={cor => setCentro(i, { cor })} />
              <input value={ce.nome} placeholder="Nome do centro de custo"
                onChange={e => setCentro(i, { nome: e.target.value })} className={rowInput} />
              <button onClick={() => setCentro(i, { arquivado: true })} title="Arquivar (cliente inativo)"
                className="p-1 rounded text-gray-300 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition shrink-0"><Archive className="w-3.5 h-3.5" /></button>
              <button onClick={() => removeCentro(i)} title="Remover"
                className="p-1 rounded text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
        <button onClick={() => setCentros(prev => [...prev, { nome: '', cor: COR_PRESETS[prev.length % COR_PRESETS.length] }])}
          className="flex items-center gap-2 px-4 py-2.5 mt-2 text-sm text-orange-600 hover:bg-orange-50/50 rounded-xl border border-dashed border-orange-200 transition w-full justify-center">
          <Plus className="w-4 h-4" /> Adicionar centro de custo
        </button>

        {centrosArquivados.length > 0 && (
          <div className="mt-3">
            <button onClick={() => setShowArq(v => !v)} className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition">
              <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', showArq && 'rotate-90')} />
              Arquivados · {centrosArquivados.length}
            </button>
            {showArq && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                {centrosArquivados.map(({ ce, i }) => (
                  <div key={i} className="group flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-lg pl-2.5 pr-1.5 py-1.5">
                    <span className="w-5 h-5 rounded-full shrink-0 border border-gray-200 opacity-60" style={{ backgroundColor: ce.cor ?? '#cbd5e1' }} />
                    <span className="flex-1 min-w-0 text-sm text-gray-500 truncate">{ce.nome}</span>
                    <button onClick={() => setCentro(i, { arquivado: false })} title="Desarquivar"
                      className="p-1 rounded text-gray-400 hover:text-emerald-600 transition shrink-0"><ArchiveRestore className="w-3.5 h-3.5" /></button>
                    <button onClick={() => removeCentro(i)} title="Remover"
                      className="p-1 rounded text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <SaveButton onClick={save} pending={isPending} />
      </div>
    </div>
  )
}

function SaveButton({ onClick, pending }: { onClick: () => void; pending: boolean }) {
  return (
    <button onClick={onClick} disabled={pending}
      className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-[#fff] text-sm font-semibold rounded-xl hover:bg-orange-700 transition disabled:opacity-50 shrink-0">
      {pending && <Loader2 className="w-4 h-4 animate-spin" />}
      Salvar
    </button>
  )
}

function ColorDot({ color, onChange }: { color: string | null; onChange: (c: string) => void }) {
  return (
    <label className="relative w-5 h-5 rounded-full shrink-0 cursor-pointer border border-gray-200 overflow-hidden" title="Cor"
      style={{ backgroundColor: color ?? '#cbd5e1' }}>
      <input type="color" value={color ?? '#6b7280'} onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer" />
    </label>
  )
}
