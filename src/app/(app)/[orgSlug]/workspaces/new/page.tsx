'use client'

import { useParams, useRouter } from 'next/navigation'
import { createWorkspace } from '@/app/actions/workspace'
import { ArrowLeft } from 'lucide-react'
import { ClientForm } from '../ClientForm'

export default function NewWorkspacePage() {
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const router = useRouter()

  return (
    <div className="p-6 max-w-2xl">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-5"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <h1 className="text-xl font-semibold text-gray-900 mb-1">Novo cliente</h1>
      <p className="text-gray-500 text-sm mb-6">Cadastre os dados do cliente. Só o nome é obrigatório.</p>

      <ClientForm
        submitLabel="Criar cliente"
        onSubmit={(fd) => createWorkspace(orgSlug, fd)}
        onCancel={() => router.back()}
      />
    </div>
  )
}
