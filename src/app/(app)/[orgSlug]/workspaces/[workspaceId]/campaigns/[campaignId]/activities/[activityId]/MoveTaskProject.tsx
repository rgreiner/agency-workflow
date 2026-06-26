'use client'

import { useState, useMemo, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, FolderInput, Loader2 } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { moveActivity } from '@/app/actions/activity'
import { toast } from 'sonner'

export interface ProjectOption {
  workspaceId: string
  workspaceName: string
  campaignId: string
  campaignName: string
}

/**
 * Nome do projeto no breadcrumb da tarefa — clicável: abre um seletor cliente →
 * projeto pra MOVER a tarefa. A pasta do Drive (e tudo dentro) vai junto.
 */
export function MoveTaskProject({
  orgSlug, activityId, currentWorkspaceId, currentCampaignId, currentCampaignName, projects,
}: {
  orgSlug: string
  activityId: string
  currentWorkspaceId: string
  currentCampaignId: string
  currentCampaignName: string
  projects: ProjectOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [wsId, setWsId] = useState(currentWorkspaceId)
  const [campId, setCampId] = useState(currentCampaignId)
  const [pending, start] = useTransition()
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [open])

  const clients = useMemo(() => {
    const seen = new Map<string, string>()
    for (const p of projects) if (!seen.has(p.workspaceId)) seen.set(p.workspaceId, p.workspaceName)
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [projects])

  const campaigns = useMemo(
    () => projects.filter(p => p.workspaceId === wsId).map(p => ({ value: p.campaignId, label: p.campaignName })),
    [projects, wsId],
  )

  function pickClient(id: string) {
    setWsId(id)
    const first = projects.find(p => p.workspaceId === id)
    setCampId(first?.campaignId ?? '')
  }

  function doMove() {
    if (!campId || campId === currentCampaignId) { setOpen(false); return }
    const dest = projects.find(p => p.campaignId === campId)
    if (!dest) return
    start(async () => {
      const r = await moveActivity(activityId, campId, orgSlug)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Tarefa movida — pasta do Drive indo junto em 2º plano')
      setOpen(false)
      router.push(`/${orgSlug}/workspaces/${dest.workspaceId}/campaigns/${dest.campaignId}/activities/${activityId}`)
    })
  }

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Mover para outro projeto"
        className="text-xs text-gray-500 hover:text-gray-700 transition inline-flex items-center gap-0.5 rounded px-0.5 hover:bg-gray-100 active:scale-[0.97]"
      >
        {currentCampaignName}
        <ChevronDown className="w-3 h-3 opacity-40" />
      </button>

      {open && (
        <div className="pop-in absolute top-full left-0 mt-1 z-50 w-72 bg-white rounded-2xl border border-gray-200 shadow-xl p-3">
          <p className="text-[11px] font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
            <FolderInput className="w-3.5 h-3.5" /> Mover para outro projeto
          </p>
          <label className="block text-[11px] text-gray-500 mb-1">Cliente</label>
          <Select value={wsId} onChange={pickClient} options={clients} className="mb-2" />
          <label className="block text-[11px] text-gray-500 mb-1">Projeto</label>
          <Select value={campId} onChange={setCampId} options={campaigns} placeholder="Selecionar projeto" />
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5">Cancelar</button>
            <button
              type="button"
              onClick={doMove}
              disabled={pending || !campId || campId === currentCampaignId}
              className="text-xs font-medium bg-orange-600 text-[#fff] rounded-xl px-3 py-1.5 hover:bg-orange-700 transition disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              {pending && <Loader2 className="w-3 h-3 animate-spin" />} Mover
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">A pasta do Drive (e tudo dentro) vai junto. Pode mover entre clientes.</p>
        </div>
      )}
    </span>
  )
}
