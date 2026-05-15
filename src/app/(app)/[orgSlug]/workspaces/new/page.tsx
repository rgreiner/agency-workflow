'use client'

import { useState, useTransition } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createWorkspace } from '@/app/actions/workspace'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#0ea5e9', '#64748b',
]

export default function NewWorkspacePage() {
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(COLORS[0])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set('color', color)
    startTransition(async () => {
      const result = await createWorkspace(orgSlug, formData)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="p-8 max-w-xl">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Novo cliente</h1>
      <p className="text-gray-500 text-sm mb-8">Crie um espaço de trabalho para este cliente.</p>

      <form onSubmit={handleSubmit} className="space-y-5">

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Nome do cliente <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Empresa ABC"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Descrição <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <textarea
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Observações sobre o cliente..."
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Cor de identificação
          </label>
          <div className="flex gap-2 flex-wrap">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  'w-8 h-8 rounded-full transition ring-offset-2',
                  color === c ? 'ring-2 ring-gray-800' : 'hover:scale-110'
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* Preview */}
        {name && (
          <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-semibold shrink-0"
              style={{ backgroundColor: color }}
            >
              {name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{name}</p>
              {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!name.trim() || isPending}
            className="flex-1 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? 'Criando...' : 'Criar cliente'}
          </button>
        </div>
      </form>
    </div>
  )
}
