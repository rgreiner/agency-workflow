'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { Modal, ModalHeader } from '@/components/ui/Modal'

type Opcao = { id: string; name: string }

/** Filtro cliente → campanha (na URL) + "Nova ata", que pede o cliente se faltar. */
export function FiltrosReunioes({ orgSlug, clientes, campanhas, ws, c, podeCriar }: {
  orgSlug: string
  clientes: Opcao[]
  campanhas: Opcao[]
  ws: string
  c: string
  podeCriar: boolean
}) {
  const router = useRouter()
  const [pedeCliente, setPedeCliente] = useState(false)
  const [cliente, setCliente] = useState('')

  const ir = (novoWs: string, novaC = '') => {
    const p = new URLSearchParams()
    if (novoWs) p.set('ws', novoWs)
    if (novoWs && novaC) p.set('c', novaC)
    router.push(`/${orgSlug}/reunioes${p.size ? `?${p}` : ''}`)
  }
  const nova = (wsId: string) =>
    router.push(`/${orgSlug}/workspaces/${wsId}/reunioes/nova${wsId === ws && c ? `?c=${c}` : ''}`)

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <Select size="sm" value={ws} onChange={v => ir(v)}
        options={[{ value: '', label: 'Todos os clientes' }, ...clientes.map(x => ({ value: x.id, label: x.name }))]} />
      {ws && (
        <Select size="sm" value={c} onChange={v => ir(ws, v)}
          options={[{ value: '', label: 'Todas as campanhas' }, ...campanhas.map(x => ({ value: x.id, label: x.name }))]} />
      )}
      {podeCriar && (
        <button type="button" onClick={() => (ws ? nova(ws) : setPedeCliente(true))}
          className="press ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-xl text-[#fff] bg-orange-600 hover:bg-orange-700 transition-colors">
          <Plus className="w-4 h-4" /> Nova ata
        </button>
      )}

      <Modal open={pedeCliente} onClose={() => setPedeCliente(false)} size="sm" label="Nova ata">
        <ModalHeader title="Reunião com qual cliente?" onClose={() => setPedeCliente(false)} />
        <div className="px-6 py-4">
          <Select value={cliente} onChange={setCliente} placeholder="Escolher cliente" className="w-full"
            options={clientes.map(x => ({ value: x.id, label: x.name }))} />
        </div>
        <div className="flex justify-end gap-2 px-6 pb-5">
          <button type="button" onClick={() => setPedeCliente(false)}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
          <button type="button" disabled={!cliente} onClick={() => nova(cliente)}
            className="press px-4 py-2 text-sm font-semibold text-[#fff] bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors disabled:opacity-50">
            Continuar
          </button>
        </div>
      </Modal>
    </div>
  )
}
