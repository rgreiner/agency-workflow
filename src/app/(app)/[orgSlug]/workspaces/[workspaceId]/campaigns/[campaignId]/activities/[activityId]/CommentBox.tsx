'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import Mention from '@tiptap/extension-mention'
import { addComment } from '@/app/actions/activity'
import { downscaleImage } from '@/lib/image-resize'
import { uploadFile } from '@/lib/storage/upload-client'
import { Send, Bold, Italic, List, ListOrdered, ListChecks, ImagePlus, Reply, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Mentionable { id: string; name: string }
interface Props {
  activityId: string
  members?: Mentionable[]
  /** Ids dos responsáveis da tarefa — alvo do @atribuidos. */
  assignedIds?: string[]
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
type Opt = { id: string; label: string }

export function CommentBox({ activityId, members = [], assignedIds = [] }: Props) {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState('')
  const [replyTo, setReplyTo] = useState<{ id: string; author: string; preview: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Rascunho local ────────────────────────────────────────────────────────
  // Não perder o comentário não enviado (fechou o modal, clicou errado, F5…).
  // Guarda o HTML do editor no localStorage por tarefa; restaura ao voltar e
  // limpa ao enviar. É local do navegador — some quando o comentário é postado.
  const DRAFT_KEY = `flow:comment-draft:${activityId}`
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftLatest = useRef<{ html: string; empty: boolean } | null>(null)
  const draftRestored = useRef(false)

  function flushDraft() {
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null }
    const d = draftLatest.current
    if (!d) return
    try {
      if (d.empty) localStorage.removeItem(DRAFT_KEY)
      else localStorage.setItem(DRAFT_KEY, d.html)
    } catch { /* localStorage indisponível (privado/quota) — segue sem rascunho */ }
  }
  function scheduleDraftSave(html: string, empty: boolean) {
    draftLatest.current = { html, empty }
    if (draftTimer.current) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(flushDraft, 400)
  }
  function clearDraft() {
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null }
    draftLatest.current = null
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
  }

  function optionsFor(query: string): Opt[] {
    const q = norm(query)
    const list: Opt[] = []
    if (q === '' || 'todos'.startsWith(q) || 'all'.startsWith(q)) list.push({ id: '__all__', label: 'todos' })
    if (assignedIds.length && (q === '' || 'atribuidos'.startsWith(q) || 'responsaveis'.startsWith(q))) list.push({ id: '__assigned__', label: 'atribuidos' })
    for (const m of members) if (norm(m.name).includes(q)) list.push({ id: m.id, label: m.name })
    return list.slice(0, 8)
  }

  const editor = useEditor({
    immediatelyRender: false,
    // TipTap v3 NÃO re-renderiza mais o componente a cada transação por padrão —
    // sem isto, o disabled do botão de enviar e os estados ativos da toolbar
    // congelam no valor do mount (botão ficava "preso" até algo re-renderizar).
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Adicione um comentário…  (@ menciona · checklist e imagens · ⌘/Ctrl+Enter envia)' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ inline: false }),
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        suggestion: {
          items: ({ query }) => optionsFor(query),
          render: makeMentionPopup,
        },
      }),
    ],
    content: '',
    onUpdate: ({ editor }) => scheduleDraftSave(editor.getHTML(), editor.isEmpty),
    editorProps: {
      handleKeyDown: (_v, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit(); return true }
        return false
      },
      handlePaste: (_v, event) => {
        const imgs = Array.from(event.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'))
        if (!imgs.length) return false
        event.preventDefault(); imgs.forEach(insertImage); return true
      },
      handleDrop: (_v, event) => {
        const imgs = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'))
        if (!imgs.length) return false
        event.preventDefault(); imgs.forEach(insertImage); return true
      },
    },
  })

  // "Responder" num comentário (disparado pelo ReplyButton do feed).
  useEffect(() => {
    function onReply(e: Event) {
      const d = (e as CustomEvent).detail as { id: string; author: string; preview: string }
      setReplyTo(d)
      editor?.commands.focus('end')
    }
    window.addEventListener('flow:reply', onReply)
    return () => window.removeEventListener('flow:reply', onReply)
  }, [editor])

  // Restaura o rascunho ao montar; salva o pendente ao desmontar (fechou rápido).
  useEffect(() => {
    if (!editor || draftRestored.current) return
    draftRestored.current = true
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (saved && editor.isEmpty) editor.commands.setContent(saved)
    } catch { /* ignore */ }
    return () => flushDraft()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  async function insertImage(file: File) {
    try {
      const webp = await downscaleImage(file)
      const url = await uploadFile('comments', `${crypto.randomUUID()}.webp`, webp)
      editor?.chain().focus().setImage({ src: url }).run()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha ao enviar imagem') }
  }
  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = ''
  }

  function submit() {
    if (!editor || editor.isEmpty || isPending) return
    const html = editor.getHTML()
    const ids: string[] = []
    let mentionAll = false
    editor.state.doc.descendants(node => {
      if (node.type.name === 'mention') {
        const id = node.attrs.id as string
        if (id === '__all__') mentionAll = true
        else if (id === '__assigned__') ids.push(...assignedIds)
        else if (id) ids.push(id)
      }
    })
    const uniqueIds = Array.from(new Set(ids))
    const reply = replyTo

    // Otimista: limpa já e libera a digitação; o feed atualiza com o refresh em
    // 2º plano. Se falhar, devolve o texto pro editor.
    editor.commands.clearContent()
    setReplyTo(null)
    setError('')
    setIsPending(true)
    void (async () => {
      const result = await addComment(activityId, html, uniqueIds, mentionAll, reply?.id ?? null)
      setIsPending(false)
      if (result?.error) {
        editor.commands.setContent(html)
        setReplyTo(reply)
        setError(result.error)
        toast.error(result.error)
      } else {
        clearDraft()
        router.refresh()
      }
    })()
  }

  return (
    <div>
      {replyTo && (
        <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs">
          <Reply className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span className="text-gray-500 shrink-0">Respondendo a <span className="font-medium text-gray-700">{replyTo.author}</span>:</span>
          <span className="flex-1 min-w-0 truncate text-gray-500">{replyTo.preview}</span>
          <button type="button" onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-gray-600 shrink-0" title="Cancelar resposta"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-orange-500 focus-within:border-transparent">
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-gray-100">
          <ToolBtn onClick={() => editor?.chain().focus().toggleBold().run()} active={!!editor?.isActive('bold')} title="Negrito"><Bold className="w-3.5 h-3.5" /></ToolBtn>
          <ToolBtn onClick={() => editor?.chain().focus().toggleItalic().run()} active={!!editor?.isActive('italic')} title="Itálico"><Italic className="w-3.5 h-3.5" /></ToolBtn>
          <ToolBtn onClick={() => editor?.chain().focus().toggleBulletList().run()} active={!!editor?.isActive('bulletList')} title="Lista"><List className="w-3.5 h-3.5" /></ToolBtn>
          <ToolBtn onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={!!editor?.isActive('orderedList')} title="Lista numerada"><ListOrdered className="w-3.5 h-3.5" /></ToolBtn>
          <ToolBtn onClick={() => editor?.chain().focus().toggleTaskList().run()} active={!!editor?.isActive('taskList')} title="Checklist"><ListChecks className="w-3.5 h-3.5" /></ToolBtn>
          <ToolBtn onClick={() => fileRef.current?.click()} active={false} title="Imagem (ou cole/solte)"><ImagePlus className="w-3.5 h-3.5" /></ToolBtn>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
          <button
            type="button" onClick={submit} disabled={isPending || !editor || editor.isEmpty}
            aria-label="Enviar comentário"
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition disabled:opacity-40"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div className="rich-text px-3 py-2 max-h-[260px] overflow-y-auto">
          <EditorContent editor={editor} />
        </div>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

function ToolBtn({ onClick, active, title, children }: { onClick: () => void; active: boolean; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={cn('p-1.5 rounded transition-colors', active ? 'bg-orange-100 text-orange-700' : 'text-gray-400 hover:text-gray-800 hover:bg-gray-100')}>
      {children}
    </button>
  )
}

// ── Popup de @menção (DOM puro; sem dependência de tippy) ────────────────────
function makeMentionPopup() {
  let el: HTMLDivElement | null = null
  let items: Opt[] = []
  let active = 0
  let command: (o: Opt) => void = () => {}

  function paint() {
    if (!el) return
    el.innerHTML = ''
    items.forEach((it, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = it.id === '__all__' ? '@todos' : it.id === '__assigned__' ? '@atribuidos' : it.label
      b.style.cssText = `display:block;width:100%;text-align:left;padding:6px 10px;font-size:13px;border:0;background:${i === active ? '#fff7ed' : 'transparent'};color:${i === active ? '#9a3412' : '#374151'};cursor:pointer;border-radius:6px`
      // Seleciona no POINTERDOWN (dispara antes do mousedown e sobrevive se outro
      // handler da página cancelar os eventos de mouse), com mousedown/click como
      // fallback. preventDefault mantém o foco no editor. Guarda de execução única
      // por gesto; se o command lançar, loga e libera pra tentar de novo.
      let done = false
      const select = (e: Event) => {
        if (done) return
        done = true
        e.preventDefault()
        try { command(it) } catch (err) { console.error('[mention] falha ao inserir', err); done = false }
      }
      b.onpointerdown = select
      b.onmousedown = select
      b.onclick = select
      b.onmouseenter = () => { active = i; paint() }
      el!.appendChild(b)
    })
  }
  function position(rect: DOMRect | null) {
    if (!el || !rect) return
    // Medir DEPOIS de pintar. A caixa de comentário fica na base da tela, então
    // sem espaço embaixo o popup abre PARA CIMA — senão renderiza fora da viewport.
    const h = el.offsetHeight
    const w = el.offsetWidth
    const flip = rect.bottom + 6 + h > window.innerHeight && rect.top - 6 - h >= 0
    el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - w - 8))}px`
    el.style.top = flip ? `${rect.top - 6 - h}px` : `${rect.bottom + 6}px`
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onStart: (props: any) => {
      items = props.items; command = props.command; active = 0
      el = document.createElement('div')
      el.style.cssText = 'position:fixed;z-index:80;min-width:180px;max-height:240px;overflow:auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.12);padding:4px'
      document.body.appendChild(el)
      paint(); position(props.clientRect?.())
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onUpdate: (props: any) => { items = props.items; command = props.command; active = 0; paint(); position(props.clientRect?.()) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onKeyDown: (props: any) => {
      const k = props.event.key
      // Enquanto o popup está aberto, segura as teclas aqui — senão Escape/Enter
      // sobem pro modal da tarefa (que fecharia no Escape).
      if (k === 'ArrowDown') { props.event.stopPropagation(); active = (active + 1) % Math.max(items.length, 1); paint(); return true }
      if (k === 'ArrowUp') { props.event.stopPropagation(); active = (active - 1 + items.length) % Math.max(items.length, 1); paint(); return true }
      if (k === 'Enter' || k === 'Tab') { props.event.stopPropagation(); if (items[active]) command(items[active]); return true }
      if (k === 'Escape') { props.event.stopPropagation(); return true }
      return false
    },
    onExit: () => { el?.remove(); el = null },
  }
}
