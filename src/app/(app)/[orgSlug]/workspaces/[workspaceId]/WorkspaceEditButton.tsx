'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateWorkspace, deleteWorkspace, setWorkspaceArchived } from '@/app/actions/workspace'
import { Settings, X, Trash2, Archive, ArchiveRestore } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ClientForm, type ClientFormValues } from '../ClientForm'
import type { ContatoData } from '@/components/ui/ContatoBlocks'

interface Props {
  orgSlug: string
  workspaceId: string
  name: string
  archived?: boolean
  initial: Partial<ClientFormValues>
  initialContato?: ContatoData
}

export function WorkspaceEditButton({ orgSlug, workspaceId, name, archived = false, initial, initialContato }: Props) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleDelete() {
    startTransition(async () => {
      await deleteWorkspace(orgSlug, workspaceId)
    })
  }

  function handleArchive() {
    startTransition(async () => {
      const res = await setWorkspaceArchived(orgSlug, workspaceId, !archived)
      if (res?.error) return
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
          <div className="modal-card w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-gray-200 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h2 className="text-base font-semibold text-gray-900">Editar cliente</h2>
              <button aria-label="Fechar" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto">
              <ClientForm
                initial={initial}
                initialContato={initialContato}
                submitLabel="Salvar"
                onSubmit={(fd) => updateWorkspace(orgSlug, workspaceId, fd)}
                onSuccess={() => { setOpen(false); router.refresh() }}
                onCancel={() => setOpen(false)}
                footerLeft={
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
                }
              />
            </div>
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
