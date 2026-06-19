'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateWorkspace, deleteWorkspace, setWorkspaceArchived } from '@/app/actions/workspace'
import { Settings, X, Check, Trash2, Loader2, Archive, ArchiveRestore } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

const COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#ef4444',
  '#f97316','#eab308','#22c55e','#14b8a6',
  '#06b6d4','#3b82f6','#64748b','#1f2937',
]

interface Props {
  orgSlug: string
  workspaceId: string
  name: string
  description: string
  color: string
  archived?: boolean
}

export function WorkspaceEditButton({ orgSlug, workspaceId, name, description, color, archived = false }: Props) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [form, setForm] = useState({ name, description, color })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const router = useRouter()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const fd = new FormData()
    fd.append('name', form.name)
    fd.append('description', form.description)
    fd.append('color', form.color)
    startTransition(async () => {
      const res = await updateWorkspace(orgSlug, workspaceId, fd)
      if (res?.error) { setError(res.error); return }
      setOpen(false)
      router.refresh()
    })
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteWorkspace(orgSlug, workspaceId)
    })
  }

  function handleArchive() {
    startTransition(async () => {
      const res = await setWorkspaceArchived(orgSlug, workspaceId, !archived)
      if (res?.error) { setError(res.error); return }
      setOpen(false)
      if (archived) router.refresh()
      else router.push(`/${orgSlug}/workspaces`)
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
        title="Editar cliente"
      >
        <Settings className="w-4 h-4" />
      </button>

      {open && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="modal-card w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Editar cliente</h2>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Cor</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                      className={cn('w-7 h-7 rounded-full border-2 transition flex items-center justify-center',
                        form.color === c ? 'border-gray-900 scale-110' : 'border-transparent hover:scale-105'
                      )}
                      style={{ backgroundColor: c }}
                    >
                      {form.color === c && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                    </button>
                  ))}
                </div>
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
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition">
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
        title={`Excluir o cliente "${name}"?`}
        description="Todas as campanhas e atividades deste cliente serão removidas permanentemente. Essa ação não pode ser desfeita."
        confirmLabel="Excluir cliente"
        loading={isPending}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}
