'use client'

import { useState, useTransition } from 'react'
import { addComment } from '@/app/actions/activity'
import { Send } from 'lucide-react'

interface Props {
  activityId: string
  path: string
}

export function CommentBox({ activityId, path }: Props) {
  const [content, setContent] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    startTransition(async () => {
      const result = await addComment(path, activityId, content.trim())
      if (result?.error) setError(result.error)
      else setContent('')
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Adicione um comentário..."
        className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
      />
      <button
        type="submit"
        disabled={!content.trim() || isPending}
        className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Send className="w-4 h-4" />
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </form>
  )
}
