'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { Pencil, Check, X, Loader2 } from 'lucide-react'
import { updateActivityField } from '@/app/actions/activity'
import { BriefingEditor } from './BriefingEditor'
import { toast } from 'sonner'

interface Props {
  activityId: string
  path: string
  title: string
  description: string | null
  canManage: boolean
  isOrgMember: boolean
  /** Faixa de status/datas/prioridade/responsáveis, renderizada entre título e briefing. */
  meta?: ReactNode
}

export function ActivityHeader({ activityId, path, title, description, canManage, isOrgMember, meta }: Props) {
  const [editTitle, setEditTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)
  const [isPending, startTransition] = useTransition()

  function saveTitle() {
    if (!titleDraft.trim()) return
    startTransition(async () => {
      const result = await updateActivityField(path, activityId, 'title', titleDraft.trim())
      if (result?.error) toast.error(result.error)
      else { toast.success('Título atualizado.'); setEditTitle(false) }
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
              aria-label="Título da tarefa"
              onChange={e => setTitleDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditTitle(false) }}
              className="flex-1 text-xl font-semibold text-gray-900 border border-indigo-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              autoFocus
            />
            <button
              onClick={saveTitle}
              disabled={isPending}
              aria-label="Salvar título"
              className="p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 shrink-0"
            >
              {isPending ? <Loader2 aria-hidden className="w-3.5 h-3.5 animate-spin" /> : <Check aria-hidden className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setEditTitle(false)}
              aria-label="Cancelar edição do título"
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 shrink-0"
            >
              <X aria-hidden className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <h1 className="flex-1 text-xl font-semibold text-gray-900 leading-snug">{title}</h1>
            {canManage && (
              <button
                onClick={() => { setTitleDraft(title); setEditTitle(true) }}
                aria-label="Editar título"
                className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover/title:opacity-100 focus-visible:opacity-100 transition mt-0.5 shrink-0"
              >
                <Pencil aria-hidden className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Meta (status, datas, prioridade, responsáveis) — entre título e briefing */}
      {meta && <div className="flex items-center gap-3 flex-wrap mb-4">{meta}</div>}

      {/* Briefing (texto rico) */}
      <BriefingEditor activityId={activityId} path={path} description={description} canEdit={isOrgMember} />
    </div>
  )
}
