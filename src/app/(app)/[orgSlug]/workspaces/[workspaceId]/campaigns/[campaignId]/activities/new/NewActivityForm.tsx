'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createActivity } from '@/app/actions/activity'
import { PRIORITY_CONFIG, COMPLEXITY_CONFIG } from '@/types'
import { useStatusConfig } from '@/components/ui/StatusBadge'
import { ArrowLeft, FolderOpen, ExternalLink, Sparkles, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { DatePicker } from '@/components/ui/DatePicker'
import { Select } from '@/components/ui/Select'

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

const VEICULO_OPTIONS = VEICULOS.map(v => ({ value: v, label: v }))
const FORMATO_OPTIONS = FORMATOS.map(f => ({ value: f, label: f }))

export interface MembroSelecionavel {
  userId: string
  fullName: string | null
  email: string
  avatarUrl: string | null
}

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

function MemberAvatar({ member, size = 'sm' }: { member: MembroSelecionavel; size?: 'sm' | 'md' }) {
  const initials = (member.fullName ?? member.email).charAt(0).toUpperCase()
  const dim = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-7 h-7 text-xs'
  return member.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={member.avatarUrl} alt={member.fullName ?? member.email}
      className={cn(dim, 'rounded-full object-cover shrink-0')} />
  ) : (
    <div className={cn(dim, 'rounded-full bg-orange-100 text-orange-600 font-semibold flex items-center justify-center shrink-0')}>
      {initials}
    </div>
  )
}

/** Seletor de responsáveis da criação: a tarefa não pode nascer sem dono, então
 *  o campo é obrigatório e fica marcado em vermelho quando falta. */
function ResponsavelField({
  members, currentUserId, selected, onChange, showError,
}: {
  members: MembroSelecionavel[]
  currentUserId: string | null
  selected: string[]
  onChange: (ids: string[]) => void
  showError: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function toggle(userId: string) {
    onChange(selected.includes(userId) ? selected.filter(id => id !== userId) : [...selected, userId])
  }

  const assigned = members.filter(m => selected.includes(m.userId))
  const eu = currentUserId ? members.find(m => m.userId === currentUserId) : null

  return (
    <div ref={ref} className="relative">
      <div className={cn(
        'w-full rounded-xl border px-3 py-2.5 min-h-[46px] flex flex-wrap items-center gap-2 transition-colors',
        showError ? 'border-red-300 bg-red-50/60 ring-2 ring-red-100' : 'border-transparent bg-gray-100'
      )}>
        {assigned.map(m => (
          <span key={m.userId}
            className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-full pl-1 pr-2 py-0.5">
            <MemberAvatar member={m} size="sm" />
            <span className="text-xs font-medium text-gray-700 max-w-[110px] truncate">
              {m.fullName ?? m.email.split('@')[0]}
            </span>
            <button type="button" onClick={() => toggle(m.userId)}
              aria-label={`Remover ${m.fullName ?? m.email.split('@')[0]}`}
              className="text-gray-400 hover:text-red-400 transition-colors ml-0.5">
              <X aria-hidden className="w-3 h-3" />
            </button>
          </span>
        ))}

        <button type="button" onClick={() => setOpen(o => !o)}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed text-xs transition-colors',
            showError
              ? 'border-red-300 text-red-500 hover:border-red-400'
              : 'border-gray-300 text-gray-500 hover:border-orange-400 hover:text-orange-500'
          )}>
          <UserPlus className="w-3 h-3" />
          {selected.length === 0 ? 'Escolher responsável' : 'Adicionar'}
        </button>

        {/* Atalho: assumir a tarefa explicitamente, em um clique. */}
        {eu && !selected.includes(eu.userId) && (
          <button type="button" onClick={() => toggle(eu.userId)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-gray-200 bg-white text-xs text-gray-600 hover:border-orange-400 hover:text-orange-600 transition-colors">
            Eu
          </button>
        )}
      </div>

      {open && (
        <div className="pop-in absolute left-0 top-full mt-1 w-64 bg-white rounded-xl border border-gray-200 shadow-lg z-20 py-1 max-h-56 overflow-y-auto">
          {members.length === 0 ? (
            <p className="text-xs text-gray-500 px-3 py-2">Nenhum membro na organização.</p>
          ) : members.map(m => {
            const on = selected.includes(m.userId)
            return (
              <button key={m.userId} type="button"
                onClick={() => toggle(m.userId)}
                className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-gray-50 transition-colors text-left">
                <MemberAvatar member={m} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-800 font-medium truncate">
                    {m.fullName ?? m.email.split('@')[0]}
                    {m.userId === currentUserId && <span className="text-gray-400 font-normal"> (você)</span>}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{m.email}</p>
                </div>
                <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0',
                  on ? 'bg-orange-600 border-orange-600' : 'border-gray-300')}>
                  {on && <span className="w-1.5 h-1.5 rounded-sm bg-white" />}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function NewActivityForm({ members, currentUserId }: {
  members: MembroSelecionavel[]
  currentUserId: string | null
}) {
  const statusCfg = useStatusConfig()
  const { orgSlug, workspaceId, campaignId } = useParams<{
    orgSlug: string; workspaceId: string; campaignId: string
  }>()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [isImprovingAI, setIsImprovingAI] = useState(false)
  // Perguntas devolvidas pela IA quando o rascunho não dá pra estruturar.
  const [faltandoIA, setFaltandoIA] = useState<string[]>([])

  const [date, setDate] = useState(todayPrefix())
  const [veiculo, setVeiculo] = useState('')
  const [veiculoCustom, setVeiculoCustom] = useState('')
  const [formato, setFormato] = useState('')
  const [formatoCustom, setFormatoCustom] = useState('')
  const [titulo, setTitulo] = useState('')

  // Tarefa não nasce sem dono: o campo começa vazio DE PROPÓSITO (nada de
  // pré-selecionar quem cria) e trava o envio até alguém ser escolhido.
  const [assignees, setAssignees] = useState<string[]>([])
  const [respError, setRespError] = useState(false)

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
  const statusSel = statusCfg.find(s => s.value === form.status)

  async function handleImproveWithAI() {
    if (!form.description.trim() || isImprovingAI) return
    setIsImprovingAI(true)
    setFaltandoIA([])
    const anterior = form.description
    try {
      const res = await fetch('/api/ai/improve-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: form.description }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (data.briefing) {
        setF('description', data.briefing)
        toast.success('Briefing otimizado.', {
          action: { label: 'Desfazer', onClick: () => setF('description', anterior) },
        })
      } else if (data.faltando?.length) {
        setFaltandoIA(data.faltando)
      } else {
        toast.error('A IA não retornou um briefing. Tente de novo.')
      }
    } catch {
      toast.error('Não foi possível otimizar o briefing agora.')
    } finally {
      setIsImprovingAI(false)
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!fullTitle.trim() || !titulo.trim()) return
    if (assignees.length === 0) {
      setRespError(true)
      toast.error('Falta escolher o responsável pela tarefa.')
      return
    }

    const formData = new FormData(e.currentTarget)
    formData.set('title', fullTitle)
    if (driveUrl) formData.set('drive_folder_url', driveUrl)
    for (const id of assignees) formData.append('assignee_ids', id)

    startTransition(async () => {
      const result = await createActivity(orgSlug, workspaceId, campaignId, formData)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="p-6 sm:p-8 max-w-5xl">
      <button onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-5">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <h1 className="text-xl font-semibold text-gray-900 mb-1">Nova atividade</h1>
      <p className="text-gray-500 text-sm mb-6">O título é composto automaticamente pelos campos abaixo.</p>

      <form onSubmit={handleSubmit}>

        {/* Preview do título */}
        <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 mb-6">
          <p className="text-xs text-orange-400 mb-1 font-medium">Título gerado</p>
          <p className={cn('font-mono text-sm font-semibold', fullTitle ? 'text-orange-700' : 'text-orange-300')}>
            {fullTitle || `${date} - Veículo - Formato - Título da demanda`}
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-x-10">

          {/* Coluna principal: o que é a atividade */}
          <div className="min-w-0 space-y-6">

            {/* Data · Veículo · Formato */}
            <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Data <span className="text-gray-400 font-normal text-xs">(AAMMDD)</span>
                </label>
                <input type="text" value={date} onChange={(e) => setDate(e.target.value)}
                  maxLength={6} placeholder="260515"
                  className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 font-mono focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Veículo</label>
                <Select value={veiculo} onChange={setVeiculo} options={VEICULO_OPTIONS} placeholder="Selecionar" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Formato</label>
                <Select value={formato} onChange={setFormato} options={FORMATO_OPTIONS} placeholder="Selecionar" />
              </div>
            </div>

            {veiculo === 'Outro' && (
              <input type="text" value={veiculoCustom} onChange={(e) => setVeiculoCustom(e.target.value)}
                placeholder="Qual veículo?" autoFocus
                className="px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent w-full" />
            )}
            {formato === 'Outro' && (
              <input type="text" value={formatoCustom} onChange={(e) => setFormatoCustom(e.target.value)}
                placeholder="Qual formato?" autoFocus
                className="px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent w-full" />
            )}

            {/* Título da demanda */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Título da demanda <span className="text-red-500">*</span>
              </label>
              <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex: Visita a Fruit Attraction 2026"
                className="w-full px-4 py-3 bg-gray-100 border border-transparent rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
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
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-full border border-orange-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Sparkles className={cn('w-3 h-3', isImprovingAI && 'animate-pulse')} />
                    {isImprovingAI ? 'Otimizando...' : 'Otimizar com IA'}
                  </button>
                )}
              </div>
              <textarea name="description" value={form.description}
                onChange={(e) => setF('description', e.target.value)}
                placeholder="Descreva o objetivo, diretrizes e referências..."
                rows={Math.min(20, Math.max(10, form.description.split('\n').length + 1))}
                className="w-full px-4 py-3 bg-gray-100 border border-transparent rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none" />
              {faltandoIA.length > 0 && (
                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-xs font-medium text-amber-800 mb-1.5">
                    Para estruturar o briefing, responda no texto acima:
                  </p>
                  <ul className="space-y-1">
                    {faltandoIA.map((q, i) => (
                      <li key={i} className="text-xs text-amber-700">• {q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Coluna lateral: como a atividade roda */}
          <aside className="space-y-6">

            {/* Responsáveis — obrigatório: tarefa não nasce sem dono */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Responsáveis <span className="text-red-500">*</span>
              </label>
              <ResponsavelField
                members={members}
                currentUserId={currentUserId}
                selected={assignees}
                onChange={(ids) => { setAssignees(ids); if (ids.length > 0) setRespError(false) }}
                showError={respError}
              />
              {respError && (
                <p className="text-xs text-red-600 mt-1.5">
                  Escolha quem responde pela tarefa antes de criar.
                </p>
              )}
            </div>

            {/* Status inicial */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
                Status inicial
                {statusSel && (
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: statusSel.text }} />
                )}
              </label>
              <Select value={form.status} onChange={(v) => setF('status', v)}
                options={statusCfg.filter(s => s.group !== 'done').map(s => ({ value: s.value, label: s.label }))} />
              <input type="hidden" name="status" value={form.status} />
            </div>

            {/* Prioridade */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Prioridade</label>
              <div className="grid grid-cols-3 gap-1.5">
                {Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => (
                  <button key={value} type="button" onClick={() => setF('priority', value)}
                    className={cn('px-2 py-2 rounded-lg border text-xs font-medium text-center transition-colors',
                      form.priority === value ? `${cfg.bgColor} ${cfg.color} border-transparent` : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    )}>
                    {cfg.label}
                  </button>
                ))}
              </div>
              <input type="hidden" name="priority" value={form.priority} />
            </div>

            {/* Complexidade */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Complexidade</label>
              <div className="grid grid-cols-3 gap-1.5">
                {Object.entries(COMPLEXITY_CONFIG).map(([value, cfg]) => (
                  <button key={value} type="button" onClick={() => setF('complexity', value)}
                    className={cn('px-2 py-2 rounded-lg border text-xs font-medium text-center transition-colors',
                      form.complexity === value ? 'border-gray-800 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    )}>
                    <span className={form.complexity !== value ? cfg.color : ''}>{cfg.label}</span>
                  </button>
                ))}
              </div>
              <input type="hidden" name="complexity" value={form.complexity} />
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Horas estimadas</label>
              <input type="number" name="estimated_hours" value={form.estimated_hours}
                onChange={(e) => setF('estimated_hours', e.target.value)}
                placeholder="Ex: 4" min="0.5" step="0.5"
                className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
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
                  className="w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-white" />
                {driveUrl && (
                  <a href={driveUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1.5 text-xs text-orange-600 hover:underline">
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
                <div key={name}>
                  <label className="block text-xs text-gray-500 mb-1">{label}</label>
                  <input type={notUrl ? 'text' : 'url'} name={name}
                    value={form[field as keyof typeof form]}
                    onChange={(e) => setF(field, e.target.value)}
                    placeholder={placeholder}
                    className="w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent bg-white" />
                </div>
              ))}
            </div>
          </aside>
        </div>

        {error && <p className="text-sm text-red-600 mt-6">{error}</p>}

        <div className="flex gap-3 mt-8">
          <button type="button" onClick={() => router.back()}
            className="px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button type="submit" disabled={!titulo.trim() || isPending}
            className="flex-1 py-3 bg-orange-600 text-[#fff] font-medium rounded-xl hover:bg-orange-700 transition disabled:opacity-40 disabled:cursor-not-allowed">
            {isPending ? 'Criando...' : 'Criar atividade'}
          </button>
        </div>
      </form>
    </div>
  )
}
