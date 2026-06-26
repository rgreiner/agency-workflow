'use client'

/**
 * Briefing com formatação simples (Tiptap): títulos, negrito, itálico, listas,
 * citação. Guarda HTML na coluna `description` (compatível com textos antigos em
 * texto puro). Edição inline com salvar/cancelar.
 */
import { useState, useTransition } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold, Italic, Strikethrough, Heading2, Heading3,
  List, ListOrdered, Quote, Link2, Check, Loader2, Pencil,
} from 'lucide-react'
import { updateActivityField } from '@/app/actions/activity'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const isHtml = (s: string) => /^\s*</.test(s)

/** Texto antigo (puro) → HTML simples preservando parágrafos/quebras. */
function toHTML(desc: string | null): string {
  if (!desc) return ''
  if (isHtml(desc)) return desc
  const esc = desc.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
}

const isEmptyHtml = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === ''

export function BriefingEditor({ activityId, path, description, canEdit }: {
  activityId: string
  path: string
  description: string | null
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Escreva o briefing… títulos, negrito, itálico, listas' }),
    ],
    content: toHTML(description),
    editable: true,
  })

  function start() {
    editor?.commands.setContent(toHTML(description))
    setEditing(true)
    setTimeout(() => editor?.commands.focus('end'), 30)
  }

  function setLink() {
    if (!editor) return
    const prev = (editor.getAttributes('link').href as string) ?? ''
    const url = window.prompt('Cole o link (URL):', prev)
    if (url === null) return
    if (url.trim() === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
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
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 flex-wrap">
          <Btn onClick={() => editor?.chain().focus().toggleBold().run()} active={!!editor?.isActive('bold')} title="Negrito"><Bold className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => editor?.chain().focus().toggleItalic().run()} active={!!editor?.isActive('italic')} title="Itálico"><Italic className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => editor?.chain().focus().toggleStrike().run()} active={!!editor?.isActive('strike')} title="Tachado"><Strikethrough className="w-3.5 h-3.5" /></Btn>
          <Sep />
          <Btn onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} active={!!editor?.isActive('heading', { level: 2 })} title="Título"><Heading2 className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} active={!!editor?.isActive('heading', { level: 3 })} title="Subtítulo"><Heading3 className="w-3.5 h-3.5" /></Btn>
          <Sep />
          <Btn onClick={() => editor?.chain().focus().toggleBulletList().run()} active={!!editor?.isActive('bulletList')} title="Lista"><List className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={!!editor?.isActive('orderedList')} title="Lista numerada"><ListOrdered className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={!!editor?.isActive('blockquote')} title="Citação"><Quote className="w-3.5 h-3.5" /></Btn>
          <Sep />
          <Btn onClick={setLink} active={!!editor?.isActive('link')} title="Link"><Link2 className="w-3.5 h-3.5" /></Btn>
        </div>

        <div className="rich-text px-3 py-2.5 max-h-[420px] overflow-y-auto">
          <EditorContent editor={editor} />
        </div>

        <div className="flex items-center justify-end gap-2 px-2 py-1.5 border-t border-gray-100 bg-gray-50/50">
          <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancelar</button>
          <button onClick={save} disabled={isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-50 transition">
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Salvar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="group/desc flex items-start gap-2">
      <div className="flex-1 min-w-0">
        {description ? (
          isHtml(description)
            ? <div className="rich-text" dangerouslySetInnerHTML={{ __html: description }} />
            : <p className="rich-text whitespace-pre-wrap">{description}</p>
        ) : canEdit ? (
          <button onClick={start} className="text-sm text-gray-500 hover:text-gray-700 transition-colors italic">Adicionar briefing…</button>
        ) : null}
      </div>
      {canEdit && description && (
        <button onClick={start} title="Editar briefing"
          className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover/desc:opacity-100 focus-visible:opacity-100 transition shrink-0">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

function Btn({ onClick, active, title, children }: { onClick: () => void; active: boolean; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      className={cn('p-1.5 rounded transition-colors', active ? 'bg-orange-100 text-orange-700' : 'text-gray-400 hover:text-gray-800 hover:bg-gray-100')}>
      {children}
    </button>
  )
}

function Sep() {
  return <div className="w-px h-4 bg-gray-200 mx-0.5" />
}
