'use client'

import { useState, useTransition } from 'react'
import { Pencil, Check, X, Loader2 } from 'lucide-react'
import { updateActivityField } from '@/app/actions/activity'
import { toast } from 'sonner'

interface Props {
  activityId: string
  path: string
  title: string
  description: string | null
  canManage: boolean
  isOrgMember: boolean
}

export function ActivityHeader({ activityId, path, title, description, canManage, isOrgMember }: Props) {
  const [editTitle, setEditTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)
  const [editDesc, setEditDesc] = useState(false)
  const [descDraft, setDescDraft] = useState(description ?? '')
  const [isPending, startTransition] = useTransition()

  function saveTitle() {
    if (!titleDraft.trim()) return
    startTransition(async () => {
      const result = await updateActivityField(path, activityId, 'title', titleDraft.trim())
      if (result?.error) toast.error(result.error)
      else { toast.success('Título atualizado.'); setEditTitle(false) }
    })
  }

  function saveDesc() {
    startTransition(async () => {
      const result = await updateActivityField(path, activityId, 'description', descDraft.trim() || null)
      if (result?.error) toast.error(result.error)
      else { toast.success('Descrição atualizada.'); setEditDesc(false) }
    })
  }

  return (
    <div>
      {/* Title */}
      <div className="group/title flex items-start gap-2 mb-2">
        {editTitle ? (
          <div className="flex-1 flex items-start gap-2">
            <input
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditTitle(false) }}
              className="flex-1 text-xl font-semibold text-gray-900 border border-indigo-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              autoFocus
            />
            <button
              onClick={saveTitle}
              disabled={isPending}
              className="p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 shrink-0"
            >
              {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setEditTitle(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <h1 className="flex-1 text-xl font-semibold text-gray-900 leading-snug">{title}</h1>
            {canManage && (
              <button
                onClick={() => { setTitleDraft(title); setEditTitle(true) }}
                className="p-1 rounded text-gray-300 hover:text-gray-500 hover:bg-gray-100 opacity-0 group-hover/title:opacity-100 transition mt-0.5 shrink-0"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Description */}
      <div className="group/desc flex items-start gap-2">
        {editDesc ? (
          <div className="flex-1 flex items-start gap-2">
            <textarea
              value={descDraft}
              onChange={e => setDescDraft(e.target.value)}
              className="flex-1 text-sm text-gray-500 border border-indigo-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white resize-none leading-relaxed"
              rows={4}
              autoFocus
            />
            <div className="flex flex-col gap-1 shrink-0">
              <button
                onClick={saveDesc}
                disabled={isPending}
                className="p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setEditDesc(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1">
              {description ? (
                <p className="text-gray-500 text-sm leading-relaxed">{description}</p>
              ) : isOrgMember ? (
                <button
                  onClick={() => { setDescDraft(''); setEditDesc(true) }}
                  className="text-sm text-gray-300 hover:text-gray-400 transition italic"
                >
                  Adicionar descrição…
                </button>
              ) : null}
            </div>
            {isOrgMember && description && (
              <button
                onClick={() => { setDescDraft(description ?? ''); setEditDesc(true) }}
                className="p-1 rounded text-gray-300 hover:text-gray-500 hover:bg-gray-100 opacity-0 group-hover/desc:opacity-100 transition shrink-0"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
