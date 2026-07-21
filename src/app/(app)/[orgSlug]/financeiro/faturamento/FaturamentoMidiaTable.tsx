'use client'

import { Fragment, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { docNumero } from '@/lib/doc-series'
import { lancarMidia, setMidiaAnexos, type Anexo, type FinanceCentro, type FinanceCategoriaGrupo } from '@/app/actions/financeiro'
import { DocsBox, faltando } from './DocsBox'
import { FaturarButton } from './FaturarButton'
import { ClassificacaoFields, type ContaRef, type Classificacao } from './ClassificacaoFields'
import { ContatosButton, type ContatoCard } from './ContatosButton'

export interface CatalogosProps {
  contas: ContaRef[]
  categorias: FinanceCategoriaGrupo[]
  centros: FinanceCentro[]
  defaultConta: string
}

export interface MidiaView {
  id: string
  numero: number | null
  serie?: string | null
  titulo: string
  cliente: string
  veiculo: string
  contatos: ContatoCard[]
  valorDoc: number
  comissao: number
  /** Comissão da produção (migration 132) — vira um 2º lançamento, com outro pagador. */
  comissaoProducao: number
  pagadorProducao: string
  pagador: string
  competencia: string
  vencimento: string
  previstoAgencia: string
  diasAgencia: number
  anexos: Anexo[]
}

export function FaturamentoMidiaTable({ orgSlug, midias, ...cat }: { orgSlug: string; midias: MidiaView[] } & CatalogosProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
      <table className="w-full min-w-[820px]">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
            <th className="text-left px-4 py-3 w-20">Nº</th>
            <th className="text-left px-4 py-3">Título</th>
            <th className="text-left px-4 py-3">Cliente</th>
            <th className="text-left px-4 py-3">Veículo</th>
            <th className="text-right px-4 py-3">Valor doc.</th>
            <th className="text-right px-4 py-3">Comissão</th>
            <th className="w-32" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {midias.map(m => <MidiaRow key={m.id} orgSlug={orgSlug} midia={m} cat={cat} />)}
        </tbody>
      </table>
    </div>
  )
}

function MidiaRow({ orgSlug, midia, cat }: { orgSlug: string; midia: MidiaView; cat: CatalogosProps }) {
  const [open, setOpen] = useState(true)
  const [anexos, setAnexos] = useState<Anexo[]>(midia.anexos)
  const [, startTransition] = useTransition()
  // Pré-preenchido: centro = cliente, categoria = Comissão, conta = padrão da org.
  const [cls, setCls] = useState<Classificacao>({
    conta: cat.defaultConta, categoria: 'Comissão', centro: midia.cliente, forma: '',
  })

  function persist(next: Anexo[]) {
    setAnexos(next)
    startTransition(async () => { await setMidiaAnexos(orgSlug, midia.id, next) })
  }

  return (
    <Fragment>
      <tr className={cn('transition', open ? 'bg-orange-50/40' : 'hover:bg-gray-50/50')}>
        {/* Abre o PDF da autorização em aba nova — o mesmo arquivo que vai pro
            veículo, não uma tela parecida com ele. */}
        <td className="px-4 py-3 whitespace-nowrap">
          <Link href={`/api/docs/midia/${midia.id}?inline=1`} target="_blank"
            title="Abrir a autorização em nova aba (somente leitura; não altera o status)"
            className="group/lnk inline-flex items-center gap-1 text-sm text-gray-500 hover:text-orange-600 tabular-nums transition-colors">
            {docNumero(midia.serie, midia.numero)}
            <ExternalLink className="w-3 h-3 opacity-0 group-hover/lnk:opacity-100 transition-opacity" />
          </Link>
        </td>
        <td className="px-4 py-3 text-sm font-medium text-gray-900">
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-1 hover:text-orange-600 transition">
            <ChevronRight className={cn('w-3.5 h-3.5 text-gray-400 transition-transform duration-200', open && 'rotate-90')} />
            {midia.titulo}
          </button>
        </td>
        <td className="px-4 py-3 text-sm text-gray-600">{midia.cliente}</td>
        <td className="px-4 py-3 text-sm text-gray-600">{midia.veiculo}</td>
        <td className="px-4 py-3 text-sm text-gray-600 text-right tabular-nums">{formatBRL(midia.valorDoc)}</td>
        <td className="px-4 py-3 text-sm font-medium text-emerald-600 text-right tabular-nums">
          {formatBRL(midia.comissao + midia.comissaoProducao)}
          {/* Dois lançamentos vão nascer daqui — a conferência tem que mostrar isso
              ANTES do clique, senão o segundo aparece do nada em Lançamentos. */}
          {midia.comissaoProducao > 0 && (
            <span className="block text-[11px] font-normal text-gray-500" title={`Produção paga por ${midia.pagadorProducao}`}>
              {formatBRL(midia.comissao)} veic. + {formatBRL(midia.comissaoProducao)} prod.
            </span>
          )}
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center justify-end gap-1">
            <ContatosButton contatos={midia.contatos} titulo={`${docNumero(midia.serie, midia.numero)} · ${midia.titulo}`} />
            <FaturarButton
              missing={faltando(anexos)}
              okToast="Comissão lançada no financeiro."
              action={() => lancarMidia(orgSlug, midia.id, {
                conta_id: cls.conta, categoria: cls.categoria, centro_custo: cls.centro, forma_pagamento: cls.forma,
              })}
            />
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50/40">
          <td colSpan={7} className="px-4 pb-4 pt-1">
            <div className="grid gap-3 lg:grid-cols-2">
              <dl className="rounded-xl border border-gray-100 bg-white p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm self-start">
                <div><dt className="text-xs text-gray-400">Comissão (cobrar de)</dt><dd className="text-gray-700">{midia.pagador}</dd></div>
                <div><dt className="text-xs text-gray-400">Competência</dt><dd className="text-gray-700 tabular-nums">{formatDateBR(midia.competencia)}</dd></div>
                <div><dt className="text-xs text-gray-400">Vencimento (veículo)</dt><dd className="text-gray-700 tabular-nums">{formatDateBR(midia.vencimento)}</dd></div>
                <div><dt className="text-xs text-gray-400">Previsto p/ agência{midia.diasAgencia ? ` (+${midia.diasAgencia}d)` : ''}</dt><dd className="text-gray-900 font-medium tabular-nums">{formatDateBR(midia.previstoAgencia)}</dd></div>
                <div><dt className="text-xs text-gray-400">Comissão</dt><dd className="text-emerald-600 font-medium tabular-nums">{formatBRL(midia.comissao)}</dd></div>
              </dl>
              <DocsBox anexos={anexos} onChange={persist} />
              <ClassificacaoFields contas={cat.contas} categorias={cat.categorias} centros={cat.centros}
                value={cls} onChange={p => setCls(c => ({ ...c, ...p }))} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}
