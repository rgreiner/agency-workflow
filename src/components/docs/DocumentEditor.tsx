'use client'

import { useState, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { createClient } from '@/lib/supabase/client'
import { ShareModal } from './ShareModal'
import { updateDocumentVisibility, deleteDocument } from '@/app/actions/docs'
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare, Code, Quote, Minus,
  Share2, ArrowLeft, Check, Loader2, Trash2, Globe, Lock, AlertTriangle, X,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type SaveStatus = 'idle' | 'saving' | 'saved'

interface Member {
  userId: string
  fullName: string | null
  email: string
}

interface Props {
  docId: string
  orgSlug: string
  orgId: string
  currentUserId: string
  canManage: boolean
  initialTitle: string
  initialContent: object
  initialVisibility: 'org' | 'custom'
  initialMemberIds: string[]
  members: Member[]
  workspaceName: string | null
}

export function DocumentEditor({
  docId, orgSlug, currentUserId, canManage,
  initialTitle, initialContent,
  initialVisibility, initialMemberIds, members,
  workspaceName,
}: Props) {
  const [title, setTitle] = useState(initialTitle)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [showShare, setShowShare] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [visibility, setVisibility] = useState<'org' | 'custom'>(initialVisibility)
  const [sharedMemberIds, setSharedMemberIds] = useState<string[]>(initialMemberIds)
  const supabase = createClient()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleSave = useCallback((fn: () => Promise<void>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    saveTimer.current = setTimeout(async () => {
      await fn()
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }, 1000)
  }, [])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Comece a escrever…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: initialContent as object,
    editable: canManage,
    onUpdate: ({ editor }) => {
      scheduleSave(async () => {
        await supabase.from('documents').update({ content: editor.getJSON() }).eq('id', docId)
      })
    },
  })

  async function handleTitleBlur() {
    setSaveStatus('saving')
    await supabase.from('documents').update({ title }).eq('id', docId)
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 2000)
  }

  async function handleShareSave(newVis: 'org' | 'custom', newIds: string[]) {
    const result = await updateDocumentVisibility(docId, orgSlug, newVis, newIds)
    if (result?.error) {
      toast.error(result.error)
    } else {
      setVisibility(newVis)
      setSharedMemberIds(newIds)
      setShowShare(false)
      toast.success('Compartilhamento atualizado.')
    }
  }

  async function handleDelete() {
    setDeleting(true)
    const result = await deleteDocument(docId, orgSlug)
    setDeleting(false)
    if (result?.error) {
      toast.error(result.error)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Top bar ───────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 shrink-0">
        <Link
          href={`/${orgSlug}/docs`}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          {workspaceName ?? 'Documentos'}
        </Link>

        <div className="flex items-center gap-2">
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" /> Salvando…
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <Check className="w-3 h-3" /> Salvo
            </span>
          )}

          <button
            onClick={() => setShowShare(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition text-gray-600"
          >
            {visibility === 'org'
              ? <Globe className="w-3.5 h-3.5 text-green-500" />
              : <Lock className="w-3.5 h-3.5 text-amber-500" />
            }
            {visibility === 'org' ? 'Todo o time' : `${sharedMemberIds.length} pessoas`}
          </button>

          {canManage && !confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
              title="Excluir documento"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {canManage && confirmDelete && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span className="text-xs text-red-700 font-medium">Excluir documento?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50 flex items-center gap-1"
              >
                {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Excluir'}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Toolbar ───────────────────────────────────────── */}
      {canManage && editor && (
        <div className="flex items-center gap-0.5 px-6 py-1.5 border-b border-gray-100 shrink-0 overflow-x-auto">
          <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Negrito"><Bold className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Itálico"><Italic className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Tachado"><Strikethrough className="w-3.5 h-3.5" /></Btn>
          <Sep />
          <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Título 1"><Heading1 className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Título 2"><Heading2 className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Título 3"><Heading3 className="w-3.5 h-3.5" /></Btn>
          <Sep />
          <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Lista"><List className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Lista numerada"><ListOrdered className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="Lista de tarefas"><CheckSquare className="w-3.5 h-3.5" /></Btn>
          <Sep />
          <Btn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Código inline"><Code className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Citação"><Quote className="w-3.5 h-3.5" /></Btn>
          <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} active={false} title="Separador"><Minus className="w-3.5 h-3.5" /></Btn>
          <Sep />
          <button
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            className="px-2 py-1 text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30 transition"
          >
            ↩
          </button>
          <button
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            className="px-2 py-1 text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30 transition"
          >
            ↪
          </button>
        </div>
      )}

      {/* ── Editor body ───────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-10 py-10">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            placeholder="Sem título"
            readOnly={!canManage}
            className="w-full text-4xl font-bold text-gray-900 placeholder-gray-300 bg-transparent border-none outline-none mb-8"
          />
          <div className="doc-editor">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {showShare && (
        <ShareModal
          visibility={visibility}
          sharedMemberIds={sharedMemberIds}
          members={members}
          currentUserId={currentUserId}
          onSave={handleShareSave}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  )
}

function Btn({ onClick, active, title, children }: { onClick: () => void; active: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'p-1.5 rounded transition-colors',
        active ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400 hover:text-gray-800 hover:bg-gray-100'
      )}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <div className="w-px h-4 bg-gray-200 mx-0.5" />
}
