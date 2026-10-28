'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, History } from 'lucide-react'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { parecidos, projetar, tipoDasRefs, type CalibracaoTipo, type HistoricoCotacao } from '@/lib/cotacao-historico'

/**
 * Projeção de custo do item: itens PARECIDOS já cotados ou comprados (mig. 389) e o
 * custo unitário esperado na quantidade da opção. É referência para orçar e negociar —
 * não preenche nada sozinho.
 */
export function ProjecaoCusto({ historico, calibracao = [], nome, descricao, quant, producaoId }: {
  historico: HistoricoCotacao | null; calibracao?: CalibracaoTipo[]; nome: string; descricao: string; quant: number; producaoId?: string
}) {
  const [aberto, setAberto] = useState(false)
  const refs = useMemo(() => parecidos(historico, nome, descricao, producaoId), [historico, nome, descricao, producaoId])
  const proj = useMemo(() => projetar(refs, quant), [refs, quant])
  if (!proj) return null
  // Calibração (mig. 390): o tipo das referências erra de forma CONSISTENTE para um lado?
  const tipo = tipoDasRefs(refs)
  const cal = calibracao.find(c => c.tipo === tipo && c.fator)
  const unit = cal?.fator ? proj.unit * cal.fator : proj.unit
  const faixa = proj.min !== proj.max ? ` (de ${formatBRL(proj.min)} a ${formatBRL(proj.max)})` : ''
  return (
    <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <button type="button" onClick={() => setAberto(a => !a)} className="w-full flex items-center gap-1.5 text-left">
        <History className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className="flex-1 min-w-0">
          Projeção pelo histórico: <b className="text-gray-900">≈ {formatBRL(unit)}/un</b> para ~{proj.quantRef.toLocaleString('pt-BR')} un{faixa}
          {cal?.fator && <span className="text-orange-700"> · ajustada {cal.fator > 1 ? '+' : ''}{Math.round((cal.fator - 1) * 100)}% ({tipo} costuma sair {cal.fator > 1 ? 'acima' : 'abaixo'} da projeção)</span>}
          <span className="text-gray-400"> · {proj.n} referência{proj.n === 1 ? '' : 's'}{proj.n < 3 ? ' (pouca base)' : ''} de {refs.length} item(ns) parecido(s)</span>
        </span>
        {aberto ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
      </button>
      {aberto && (
        <ul className="mt-2 space-y-1">
          {refs.slice(0, 8).map((r, i) => (
            <li key={`${r.producao_id}-${r.fornecedor_id}-${r.quant}-${i}`} className="flex flex-wrap gap-x-2">
              <span className="text-gray-400 tabular-nums">{formatDateBR(r.data)}</span>
              <span className="text-gray-800 truncate max-w-[16rem]" title={r.descricao}>{r.nome}</span>
              <span>· {r.fornecedor}</span>
              <span className="tabular-nums">· {r.quant.toLocaleString('pt-BR')} un × {formatBRL(r.unit)}</span>
              {r.situacao === 'pedido' ? <span className="text-emerald-700">· comprado{r.documento ? ` (${r.documento})` : ''}</span>
                : r.escolhido ? <span className="text-emerald-700">· escolhido</span> : null}
              {r.mais_barato && <span className="text-orange-700">· melhor preço</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
