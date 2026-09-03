'use client'

/**
 * Briefing rico (Tiptap) compartilhado entre a CRIAÇÃO da tarefa e o editor do
 * detalhe: mesmas extensões, mesma barra, mesma conversão texto ↔ HTML e o mesmo
 * caminho de imagem (cola / solta / escolhe → WebP → volume, bucket `briefings`).
 * Guarda HTML na coluna `description`, compatível com textos antigos em texto puro.
 */
import { useEffect, useRef } from 'react'
import { useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import {
  Bold, Italic, Strikethrough, Heading2, Heading3,
  List, ListOrdered, ListChecks, Quote, Link2, ImagePlus, ListPlus,
} from 'lucide-react'
import { downscaleImage } from '@/lib/image-resize'
import { uploadFile } from '@/lib/storage/upload-client'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export const isHtml = (s: string) => /^\s*</.test(s)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Texto antigo (puro) → HTML simples preservando parágrafos/quebras. */
export function toHTML(desc: string | null | undefined): string {
  if (!desc) return ''
  if (isHtml(desc)) return desc
  return esc(desc).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
}

export const isEmptyHtml = (html: string) =>
  html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === ''

/** Briefing otimizado (texto puro da IA) → HTML do editor: seções viram título, "- " vira lista. */
export function briefingToEditorHTML(text: string): string {
  const out: string[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) { out.push(`<ul>${list.map(i => `<li>${i}</li>`).join('')}</ul>`); list = [] }
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) { flush(); continue }
    if (line.startsWith('- ')) { list.push(esc(line.slice(2))); continue }
    flush()
    if (/^(Objetivo|Diretrizes):?$/i.test(line)) out.push(`<h3>${esc(line)}</h3>`)
    else if (line.length <= 40 && /:$/.test(line)) out.push(`<p><strong>${esc(line)}</strong></p>`)
    else out.push(`<p>${esc(line)}</p>`)
  }
  flush()
  return out.join('')
}

/** Perguntas da IA → checklist do editor, pra responder no próprio briefing. */
export function faltandoToChecklistHTML(perguntas: string[]): string {
  const itens = perguntas.map(q => `<li data-type="taskItem" data-checked="false">${esc(q)}</li>`).join('')
  return `<ul data-type="taskList">${itens}</ul>`
}

export function useBriefingEditor({ content, placeholder }: { content: string; placeholder?: string }) {
  // Ref: os handlers de paste/drop são fechados na 1ª renderização, quando o
  // editor ainda é null (immediatelyRender: false) — o ref sempre aponta pro vivo.
  const editorRef = useRef<Editor | null>(null)

  // Cola / solta / escolhe imagem → converte p/ WebP (downscale) → sobe → insere.
  async function insertImage(file: File) {
    try {
      const webp = await downscaleImage(file)
      const url = await uploadFile('briefings', `${crypto.randomUUID()}.webp`, webp)
      editorRef.current?.chain().focus().setImage({ src: url }).run()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha ao enviar imagem') }
  }

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder ?? 'Escreva o briefing… títulos, listas, checklist, imagens (cole/solte)' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ inline: false }),
    ],
    content,
    editable: true,
    editorProps: {
      handlePaste: (_view, event) => {
        const imgs = Array.from(event.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'))
        if (!imgs.length) return false
        event.preventDefault(); imgs.forEach(insertImage); return true
      },
      handleDrop: (_view, event) => {
        const imgs = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'))
        if (!imgs.length) return false
        event.preventDefault(); imgs.forEach(insertImage); return true
      },
    },
  })
  // Em effect, não na renderização (regra do React Compiler); paste/drop rodam depois.
  useEffect(() => { editorRef.current = editor }, [editor])

  return { editor, insertImage }
}

/** Editor sem texto (pra esconder "Otimizar com IA" e afins). Reage às transações. */
export function useBriefingVazio(editor: Editor | null): boolean {
  return useEditorState({ editor, selector: ({ editor: e }) => (e ? e.isEmpty : true) }) ?? true
}

export function BriefingToolbar({ editor, insertImage, className }: {
  editor: Editor | null
  insertImage: (file: File) => void
  className?: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  // Tiptap 3 não re-renderiza a cada transação: o estado "ativo" dos botões vem daqui.
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => e ? {
      bold: e.isActive('bold'), italic: e.isActive('italic'), strike: e.isActive('strike'),
      h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), task: e.isActive('taskList'),
      quote: e.isActive('blockquote'), link: e.isActive('link'),
    } : null,
  })

  function setLink() {
    if (!editor) return
    const prev = (editor.getAttributes('link').href as string) ?? ''
    const url = window.prompt('Cole o link (URL):', prev)
    if (url === null) return
    if (url.trim() === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }
  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) insertImage(f)
    e.target.value = ''
  }

  return (
    <div className={cn('flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 flex-wrap', className)}>
      <Btn onClick={() => editor?.chain().focus().toggleBold().run()} active={!!on?.bold} title="Negrito"><Bold className="w-3.5 h-3.5" /></Btn>
      <Btn onClick={() => editor?.chain().focus().toggleItalic().run()} active={!!on?.italic} title="Itálico"><Italic className="w-3.5 h-3.5" /></Btn>
      <Btn onClick={() => editor?.chain().focus().toggleStrike().run()} active={!!on?.strike} title="Tachado"><Strikethrough className="w-3.5 h-3.5" /></Btn>
      <Sep />
      <Btn onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} active={!!on?.h2} title="Título"><Heading2 className="w-3.5 h-3.5" /></Btn>
      <Btn onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} active={!!on?.h3} title="Subtítulo"><Heading3 className="w-3.5 h-3.5" /></Btn>
      <Sep />
      <Btn onClick={() => editor?.chain().focus().toggleBulletList().run()} active={!!on?.bullet} title="Lista"><List className="w-3.5 h-3.5" /></Btn>
      <Btn onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={!!on?.ordered} title="Lista numerada"><ListOrdered className="w-3.5 h-3.5" /></Btn>
      <Btn onClick={() => editor?.chain().focus().toggleTaskList().run()} active={!!on?.task} title="Checklist"><ListChecks className="w-3.5 h-3.5" /></Btn>
      <Btn onClick={() => editor?.chain().focus().toggleBlockquote().run()} active={!!on?.quote} title="Citação"><Quote className="w-3.5 h-3.5" /></Btn>
      <Sep />
      <Btn onClick={setLink} active={!!on?.link} title="Link"><Link2 className="w-3.5 h-3.5" /></Btn>
      <Btn onClick={() => fileRef.current?.click()} active={false} title="Imagem (ou cole/solte no texto)"><ImagePlus className="w-3.5 h-3.5" /></Btn>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
    </div>
  )
}

/** Perguntas devolvidas pela IA quando o rascunho não dá pra estruturar. */
export function FaltandoIA({ perguntas, onInserir, className }: {
  perguntas: string[]
  /** Insere as perguntas como checklist no briefing, pra responder inline. */
  onInserir?: () => void
  className?: string
}) {
  if (!perguntas.length) return null
  return (
    <div className={cn('rounded-xl border border-amber-200 bg-amber-50 px-4 py-3', className)}>
      <p className="text-xs font-medium text-amber-800 mb-1.5">
        Para estruturar o briefing, responda no texto acima:
      </p>
      <ul className="space-y-1">
        {perguntas.map((q, i) => (
          <li key={i} className="text-xs text-amber-700">• {q}</li>
        ))}
      </ul>
      {onInserir && (
        <button type="button" onClick={onInserir}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 hover:text-amber-950 transition-colors">
          <ListPlus className="w-3.5 h-3.5" /> Inserir como checklist no briefing
        </button>
      )}
    </div>
  )
}

function Btn({ onClick, active, title, children }: { onClick: () => void; active: boolean; title: string; children: React.ReactNode }) {
  return (
    // type="button": a barra vive dentro do <form> de criação — sem isso, cada clique enviaria o form.
    <button type="button" onClick={onClick} title={title}
      className={cn('p-1.5 rounded transition-colors', active ? 'bg-orange-100 text-orange-700' : 'text-gray-400 hover:text-gray-800 hover:bg-gray-100')}>
      {children}
    </button>
  )
}

function Sep() {
  return <div className="w-px h-4 bg-gray-200 mx-0.5" />
}
