'use client'

import { useMemo } from 'react'
import { Select } from '@/components/ui/Select'
import { categoriaNomes } from '@/lib/finance-categorias'
import type { FinanceCentro, FinanceCategoriaGrupo } from '@/app/actions/financeiro'

export interface ContaRef { id: string; nome: string }
export interface Classificacao { conta: string; categoria: string; centro: string; forma: string }

// Mesmas opções do modal de Lançamentos — a forma é livre, sem default obrigatório.
export const FORMA_OPTIONS = [
  { value: '', label: '—' },
  { value: 'pix', label: 'Pix' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'cartao', label: 'Cartão' },
  { value: 'dinheiro', label: 'Dinheiro' },
]

/**
 * Os 4 campos de classificação do lançamento a receber, pré-preenchidos na
 * conferência do Faturamento (centro = cliente, categoria pelo tipo do doc,
 * conta = padrão da org, forma livre). O que ficar aqui é o que a RPC grava.
 * Faturamento é sempre entrada → só categorias de receita.
 */
export function ClassificacaoFields({
  contas, categorias, centros, value, onChange,
}: {
  contas: ContaRef[]
  categorias: FinanceCategoriaGrupo[]
  centros: FinanceCentro[]
  value: Classificacao
  onChange: (patch: Partial<Classificacao>) => void
}) {
  const catOptions = useMemo(() => {
    const nomes = categoriaNomes(categorias, 'entrada')
    // a categoria já escolhida continua listada mesmo se não estiver na árvore
    const extra = value.categoria && !nomes.includes(value.categoria) ? [value.categoria] : []
    return [...nomes, ...extra].map(n => ({ value: n, label: n }))
  }, [categorias, value.categoria])

  const centroOptions = useMemo(() => {
    const ativos = centros.filter(c => !c.arquivado)
    const extra = value.centro && !ativos.some(c => c.nome === value.centro)
      ? [{ value: value.centro, label: `${value.centro}${centros.some(c => c.nome === value.centro) ? ' (arquivado)' : ''}` }] : []
    return [{ value: '', label: '—' }, ...ativos.map(c => ({ value: c.nome, label: c.nome })), ...extra]
  }, [centros, value.centro])

  const contaOptions = useMemo(
    () => [{ value: '', label: '—' }, ...contas.map(c => ({ value: c.id, label: c.nome }))],
    [contas])

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3 self-start">
      <p className="text-xs font-medium text-gray-500 mb-2">Classificação do lançamento</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="Centro de custo">
          <Select size="sm" value={value.centro} onChange={v => onChange({ centro: v })}
            options={centroOptions} placeholder="cliente" />
        </Field>
        <Field label="Categoria">
          <Select size="sm" value={value.categoria} onChange={v => onChange({ categoria: v })}
            options={catOptions} placeholder="—" />
        </Field>
        <Field label="Conta a receber">
          <Select size="sm" value={value.conta} onChange={v => onChange({ conta: v })}
            options={contaOptions} placeholder="—" />
        </Field>
        <Field label="Forma">
          <Select size="sm" value={value.forma} onChange={v => onChange({ forma: v })}
            options={FORMA_OPTIONS} placeholder="—" />
        </Field>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  )
}
