'use client'

/**
 * Briefing do detalhe da tarefa: leitura com HTML sanitizado e edição inline
 * (salvar/cancelar) sobre o editor compartilhado de components/briefing/BriefingRich —
 * o mesmo que a criação usa, então imagem, checklist e a otimização por IA se
 * comportam igual nos dois lugares.
 */
import { useState, useTransition } from 'react'
import { EditorContent } from '@tiptap/react'
import { Check, Loader2, Pencil, Sparkles } from 'lucide-react'
import { updateActivityField } from '@/app/actions/activity'
import { sanitizeHtml } from '@/lib/sanitize'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  useBriefingEditor, BriefingToolbar, FaltandoIA,
  isHtml, toHTML, isEmptyHtml, briefingToEditorHTML, faltandoToChecklistHTML,
} from '@/components/briefing/BriefingRich'

export function BriefingEditor({ activityId, path, description, canEdit }: {
  activityId: string
  path: string
  description: string | null
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [isImproving, setIsImproving] = useState(false)
  // Perguntas devolvidas pela IA quando o rascunho não dá pra estruturar.
  const [faltandoIA, setFaltandoIA] = useState<string[]>([])
  const { editor, insertImage } = useBriefingEditor({ content: toHTML(description) })

  function start() {
    editor?.commands.setContent(toHTML(description))
    setFaltandoIA([])
    setEditing(true)
    setTimeout(() => editor?.commands.focus('end'), 30)
  }

  async function otimizar() {
    if (!editor || isImproving) return
    const texto = editor.getText({ blockSeparator: '\n' }).trim()
    if (!texto) return
    setIsImproving(true)
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
      setIsImproving(false)
    }
  }

  // As perguntas viram checklist no fim do briefing — a pessoa responde ali mesmo.
  function inserirPerguntas() {
    if (!editor || !faltandoIA.length) return
    editor.chain().focus('end').insertContent(faltandoToChecklistHTML(faltandoIA)).run()
    setFaltandoIA([])
  }

  function save() {
    if (!editor) return
    const html = editor.getHTML()
    const value = isEmptyHtml(html) ? null : html
    startTransition(async () => {
      const r = await updateActivityField(path, activityId, 'description', value)
      if (r?.error) toast.error(r.error)
      else { toast.success('Briefing atualizado.'); setEditing(false) }
    })
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-orange-300 bg-white overflow-hidden">
        <BriefingToolbar editor={editor} insertImage={insertImage} />

        <div className="rich-text px-3 py-2.5 max-h-[420px] overflow-y-auto">
          <EditorContent editor={editor} />
        </div>

        <FaltandoIA perguntas={faltandoIA} onInserir={inserirPerguntas} className="mx-2 mb-2" />

        <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-gray-100 bg-gray-50/50">
          <button type="button" onClick={otimizar} disabled={isImproving}
            className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-full border border-orange-100 transition disabled:opacity-50 disabled:cursor-not-allowed">
            <Sparkles className={cn('w-3 h-3', isImproving && 'animate-pulse')} />
            {isImproving ? 'Otimizando...' : 'Otimizar com IA'}
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { setFaltandoIA([]); setEditing(false) }} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancelar</button>
            <button type="button" onClick={save} disabled={isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-50 transition">
              {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Salvar
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group/desc flex items-start gap-2">
      <div className="flex-1 min-w-0">
        {description ? (
          isHtml(description)
            ? <div className="rich-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(description) }} />
            : <p className="rich-text whitespace-pre-wrap">{description}</p>
        ) : canEdit ? (
          <button type="button" onClick={start} className="text-sm text-gray-500 hover:text-gray-700 transition-colors italic">Adicionar briefing…</button>
        ) : null}
      </div>
      {canEdit && description && (
        <button type="button" onClick={start} title="Editar briefing"
          className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover/desc:opacity-100 focus-visible:opacity-100 transition shrink-0">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
