'use client'

import { useState, useTransition } from 'react'
import { Plus, Trash2, Loader2, Tag, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { setFinanceConfig, type FinanceCategoria, type FinanceCentro } from '@/app/actions/financeiro'
import { toast } from 'sonner'

const COR_PRESETS = ['#f97316', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#eab308', '#14b8a6', '#ef4444', '#6b7280']

const TIPO_OPTIONS = [
  { value: 'ambos', label: 'Ambos' },
  { value: 'entrada', label: 'Entrada' },
  { value: 'saida', label: 'Saída' },
]

const inputCls =
  'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'

export function CategoriasClient({ orgSlug, categorias: initCats, centros: initCentros }: {
  orgSlug: string; categorias: FinanceCategoria[]; centros: FinanceCentro[]
}) {
  const [cats, setCats] = useState<FinanceCategoria[]>(initCats)
  const [centros, setCentros] = useState<FinanceCentro[]>(initCentros)
  const [isPending, startTransition] = useTransition()

  function save() {
    const cleanCats = cats.filter(c => c.nome.trim())
    const cleanCentros = centros.filter(c => c.nome.trim())
    startTransition(async () => {
      const res = await setFinanceConfig(orgSlug, cleanCats, cleanCentros)
      if (res?.error) toast.error(res.error)
      else { toast.success('Configuração salva!'); setCats(cleanCats); setCentros(cleanCentros) }
    })
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900">Categorias e centros de custo</h1>
        <p className="text-gray-500 text-sm mt-0.5">Classificam os lançamentos do financeiro. Cada um com sua cor.</p>
      </div>

      {/* Categorias */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Tag className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900">Categorias</h2>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50">
          {cats.length === 0 && <p className="text-sm text-gray-400 px-4 py-4">Nenhuma categoria. Adicione abaixo.</p>}
          {cats.map((cat, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2.5">
              <ColorDot color={cat.cor} onChange={cor => setCats(prev => prev.map((c, j) => j === i ? { ...c, cor } : c))} />
              <input value={cat.nome} placeholder="Nome da categoria"
                onChange={e => setCats(prev => prev.map((c, j) => j === i ? { ...c, nome: e.target.value } : c))}
                className={cn(inputCls, 'flex-1')} />
              <div className="w-32 shrink-0">
                <Select value={cat.tipo || 'ambos'} size="sm"
                  onChange={v => setCats(prev => prev.map((c, j) => j === i ? { ...c, tipo: v } : c))}
                  options={TIPO_OPTIONS} />
              </div>
              <button onClick={() => setCats(prev => prev.filter((_, j) => j !== i))}
                className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition" title="Remover">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button onClick={() => setCats(prev => [...prev, { nome: '', tipo: 'ambos', cor: COR_PRESETS[prev.length % COR_PRESETS.length] }])}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-orange-600 hover:bg-orange-50/50 transition w-full">
            <Plus className="w-4 h-4" /> Adicionar categoria
          </button>
        </div>
      </section>

      {/* Centros de custo */}
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
    <label className="relative w-7 h-7 rounded-full shrink-0 cursor-pointer border border-gray-200 overflow-hidden" title="Cor"
      style={{ backgroundColor: color ?? '#cbd5e1' }}>
      <input type="color" value={color ?? '#6b7280'} onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer" />
    </label>
  )
}
