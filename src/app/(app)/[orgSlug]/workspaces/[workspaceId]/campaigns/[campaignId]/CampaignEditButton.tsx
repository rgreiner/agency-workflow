'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateCampaign, deleteCampaign, setCampaignArchived, setCampaignDrive } from '@/app/actions/workspace'
import { DatePicker } from '@/components/ui/DatePicker'
import { Settings, X, Check, Trash2, Loader2, Archive, ArchiveRestore } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface Props {
  orgSlug: string
  workspaceId: string
  campaignId: string
  name: string
  description: string
  startDate: string
  endDate: string
  archived?: boolean
  driveFolderId?: string | null
}

export function CampaignEditButton({ orgSlug, workspaceId, campaignId, name, description, startDate, endDate, archived = false, driveFolderId = null }: Props) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [form, setForm] = useState({ name, description, start_date: startDate, end_date: endDate })
  const [drive, setDrive] = useState(driveFolderId ? `https://drive.google.com/drive/folders/${driveFolderId}` : '')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const router = useRouter()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const fd = new FormData()
    fd.append('name', form.name)
    fd.append('description', form.description)
    fd.append('start_date', form.start_date)
    fd.append('end_date', form.end_date)
    startTransition(async () => {
      const res = await updateCampaign(orgSlug, workspaceId, campaignId, fd)
      if (res?.error) { setError(res.error); return }
      const d = await setCampaignDrive(orgSlug, workspaceId, campaignId, drive)
      if (d?.error) { setError(d.error); return }
      setOpen(false)
      router.refresh()
    })
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteCampaign(orgSlug, workspaceId, campaignId)
    })
  }

  function handleArchive() {
    startTransition(async () => {
      const res = await setCampaignArchived(orgSlug, workspaceId, campaignId, !archived)
      if (res?.error) { setError(res.error); return }
      setOpen(false)
      if (archived) router.refresh()
      else router.push(`/${orgSlug}/workspaces/${workspaceId}`)
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
        title="Editar campanha"
      >
        <Settings className="w-4 h-4" />
      </button>

      {open && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="modal-card w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Editar campanha</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome</label>
                <input
                  type="text" required value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Descrição</label>
                <textarea
                  rows={2} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <DatePicker
                  label="Período da campanha"
                  startDate={form.start_date}
                  endDate={form.end_date}
                  onStartChange={v => setForm(f => ({ ...f, start_date: v }))}
                  onEndChange={v => setForm(f => ({ ...f, end_date: v }))}
                />
                <input type="hidden" name="start_date" value={form.start_date} />
                <input type="hidden" name="end_date" value={form.end_date} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Pasta do Drive</label>
                <input
                  type="url" value={drive}
                  onChange={e => setDrive(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/…"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">Novas tarefas criam pastas dentro dela automaticamente.</p>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={handleArchive} disabled={isPending}
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition disabled:opacity-50">
                    {archived ? <><ArchiveRestore className="w-4 h-4" /> Desarquivar</> : <><Archive className="w-4 h-4" /> Arquivar</>}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(true)} disabled={isPending}
                    className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 transition disabled:opacity-50">
                    <Trash2 className="w-4 h-4" /> Excluir
                  </button>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setOpen(false)}
                    className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">
                    Cancelar
                  </button>
                  <button type="submit" disabled={isPending}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition">
                    {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Salvar
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Excluir a campanha "${name}"?`}
        description="Todas as atividades desta campanha serão removidas permanentemente. Essa ação não pode ser desfeita."
        confirmLabel="Excluir campanha"
        loading={isPending}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}
