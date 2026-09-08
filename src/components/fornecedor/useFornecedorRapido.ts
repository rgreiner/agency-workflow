'use client'

/**
 * Cadastro rápido de fornecedor a partir de um Combobox (orçamento, pedido, mídia
 * externa): cria só com o nome, entra na lista local na hora e devolve o id pra
 * o form selecionar. O resto do cadastro fica pra completar em Cadastros ›
 * Fornecedores — o toast já leva pra lá.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createFornecedorRapido } from '@/app/actions/fornecedor'
import type { FornecedorOpt } from '@/lib/midia-selectors'
import { porNome } from '@/lib/utils'

export function useFornecedorRapido(orgSlug: string, iniciais: FornecedorOpt[]) {
  const [fornecedores, setFornecedores] = useState<FornecedorOpt[]>(iniciais)
  const options = useMemo(() => fornecedores.map(f => ({ value: f.id, label: f.name })), [fornecedores])

  /** Cria (ou reaproveita o homônimo) e devolve o id; null se falhou. */
  async function criar(nome: string): Promise<string | null> {
    const r = await createFornecedorRapido(orgSlug, nome)
    if ('error' in r) { toast.error(r.error); return null }
    setFornecedores(prev => prev.some(f => f.id === r.id)
      ? prev
      : [...prev, { id: r.id, name: r.name }].sort(porNome(f => f.name)))
    if (r.existente) {
      toast.success(`"${r.name}" já estava cadastrado — selecionado.`)
    } else {
      toast.success(`"${r.name}" cadastrado. Falta tipo, CNPJ e contato.`, {
        duration: 8000,
        action: { label: 'Completar', onClick: () => window.open(`/${orgSlug}/cadastros/fornecedores?editar=${r.id}`, '_blank') },
      })
    }
    return r.id
  }

  return { fornecedores, options, criar }
}
