'use client'

import { useState, useTransition, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createActivity } from '@/app/actions/activity'
import { STATUS_CONFIG, PRIORITY_CONFIG, COMPLEXITY_CONFIG } from '@/types'
import { ArrowLeft, FolderOpen, ExternalLink, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DatePicker } from '@/components/ui/DatePicker'

const VEICULOS = [
  'Meta', 'Instagram', 'Facebook', 'WhatsApp', 'TikTok',
  'YouTube', 'Google Ads', 'LinkedIn', 'E-mail', 'Impresso',
  'TV', 'Rádio', 'Site', 'Outro',
]

const FORMATOS = [
  'Carrossel', 'Post', 'Stories', 'Reels', 'Vídeo',
  'Banner', 'Arte estática', 'GIF', 'Identidade Visual',
  'Texto', 'Roteiro', 'Apresentação', 'Outro',
]

function todayPrefix() {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yy}${mm}${dd}`
}

function composedTitle(date: string, veiculo: string, formato: string, titulo: string) {
  return [date, veiculo, formato, titulo].filter(Boolean).join(' - ')
}

function parseDriveId(url: string): string | null {
  // https://drive.google.com/drive/folders/ID
  let m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  // https://drive.google.com/open?id=ID
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  // https://drive.google.com/file/d/ID/view
  m = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  return null
}

function driveOpenUrl(id: string) {
  return `https://drive.google.com/drive/folders/${id}`
}

export default function NewActivityPage() {
  const { orgSlug, workspaceId, campaignId } = useParams<{
    orgSlug: string; workspaceId: string; campaignId: string
  }>()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [isImprovingAI, setIsImprovingAI] = useState(false)

  const [date, setDate] = useState(todayPrefix())
  const [veiculo, setVeiculo] = useState('')
  const [veiculoCustom, setVeiculoCustom] = useState('')
  const [formato, setFormato] = useState('')
  const [formatoCustom, setFormatoCustom] = useState('')
  const [titulo, setTitulo] = useState('')

  const [form, setForm] = useState({
    description: '',
    status: 'briefing',
    priority: 'medium',
    complexity: 'medium',
    start_date: '',
    due_date: '',
    estimated_hours: '',
    drive_folder_url: '',
    redacao_url: '',
    layout_url: '',
    finalizacao_url: '',
    orcamento: '',
  })

  function setF(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const veiculoFinal = veiculo === 'Outro' ? veiculoCustom : veiculo
  const formatoFinal = formato === 'Outro' ? formatoCustom : formato
  const fullTitle = composedTitle(date, veiculoFinal, formatoFinal, titulo)

  const driveId = parseDriveId(form.drive_folder_url)
  const driveUrl = driveId ? driveOpenUrl(driveId) : null

  async function handleImproveWithAI() {
    if (!form.description.trim() || isImprovingAI) return
    setIsImprovingAI(true)
    try {
      const res = await fetch('/api/ai/improve-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: form.description }),
      })
      const data = await res.json()
      if (data.improved) setF('description', data.improved)
    } catch {
      // silently fail — user keeps original text
    } finally {
      setIsImprovingAI(false)
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!fullTitle.trim() || !titulo.trim()) return

    const formData = new FormData(e.currentTarget)
    formData.set('title', fullTitle)
    if (driveUrl) formData.set('drive_folder_url', driveUrl)

    startTransition(async () => {
      const result = await createActivity(orgSlug, workspaceId, campaignId, formData)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="p-6 max-w-2xl">
      <button onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-5">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <h1 className="text-xl font-semibold text-gray-900 mb-1">Nova atividade</h1>
      <p className="text-gray-500 text-sm mb-6">O título é composto automaticamente pelos campos abaixo.</p>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Preview do título */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
          <p className="text-xs text-indigo-400 mb-1 font-medium">Título gerado</p>
          <p className={cn('font-mono text-sm font-semibold', fullTitle ? 'text-indigo-700' : 'text-indigo-300')}>
            {fullTitle || `${date} - Veículo - Formato - Título da demanda`}
          </p>
        </div>

        {/* Linha 1: Data */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Data <span className="text-gray-400 font-normal text-xs">(AAMMDD)</span>
          </label>
          <input type="text" value={date} onChange={(e) => setDate(e.target.value)}
            maxLength={6} placeholder="260515"
            className="w-40 px-4 py-3 border border-gray-300 rounded-xl text-gray-900 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
        </div>

        {/* Veículo */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Veículo</label>
          <div className="flex flex-wrap gap-2">
            {VEICULOS.map((v) => (
              <button key={v} type="button" onClick={() => setVeiculo(v)}
                className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition',
                  veiculo === v ? 'bg-gray-900 text-white border-transparent' : 'border-gray-200 text-gray-600 hover:border-gray-400'
                )}>
                {v}
              </button>
            ))}
          </div>
          {veiculo === 'Outro' && (
            <input type="text" value={veiculoCustom} onChange={(e) => setVeiculoCustom(e.target.value)}
              placeholder="Qual veículo?" autoFocus
              className="mt-2 px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-full" />
          )}
        </div>

        {/* Formato */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Formato</label>
          <div className="flex flex-wrap gap-2">
            {FORMATOS.map((f) => (
              <button key={f} type="button" onClick={() => setFormato(f)}
                className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition',
                  formato === f ? 'bg-gray-900 text-white border-transparent' : 'border-gray-200 text-gray-600 hover:border-gray-400'
                )}>
                {f}
              </button>
            ))}
          </div>
          {formato === 'Outro' && (
            <input type="text" value={formatoCustom} onChange={(e) => setFormatoCustom(e.target.value)}
              placeholder="Qual formato?" autoFocus
              className="mt-2 px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-full" />
          )}
        </div>

        {/* Título da demanda */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Título da demanda <span className="text-red-500">*</span>
          </label>
          <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex: Visita a Fruit Attraction 2026"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            required />
        </div>

        {/* Descrição / Briefing */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-gray-700">
              Objetivo / Briefing <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            {form.description.trim() && (
              <button
                type="button"
                onClick={handleImproveWithAI}
                disabled={isImprovingAI}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-full border border-indigo-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className={cn('w-3 h-3', isImprovingAI && 'animate-pulse')} />
                {isImprovingAI ? 'Melhorando...' : 'Melhorar com IA'}
              </button>
            )}
          </div>
          <textarea name="description" value={form.description}
            onChange={(e) => setF('description', e.target.value)}
            placeholder="Descreva o objetivo, diretrizes e referências..."
            rows={4}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none" />
        </div>

        {/* Status inicial */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Status inicial</label>
          <div className="flex flex-wrap gap-2">
            {STATUS_CONFIG.filter(s => s.group !== 'done').map((s) => (
              <button key={s.value} type="button" onClick={() => setF('status', s.value)}
                className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition',
                  form.status === s.value ? `${s.bgColor} ${s.color} border-transparent` : 'border-gray-200 text-gray-600 hover:border-gray-300'
                )}>
                {s.label}
              </button>
            ))}
          </div>
          <input type="hidden" name="status" value={form.status} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Prioridade</label>
            <div className="space-y-2">
              {Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => (
                <button key={value} type="button" onClick={() => setF('priority', value)}
                  className={cn('w-full px-3 py-2.5 rounded-xl border text-sm font-medium text-left transition',
                    form.priority === value ? `${cfg.bgColor} ${cfg.color} border-transparent` : 'border-gray-200 text-gray-700 hover:border-gray-300'
                  )}>
                  {cfg.label}
                </button>
              ))}
            </div>
            <input type="hidden" name="priority" value={form.priority} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Complexidade</label>
            <div className="space-y-2">
              {Object.entries(COMPLEXITY_CONFIG).map(([value, cfg]) => (
                <button key={value} type="button" onClick={() => setF('complexity', value)}
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

        <div>
          <DatePicker
            label="Período de execução"
            startDate={form.start_date}
            endDate={form.due_date}
            onStartChange={(v) => setF('start_date', v)}
            onEndChange={(v) => setF('due_date', v)}
          />
          <input type="hidden" name="start_date" value={form.start_date} />
          <input type="hidden" name="due_date" value={form.due_date} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Horas estimadas</label>
            <input type="number" name="estimated_hours" value={form.estimated_hours}
              onChange={(e) => setF('estimated_hours', e.target.value)}
              placeholder="Ex: 4" min="0.5" step="0.5"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
          </div>
        </div>

        {/* Drive */}
        <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-gray-400" />
            <p className="text-sm font-medium text-gray-700">Arquivos no Google Drive</p>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Link da pasta principal</label>
            <input type="url" name="drive_folder_url" value={form.drive_folder_url}
              onChange={(e) => setF('drive_folder_url', e.target.value)}
              placeholder="https://drive.google.com/drive/folders/... ou open?id=..."
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white" />
            {driveUrl && (
              <a href={driveUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1.5 text-xs text-indigo-600 hover:underline">
                <ExternalLink className="w-3 h-3" /> Abrir pasta no Drive
              </a>
            )}
          </div>

          {[
            { label: 'Redação', name: 'redacao_url', placeholder: 'Google Docs...', field: 'redacao_url' },
            { label: 'Layout / Editáveis', name: 'layout_url', placeholder: 'Google Drive...', field: 'layout_url' },
            { label: 'Finalização', name: 'finalizacao_url', placeholder: 'Arquivo final...', field: 'finalizacao_url' },
            { label: 'Orçamento', name: 'orcamento', placeholder: 'Valor ou link...', field: 'orcamento', notUrl: true },
          ].map(({ label, name, placeholder, field, notUrl }) => (
            <div key={name} className="flex items-center gap-2">
              <label className="text-xs text-gray-500 w-32 shrink-0">{label}</label>
              <input type={notUrl ? 'text' : 'url'} name={name}
                value={form[field as keyof typeof form]}
                onChange={(e) => setF(field, e.target.value)}
                placeholder={placeholder}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white" />
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()}
            className="px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button type="submit" disabled={!titulo.trim() || isPending}
            className="flex-1 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed">
            {isPending ? 'Criando...' : 'Criar atividade'}
          </button>
        </div>
      </form>
    </div>
  )
}
