'use client'

import { useState, useTransition } from 'react'
import { addComment } from '@/app/actions/activity'
import { Send } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  activityId: string
  path: string
}

export function CommentBox({ activityId, path }: Props) {
  const [content, setContent] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function submit() {
    if (!content.trim()) return
    startTransition(async () => {
      const result = await addComment(path, activityId, content.trim())
      if (result?.error) {
        setError(result.error)
        toast.error(result.error)
      } else {
        setContent('')
      }
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    submit()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // ⌘/Ctrl+Enter envia; Enter sozinho quebra linha.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex gap-2 items-end">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          aria-label="Comentário"
          placeholder="Adicione um comentário…  (Enter = nova linha, ⌘/Ctrl+Enter envia)"
          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y min-h-[44px]"
        />
        <button
          type="submit"
          disabled={!content.trim() || isPending}
          aria-label="Enviar comentário"
          className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed self-stretch"
        >
          <Send aria-hidden className="w-4 h-4" />
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </form>
  )
}
