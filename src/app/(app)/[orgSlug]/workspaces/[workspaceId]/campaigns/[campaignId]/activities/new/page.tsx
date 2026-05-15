'use client'

import { useState, useTransition, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createActivity } from '@/app/actions/activity'
import { STATUS_CONFIG, PRIORITY_CONFIG, COMPLEXITY_CONFIG } from '@/types'
import { ArrowLeft, FolderOpen, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

function todayPrefix() {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yy}${mm}${dd} - `
}

function parseDriveFolder(url: string) {
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (!match) return null
  const id = match[1]
  return {
    root: `https://drive.google.com/drive/folders/${id}`,
    preview: `https://drive.google.com/drive/folders/${id}/preview`,
    redacao: `https://drive.google.com/drive/folders/${id}/redacao`,
    final: `https://drive.google.com/drive/folders/${id}/final`,
  }
}

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
    drive_folder_url: '',
    redacao_url: '',
    layout_url: '',
    finalizacao_url: '',
    orcamento: '',
  })

  // Prefixo automático ao montar
  useEffect(() => {
    setForm((prev) => ({ ...prev, title: todayPrefix() }))
  }, [])

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // Ao colar link da pasta Drive, gera os sublinks automaticamente
  function handleDriveFolder(value: string) {
    set('drive_folder_url', value)
    const parsed = parseDriveFolder(value)
    if (parsed) {
      setForm((prev) => ({
        ...prev,
        drive_folder_url: value,
        layout_url: prev.layout_url || parsed.root,
      }))
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createActivity(orgSlug, workspaceId, campaignId, formData)
      if (result?.error) setError(result.error)
    })
  }

  const driveParsed = parseDriveFolder(form.drive_folder_url)

  return (
    <div className="p-8 max-w-2xl">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Nova atividade</h1>
      <p className="text-gray-500 text-sm mb-8">O prefixo de data é gerado automaticamente.</p>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Título com prefixo */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Título <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            name="title"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder={`${todayPrefix()}WhatsApp - Convite Almoço`}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm"
            required
          />
          <p className="text-xs text-gray-400 mt-1">Formato: AAMMDD - Tipo - Descrição</p>
        </div>

        {/* Descrição */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Objetivo / Briefing <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <textarea
            name="description"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Descreva o objetivo, diretrizes e referências..."
            rows={4}
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
                onClick={() => set('status', s.value)}
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
                <button key={value} type="button" onClick={() => set('priority', value)}
                  className={cn('w-full px-3 py-2.5 rounded-xl border text-sm font-medium text-left transition',
                    form.priority === value ? `${cfg.bgColor} ${cfg.color} border-transparent` : 'border-gray-200 text-gray-700 hover:border-gray-300'
                  )}>
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
                <button key={value} type="button" onClick={() => set('complexity', value)}
                  className={cn('w-full px-3 py-2.5 rounded-xl border text-sm font-medium text-left transition',
                    form.complexity === value ? 'border-gray-800 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:border-gray-300'
                  )}>
                  <span className={form.complexity !== value ? cfg.color : ''}>{cfg.label}</span>
                </button>
              ))}
            </div>
            <input type="hidden" name="complexity" value={form.complexity} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Prazo de entrega</label>
            <input type="datetime-local" name="due_date" value={form.due_date}
              onChange={(e) => set('due_date', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Horas estimadas <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input type="number" name="estimated_hours" value={form.estimated_hours}
              onChange={(e) => set('estimated_hours', e.target.value)}
              placeholder="Ex: 4" min="0.5" step="0.5"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
          </div>
        </div>

        {/* Drive */}
        <div className="border border-gray-200 rounded-xl p-4 space-y-4 bg-gray-50">
          <div className="flex items-center gap-2 mb-1">
            <FolderOpen className="w-4 h-4 text-gray-500" />
            <p className="text-sm font-medium text-gray-700">Pasta do Google Drive</p>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Link da pasta raiz</label>
            <input type="url" name="drive_folder_url" value={form.drive_folder_url}
              onChange={(e) => handleDriveFolder(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white" />
            {driveParsed && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[
                  { label: '📁 preview', url: driveParsed.preview },
                  { label: '📁 redação', url: driveParsed.redacao },
                  { label: '📁 final', url: driveParsed.final },
                ].map(({ label, url }) => (
                  <a key={label} href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-indigo-600 hover:underline truncate">
                    <ExternalLink className="w-3 h-3 shrink-0" /> {label}
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3">
            {[
              { label: 'Redação', name: 'redacao_url', placeholder: 'Link Google Docs...', field: 'redacao_url' },
              { label: 'Layout / Editáveis', name: 'layout_url', placeholder: 'Link Google Drive...', field: 'layout_url' },
              { label: 'Finalização', name: 'finalizacao_url', placeholder: 'Link arquivo final...', field: 'finalizacao_url' },
            ].map(({ label, name, placeholder, field }) => (
              <div key={name} className="flex items-center gap-2">
                <label className="text-xs text-gray-500 w-32 shrink-0">{label}</label>
                <input type="url" name={name} value={form[field as keyof typeof form]}
                  onChange={(e) => set(field, e.target.value)}
                  placeholder={placeholder}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white" />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 w-32 shrink-0">Orçamento</label>
              <input type="text" name="orcamento" value={form.orcamento}
                onChange={(e) => set('orcamento', e.target.value)}
                placeholder="Valor ou link..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white" />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()}
            className="px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button type="submit" disabled={!form.title.trim() || isPending}
            className="flex-1 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed">
            {isPending ? 'Criando...' : 'Criar atividade'}
          </button>
        </div>
      </form>
    </div>
  )
}
