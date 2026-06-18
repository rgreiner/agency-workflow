'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArchiveRestore } from 'lucide-react'
import { toast } from 'sonner'
import { setWorkspaceArchived, setCampaignArchived } from '@/app/actions/workspace'

/** Botão "Desarquivar" para cliente (sem campaignId) ou campanha (com campaignId). */
export function UnarchiveButton({
  orgSlug, workspaceId, campaignId, label = 'Desarquivar',
}: {
  orgSlug: string
  workspaceId: string
  campaignId?: string
  label?: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        start(async () => {
          const r = campaignId
            ? await setCampaignArchived(orgSlug, workspaceId, campaignId, false)
            : await setWorkspaceArchived(orgSlug, workspaceId, false)
          if (r?.error) toast.error(r.error)
          else router.refresh()
        })
      }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50"
    >
      <ArchiveRestore className="w-3.5 h-3.5" /> {label}
    </button>
  )
}
