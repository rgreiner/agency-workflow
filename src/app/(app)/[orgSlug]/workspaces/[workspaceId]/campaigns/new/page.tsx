'use client'

import { useState, useTransition } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createCampaign } from '@/app/actions/workspace'
import { ArrowLeft } from 'lucide-react'
import { DatePicker } from '@/components/ui/DatePicker'

export default function NewCampaignPage() {
  const { orgSlug, workspaceId } = useParams<{ orgSlug: string; workspaceId: string }>()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    description: '',
    start_date: '',
    end_date: '',
    drive_folder: '',
  })

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createCampaign(orgSlug, workspaceId, formData)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="p-6 max-w-xl">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-5"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <h1 className="text-xl font-semibold text-gray-900 mb-1">Nova campanha</h1>
      <p className="text-gray-500 text-sm mb-6">Adicione uma campanha a este cliente.</p>

      <form onSubmit={handleSubmit} className="space-y-5">

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Nome da campanha <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Ex: Lançamento Verão 2025"
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
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Objetivo, briefing geral..."
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
          />
        </div>

        <DatePicker
          label="Período da campanha"
          placeholder="Definir início e entrega"
          startDate={form.start_date}
          endDate={form.end_date}
          onStartChange={v => set('start_date', v)}
          onEndChange={v => set('end_date', v)}
        />
        <input type="hidden" name="start_date" value={form.start_date} />
        <input type="hidden" name="end_date" value={form.end_date} />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Pasta do Drive <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <input
            type="url"
            name="drive_folder"
            value={form.drive_folder}
            onChange={(e) => set('drive_folder', e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-400 mt-1">As tarefas desta campanha criarão pastas dentro dela automaticamente.</p>
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
            disabled={!form.name.trim() || isPending}
            className="flex-1 py-3 bg-indigo-600 text-[#fff] font-medium rounded-xl hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? 'Criando...' : 'Criar campanha'}
          </button>
        </div>
      </form>
    </div>
  )
}
