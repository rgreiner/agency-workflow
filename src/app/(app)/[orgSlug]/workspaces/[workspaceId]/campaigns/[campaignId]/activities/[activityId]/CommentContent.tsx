'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Mention from '@tiptap/extension-mention'
import { Pencil, Trash2, Check, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { editComment, deleteComment } from '@/app/actions/activity'

const isHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s)

interface Props {
  path: string
  commentId: string
  content: string
  edited: boolean
  canEdit: boolean
  canDelete: boolean
}

export function CommentContent({ path, commentId, content, edited, canEdit, canDelete }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // Clicar numa imagem do comentário → amplia (lightbox).
  function onBodyClick(e: React.MouseEvent) {
    const el = e.target as HTMLElement
    if (el.tagName === 'IMG') { e.preventDefault(); setLightbox((el as HTMLImageElement).src) }
  }
  useEffect(() => {
    if (!lightbox) return
    function onKey(ev: KeyboardEvent) { if (ev.key === 'Escape') setLightbox(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightbox])

  function onDelete() {
    start(async () => {
      const res = await deleteComment(path, commentId)
      if (res?.error) { toast.error(res.error); return }
      setConfirmDel(false)
      router.refresh()
    })
  }

  if (editing) {
    return (
      <CommentEditor
        initial={content}
        pending={pending}
        onCancel={() => setEditing(false)}
        onSave={html => start(async () => {
          const res = await editComment(path, commentId, html)
          if (res?.error) { toast.error(res.error); return }
          setEditing(false)
          router.refresh()
        })}
      />
    )
  }

  return (
    <div className="group/comment relative">
      {isHtml(content)
        ? <div className="rich-text comment-body text-sm text-gray-700 leading-relaxed" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: content }} />
        : <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{content}</p>}
      {edited && <span className="text-[10px] text-gray-400 italic">(editado)</span>}

      {lightbox && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-6 cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-lg shadow-2xl object-contain" />
        </div>
      )}

      {(canEdit || canDelete) && !confirmDel && (
        <div className="absolute -top-1 right-0 hidden group-hover/comment:flex items-center gap-0.5 bg-white/90 backdrop-blur rounded-lg border border-gray-100 shadow-sm">
          {canEdit && (
            <button onClick={() => setEditing(true)} title="Editar" className="p-1.5 text-gray-400 hover:text-gray-700 transition rounded-lg">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {canDelete && (
            <button onClick={() => setConfirmDel(true)} title="Apagar" className="p-1.5 text-gray-400 hover:text-red-600 transition rounded-lg">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {confirmDel && (
        <div className="absolute -top-1 right-0 flex items-center gap-2 bg-white rounded-lg border border-gray-200 shadow-sm px-2.5 py-1.5">
          <span className="text-xs text-gray-600">Apagar?</span>
          <button onClick={onDelete} disabled={pending} className="text-xs font-medium text-red-600 hover:text-red-700 inline-flex items-center gap-1 disabled:opacity-50">
            {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Sim'}
          </button>
          <button onClick={() => setConfirmDel(false)} className="text-xs text-gray-400 hover:text-gray-600">Não</button>
        </div>
      )}
    </div>
  )
}

function CommentEditor({ initial, pending, onSave, onCancel }: {
  initial: string; pending: boolean; onSave: (html: string) => void; onCancel: () => void
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Image.configure({ inline: false }),
      // registrado só p/ preservar @menções já existentes no HTML (sem novo autocomplete)
      Mention.configure({ HTMLAttributes: { class: 'mention' }, suggestion: { items: () => [] } }),
    ],
    content: isHtml(initial) ? initial : `<p>${initial}</p>`,
    autofocus: 'end',
  })

  return (
    <div>
      <div className="rich-text rounded-xl border border-gray-200 bg-white px-3 py-2 max-h-[260px] overflow-y-auto focus-within:ring-2 focus-within:ring-orange-500 focus-within:border-transparent">
        <EditorContent editor={editor} />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={() => { if (editor && !editor.isEmpty) onSave(editor.getHTML()) }}
          disabled={pending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-[#fff] text-xs font-medium rounded-lg hover:bg-orange-700 disabled:opacity-50 transition"
        >
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Salvar
        </button>
        <button onClick={onCancel} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition">
          <X className="w-3.5 h-3.5" /> Cancelar
        </button>
      </div>
    </div>
  )
}
