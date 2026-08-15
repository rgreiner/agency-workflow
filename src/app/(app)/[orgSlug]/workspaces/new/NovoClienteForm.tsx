'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createWorkspace } from '@/app/actions/workspace'
import { ClientForm } from '../ClientForm'

export function NovoClienteForm({ orgSlug, podeMidia }: { orgSlug: string; podeMidia: boolean }) {
  const router = useRouter()
  const [ativarMidia, setAtivarMidia] = useState(false)

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
        onSubmit={fd => {
          fd.set('ativar_midia', String(podeMidia && ativarMidia))
          return createWorkspace(orgSlug, fd)
        }}
        onCancel={() => router.back()}
        extra={podeMidia ? (
          <button type="button" onClick={() => setAtivarMidia(v => !v)}
            className={cn('w-full flex items-start gap-2.5 px-3 py-3 rounded-xl border text-left transition-colors',
              ativarMidia ? 'border-orange-200 bg-orange-50/50' : 'border-gray-200 hover:border-gray-300')}>
            <span className={cn('w-4 h-4 mt-0.5 rounded border flex items-center justify-center shrink-0',
              ativarMidia ? 'bg-orange-600 border-orange-600' : 'border-gray-300')}>
              {ativarMidia && <Check className="w-3 h-3 text-[#fff]" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-gray-800 inline-flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-gray-400" /> Este cliente tem mídia
              </span>
              <span className="block text-[11px] text-gray-400">
                Cria a campanha de operação do ano e abre a implantação (acessos, documentos, social,
                pixel/CRM). As rotinas você escolhe depois, em Mídia → Clientes e rotinas.
              </span>
            </span>
          </button>
        ) : undefined}
      />
    </div>
  )
}
