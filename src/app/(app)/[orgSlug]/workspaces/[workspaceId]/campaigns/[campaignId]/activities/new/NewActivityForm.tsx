'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { EditorContent } from '@tiptap/react'
import { createActivity } from '@/app/actions/activity'
import { PRIORITY_CONFIG, COMPLEXITY_CONFIG, type ActivityPriority, type ActivityComplexity } from '@/types'
import { useStatusConfig } from '@/components/ui/StatusBadge'
import { ArrowLeft, FolderOpen, ExternalLink, Sparkles, UserPlus, X, Flag, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { DatePicker } from '@/components/ui/DatePicker'
import { Select } from '@/components/ui/Select'
import { VEICULOS, FORMATOS, composedTitle, hojeISO, somarDias, prefixoDaData } from '@/lib/atividade-titulo'
import {
  useBriefingEditor, useBriefingVazio, BriefingToolbar, FaltandoIA,
  toHTML, isEmptyHtml, briefingToEditorHTML, faltandoToChecklistHTML,
} from '@/components/briefing/BriefingRich'

const VEICULO_OPTIONS = VEICULOS.map(v => ({ value: v, label: v }))
const FORMATO_OPTIONS = FORMATOS.map(f => ({ value: f, label: f }))

// Prazo padrão da casa: 7 dias a partir da entrada na pauta (Rafael, 02/09/2026).
const PRAZO_PADRAO_DIAS = 7
const ATALHOS_PRAZO = [3, 7, 14]

// Bandeiras: verde = Normal (o `medium` do banco, default), amarela = Alta, vermelha =
// Urgente. "Baixa" saiu do seletor — 3 tarefas em 380 usavam — mas continua válida.
const PRIORIDADES: ActivityPriority[] = ['medium', 'high', 'urgent']
// Semáforo: verde = Simples (default), amarelo = Médio, vermelho = Complexo.
const COMPLEXIDADES: ActivityComplexity[] = ['simple', 'medium', 'complex']

export interface MembroSelecionavel {
  userId: string
  fullName: string | null
  email: string
  avatarUrl: string | null
}

/** Valores herdados ao duplicar uma tarefa (?from=<id>). Data e período são de hoje. */
export interface NovaAtividadeInicial {
  fromTitle: string
  veiculo: string
  formato: string
  titulo: string
  description: string | null
  priority: string
  complexity: string
  estimated_hours: number | null
  assigneeIds: string[]
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

/** Semáforo com uma lâmpada acesa — o ícone da complexidade. */
function Semaforo({ aceso, className }: { aceso: ActivityComplexity; className?: string }) {
  const lampada = (nivel: ActivityComplexity, cy: number) => {
    const on = nivel === aceso
    const cor = nivel === 'simple' ? 'fill-green-500' : nivel === 'medium' ? 'fill-yellow-400' : 'fill-red-500'
    return <circle key={nivel} cx="7" cy={cy} r="2.7" className={on ? cor : 'fill-gray-300 dark:fill-gray-600'} />
  }
  return (
    <svg viewBox="0 0 14 26" className={cn('h-5 w-auto', className)} aria-hidden>
      <rect x="1.5" y="1" width="11" height="24" rx="3.5" className="fill-gray-700 dark:fill-gray-500" />
      {lampada('complex', 6)}
      {lampada('medium', 13)}
      {lampada('simple', 20)}
    </svg>
  )
}

export function NewActivityForm({ members, currentUserId, inicial }: {
  members: MembroSelecionavel[]
  currentUserId: string | null
  inicial?: NovaAtividadeInicial | null
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

  // Lista conhece o valor → seleciona; senão "Outro" + texto livre (título antigo duplicado).
  const conhecido = (lista: readonly string[], v: string) => !!v && v !== 'Outro' && lista.includes(v)
  const hoje = hojeISO()
  const [date, setDate] = useState(prefixoDaData(hoje))
  const [veiculo, setVeiculo] = useState(() => !inicial?.veiculo ? '' : conhecido(VEICULOS, inicial.veiculo) ? inicial.veiculo : 'Outro')
  const [veiculoCustom, setVeiculoCustom] = useState(() => inicial?.veiculo && !conhecido(VEICULOS, inicial.veiculo) ? inicial.veiculo : '')
  const [formato, setFormato] = useState(() => !inicial?.formato ? '' : conhecido(FORMATOS, inicial.formato) ? inicial.formato : 'Outro')
  const [formatoCustom, setFormatoCustom] = useState(() => inicial?.formato && !conhecido(FORMATOS, inicial.formato) ? inicial.formato : '')
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '')

  // Tarefa não nasce sem dono: o campo começa vazio DE PROPÓSITO (nada de
  // pré-selecionar quem cria) e trava o envio até alguém ser escolhido. Ao
  // duplicar, herda os responsáveis da origem — escolha explícita, à vista.
  const [assignees, setAssignees] = useState<string[]>(inicial?.assigneeIds ?? [])
  const [respError, setRespError] = useState(false)

  const [form, setForm] = useState({
    status: 'briefing',
    priority: inicial && PRIORIDADES.includes(inicial.priority as ActivityPriority) ? inicial.priority : 'medium',
    complexity: inicial && COMPLEXIDADES.includes(inicial.complexity as ActivityComplexity) ? inicial.complexity : 'simple',
    start_date: hoje,
    due_date: somarDias(hoje, PRAZO_PADRAO_DIAS),
    estimated_hours: inicial?.estimated_hours ? String(inicial.estimated_hours) : '',
    drive_folder_url: '',
  })
  // A pasta no Drive é criada sozinha; colar link é exceção, fica recolhido.
  const [mostrarDrive, setMostrarDrive] = useState(false)

  const { editor, insertImage } = useBriefingEditor({
    content: toHTML(inicial?.description),
    placeholder: 'Objetivo, diretrizes e referências… cole ou solte imagens aqui',
  })
  const briefingVazio = useBriefingVazio(editor)

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
    if (!editor || isImprovingAI) return
    const texto = editor.getText({ blockSeparator: '\n' }).trim()
    if (!texto) return
    setIsImprovingAI(true)
    setFaltandoIA([])
    const anterior = editor.getHTML()
    // Motivo em pt-BR vindo da rota (sobrecarga, sem crédito…); rede/parse cai no genérico.
    let motivo = ''
    try {
      const res = await fetch('/api/ai/improve-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: texto }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { motivo = typeof data.error === 'string' ? data.error : ''; throw new Error('api') }
      if (data.briefing) {
        editor.commands.setContent(briefingToEditorHTML(data.briefing))
        toast.success('Briefing otimizado.', {
          action: { label: 'Desfazer', onClick: () => editor.commands.setContent(anterior) },
        })
      } else if (data.faltando?.length) {
        setFaltandoIA(data.faltando)
      } else {
        toast.error('A IA não retornou um briefing. Tente de novo.')
      }
    } catch {
      toast.error(motivo || 'Não foi possível otimizar o briefing agora.', { duration: motivo ? 8000 : 4000 })
    } finally {
      setIsImprovingAI(false)
    }
  }

  // As perguntas viram checklist no fim do briefing — a pessoa responde ali mesmo.
  function inserirPerguntas() {
    if (!editor || !faltandoIA.length) return
    editor.chain().focus('end').insertContent(faltandoToChecklistHTML(faltandoIA)).run()
    setFaltandoIA([])
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
    const html = editor?.getHTML() ?? ''
    formData.set('description', isEmptyHtml(html) ? '' : html)
    if (driveUrl) formData.set('drive_folder_url', driveUrl)
    for (const id of assignees) formData.append('assignee_ids', id)

    startTransition(async () => {
      const result = await createActivity(orgSlug, workspaceId, campaignId, formData)
      if (result?.error) setError(result.error)
    })
  }

  const inputCls = 'w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'

  return (
    <div className="p-6 sm:p-8 max-w-5xl">
      <button type="button" onClick={() => router.back()}
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
          {inicial && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-orange-500/80 min-w-0">
              <Copy className="w-3 h-3 shrink-0" />
              <span className="truncate">Copiada de: {inicial.fromTitle}</span>
            </p>
          )}
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
                  maxLength={6} placeholder="260515" title="Acompanha o início do período; pode ajustar à mão"
                  className={cn(inputCls, 'font-mono')} />
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
                placeholder="Qual veículo?" autoFocus={!inicial} className={inputCls} />
            )}
            {formato === 'Outro' && (
              <input type="text" value={formatoCustom} onChange={(e) => setFormatoCustom(e.target.value)}
                placeholder="Qual formato?" autoFocus={!inicial} className={inputCls} />
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

            {/* Objetivo / Briefing — o mesmo editor do detalhe: imagem colada/solta vira WebP no volume */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Objetivo / Briefing <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <button
                  type="button"
                  onClick={handleImproveWithAI}
                  disabled={isImprovingAI || briefingVazio}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-full border border-orange-100 transition disabled:opacity-50 disabled:cursor-not-allowed',
                    briefingVazio && 'invisible',
                  )}
                >
                  <Sparkles className={cn('w-3 h-3', isImprovingAI && 'animate-pulse')} />
                  {isImprovingAI ? 'Otimizando...' : 'Otimizar com IA'}
                </button>
              </div>
              <div className="rounded-xl bg-gray-100 border border-transparent focus-within:ring-2 focus-within:ring-orange-500 overflow-hidden transition-shadow">
                <BriefingToolbar editor={editor} insertImage={insertImage} className="border-gray-200/70" />
                <div className="rich-text px-4 py-3 min-h-[240px] max-h-[460px] overflow-y-auto">
                  <EditorContent editor={editor} />
                </div>
              </div>
              <FaltandoIA perguntas={faltandoIA} onInserir={inserirPerguntas} className="mt-2" />
            </div>
          </div>

          {/* Coluna lateral: como a atividade roda */}
          <aside className="space-y-5">

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

            {/* Período: nasce hoje → +7 dias; o AAMMDD do título acompanha o início */}
            <div>
              <DatePicker
                label="Período de execução"
                startDate={form.start_date}
                endDate={form.due_date}
                onStartChange={(v) => { setF('start_date', v); if (v) setDate(prefixoDaData(v)) }}
                onEndChange={(v) => setF('due_date', v)}
              />
              <input type="hidden" name="start_date" value={form.start_date} />
              <input type="hidden" name="due_date" value={form.due_date} />
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-xs text-gray-400 mr-0.5">Prazo</span>
                {ATALHOS_PRAZO.map(n => {
                  const base = form.start_date || hoje
                  const alvo = somarDias(base, n)
                  const ativo = form.due_date === alvo
                  return (
                    <button key={n} type="button"
                      onClick={() => { if (!form.start_date) setF('start_date', base); setF('due_date', alvo) }}
                      className={cn('px-2.5 py-1 rounded-full text-xs border transition-colors active:scale-[0.97]',
                        ativo ? 'bg-orange-100 text-orange-700 border-transparent font-medium' : 'border-gray-200 text-gray-600 hover:border-orange-300 hover:text-orange-600')}>
                      +{n}d
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Prioridade (bandeiras) · Complexidade (semáforo) · Horas */}
            <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Prioridade <span className="text-gray-400 font-normal text-xs">· {PRIORITY_CONFIG[form.priority as ActivityPriority].label}</span>
                </label>
                <div className="flex gap-1.5">
                  {PRIORIDADES.map(v => {
                    const cfg = PRIORITY_CONFIG[v]
                    const on = form.priority === v
                    return (
                      <button key={v} type="button" title={cfg.label} aria-label={`Prioridade ${cfg.label}`} aria-pressed={on}
                        onClick={() => setF('priority', v)}
                        className={cn('w-9 h-9 rounded-lg border flex items-center justify-center transition-colors active:scale-[0.97]',
                          on ? `${cfg.bgColor} border-transparent` : 'border-gray-200 bg-white hover:border-gray-300')}>
                        <Flag className={cn('w-4 h-4', cfg.color, on ? 'fill-current' : 'opacity-60')} />
                      </button>
                    )
                  })}
                </div>
                <input type="hidden" name="priority" value={form.priority} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Complexidade <span className="text-gray-400 font-normal text-xs">· {COMPLEXITY_CONFIG[form.complexity as ActivityComplexity].label}</span>
                </label>
                <div className="flex gap-1.5">
                  {COMPLEXIDADES.map(v => {
                    const cfg = COMPLEXITY_CONFIG[v]
                    const on = form.complexity === v
                    return (
                      <button key={v} type="button" title={cfg.label} aria-label={`Complexidade ${cfg.label}`} aria-pressed={on}
                        onClick={() => setF('complexity', v)}
                        className={cn('w-9 h-9 rounded-lg border flex items-center justify-center transition-colors active:scale-[0.97]',
                          on ? 'bg-gray-100 border-gray-300' : 'border-gray-200 bg-white hover:border-gray-300')}>
                        <Semaforo aceso={v} className={on ? '' : 'opacity-60'} />
                      </button>
                    )
                  })}
                </div>
                <input type="hidden" name="complexity" value={form.complexity} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Horas</label>
                <div className="relative">
                  <input type="number" name="estimated_hours" value={form.estimated_hours}
                    onChange={(e) => setF('estimated_hours', e.target.value)}
                    placeholder="4" min="0.5" step="0.5" title="Horas estimadas"
                    className="w-[4.5rem] h-9 pl-3 pr-6 bg-gray-100 border border-transparent rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">h</span>
                </div>
              </div>
            </div>

            {/* Drive: automático. Vincular pasta existente é exceção, fica recolhido. */}
            <div>
              {!mostrarDrive ? (
                <button type="button" onClick={() => setMostrarDrive(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors text-left">
                  <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                  <span>Pasta no Drive criada automaticamente. <span className="underline underline-offset-2">Vincular uma existente</span></span>
                </button>
              ) : (
                <div className="border border-gray-200 rounded-xl p-3 space-y-2 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
                      <FolderOpen className="w-3.5 h-3.5 text-gray-400" /> Vincular pasta existente
                    </p>
                    <button type="button" onClick={() => { setMostrarDrive(false); setF('drive_folder_url', '') }}
                      aria-label="Fechar" className="text-gray-400 hover:text-gray-600 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input type="url" name="drive_folder_url" value={form.drive_folder_url}
                    onChange={(e) => setF('drive_folder_url', e.target.value)}
                    placeholder="https://drive.google.com/drive/folders/..." autoFocus
                    className="w-full px-3 py-2 bg-white border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                  {driveUrl && (
                    <a href={driveUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-orange-600 hover:underline">
                      <ExternalLink className="w-3 h-3" /> Abrir pasta no Drive
                    </a>
                  )}
                  <p className="text-[11px] text-gray-400">Com link colado, o Flow não cria pasta nova.</p>
                </div>
              )}
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
