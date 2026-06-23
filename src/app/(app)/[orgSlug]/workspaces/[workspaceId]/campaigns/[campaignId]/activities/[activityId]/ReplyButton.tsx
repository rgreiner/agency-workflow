'use client'

import { Reply } from 'lucide-react'

/** Dispara o evento que coloca o CommentBox em modo "responder a este comentário". */
export function ReplyButton({ id, author, preview }: { id: string; author: string; preview: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('flow:reply', { detail: { id, author, preview } }))}
      className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
    >
      <Reply className="w-3.5 h-3.5" /> Responder
    </button>
  )
}
