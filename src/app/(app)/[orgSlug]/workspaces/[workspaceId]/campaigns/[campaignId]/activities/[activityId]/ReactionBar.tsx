'use client'

import { useState, useRef, useEffect } from 'react'
import { SmilePlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toggleCommentReaction } from '@/app/actions/activity'

// Reações disponíveis: joinha, sorriso, estrela, negativo, olho alto.
export const REACTIONS = ['👍', '😄', '⭐', '👎', '🙄']

interface R { emoji: string; userId: string }

export function ReactionBar({ path, commentId, currentUserId, reactions }: {
  path: string
  commentId: string
  currentUserId: string
  reactions: R[]
}) {
  const [list, setList] = useState<R[]>(reactions)
  const [pickerOpen, setPickerOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pickerOpen) return
    function onOut(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setPickerOpen(false) }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [pickerOpen])

  function toggle(emoji: string) {
    setPickerOpen(false)
    const mine = list.some(r => r.emoji === emoji && r.userId === currentUserId)
    setList(prev => mine
      ? prev.filter(r => !(r.emoji === emoji && r.userId === currentUserId))
      : [...prev, { emoji, userId: currentUserId }])
    toggleCommentReaction(path, commentId, emoji)
  }

  const groups = REACTIONS
    .map(e => ({ emoji: e, count: list.filter(r => r.emoji === e).length, mine: list.some(r => r.emoji === e && r.userId === currentUserId) }))
    .filter(g => g.count > 0)

  return (
    <div className="flex items-center gap-1 mt-2 flex-wrap" ref={ref}>
      {groups.map(g => (
        <button key={g.emoji} onClick={() => toggle(g.emoji)}
          className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-xs transition-colors',
            g.mine ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>
          <span className="leading-none">{g.emoji}</span><span>{g.count}</span>
        </button>
      ))}
      <div className="relative">
        <button onClick={() => setPickerOpen(o => !o)} title="Reagir"
          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
          <SmilePlus className="w-3.5 h-3.5" />
        </button>
        {pickerOpen && (
          <div className="pop-in absolute left-0 bottom-full mb-1 flex items-center gap-0.5 bg-white rounded-full border border-gray-200 shadow-lg px-1.5 py-1 z-20">
            {REACTIONS.map(e => (
              <button key={e} onClick={() => toggle(e)} className="w-7 h-7 rounded-full hover:bg-gray-100 transition-colors text-base leading-none">{e}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
