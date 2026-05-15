'use client'

import { useState, useTransition } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createActivity } from '@/app/actions/activity'
import { STATUS_CONFIG, PRIORITY_CONFIG, COMPLEXITY_CONFIG } from '@/types'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

const INTERNAL_STATUSES = STATUS_CONFIG.filter((s) => s.group === 'internal').slice(0, 6)

export default function NewActivityPage() {
  const { orgSlug, workspaceId, campaignId } = useParams<{
    orgSlug: string; workspaceId: string; campaignId: string
  }>()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    title: '',
    description: '',
    status: 'briefing',
    priority: 'medium',
    complexity: 'medium',
    due_date: '',
    estimated_hours: '',
  })

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createActivity(orgSlug, workspaceId, campaignId, formData)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="p-8 max-w-2xl">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Nova atividade</h1>
      <p className="text-gray-500 text-sm mb-8">Adicione uma atividade à campanha.</p>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Título */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Título <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            name="title"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Ex: Criação de artes para Stories"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            required
          />
        </div>

        {/* Descrição */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Descrição <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <textarea
            name="description"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Detalhes, referências, observações..."
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
          />
        </div>

        {/* Status inicial */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Status inicial</label>
          <div className="flex flex-wrap gap-2">
            {STATUS_CONFIG.filter(s => s.group !== 'done').map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => { set('status', s.value); (document.querySelector('input[name="status"]') as HTMLInputElement).value = s.value }}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition',
                  form.status === s.value
                    ? `${s.bgColor} ${s.color} border-transparent`
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <input type="hidden" name="status" value={form.status} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Prioridade */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Prioridade</label>
            <div className="space-y-2">
              {Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { set('priority', value); (document.querySelector('input[name="priority"]') as HTMLInputElement).value = value }}
                  className={cn(
                    'w-full px-3 py-2.5 rounded-xl border text-sm font-medium text-left transition',
                    form.priority === value
                      ? `${cfg.bgColor} ${cfg.color} border-transparent`
                      : 'border-gray-200 text-gray-700 hover:border-gray-300'
                  )}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
            <input type="hidden" name="priority" value={form.priority} />
          </div>

          {/* Complexidade */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Complexidade</label>
            <div className="space-y-2">
              {Object.entries(COMPLEXITY_CONFIG).map(([value, cfg]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { set('complexity', value); (document.querySelector('input[name="complexity"]') as HTMLInputElement).value = value }}
                  className={cn(
                    'w-full px-3 py-2.5 rounded-xl border text-sm font-medium text-left transition',
                    form.complexity === value
                      ? 'border-gray-800 bg-gray-900 text-white'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300'
                  )}
                >
                  <span className={form.complexity !== value ? cfg.color : ''}>{cfg.label}</span>
                </button>
              ))}
            </div>
            <input type="hidden" name="complexity" value={form.complexity} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Prazo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Prazo de entrega</label>
            <input
              type="datetime-local"
              name="due_date"
              value={form.due_date}
              onChange={(e) => set('due_date', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Horas estimadas */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Horas estimadas <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input
              type="number"
              name="estimated_hours"
              value={form.estimated_hours}
              onChange={(e) => set('estimated_hours', e.target.value)}
              placeholder="Ex: 4"
              min="0.5"
              step="0.5"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>

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
            disabled={!form.title.trim() || isPending}
            className="flex-1 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? 'Criando...' : 'Criar atividade'}
          </button>
        </div>
      </form>
    </div>
  )
}
