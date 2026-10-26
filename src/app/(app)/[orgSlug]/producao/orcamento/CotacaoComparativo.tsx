'use client'

import { Fragment } from 'react'
import { CircleCheck, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/midia'
import { precoResolvido, type CotacaoItem, type ItemOrcBase, type Resposta } from '@/lib/cotacao'
import type { CotacaoView, ConviteView } from './CotacaoPainel'

/**
 * Propostas lado a lado: um bloco por item, uma linha por QUANTIDADE e uma coluna
 * por fornecedor que respondeu. A comparação é pelo UNITÁRIO (o total muda com a
 * quantidade, o unitário é o que mede quem cobra menos); o menor da linha fica
 * verde. Fornecedor com variações (couchê × sulfite) mostra uma linha por variação
 * dentro da célula. Clicar escolhe a opção no orçamento — a mesma ação do círculo
 * na tabela de opções.
 */
export function CotacaoComparativo({ c, itens, onEscolher }: {
  c: CotacaoView
  itens: ItemOrcBase[]
  onEscolher: (conviteId: string, pedido: CotacaoItem, variante: string, quant: number) => void
}) {
  const respostas = c.convites
    .filter(v => v.respondido_em && v.resposta && 'itens' in v.resposta)
    .map(v => ({ v, r: v.resposta as Resposta }))
    .sort((a, b) => menorTotal(a.r) - menorTotal(b.r))
  if (!respostas.length) return <p className="mt-3 text-sm text-gray-400">Ainda ninguém respondeu.</p>

  const escolhida = (v: ConviteView, variante: string, quant: number) =>
    itens.some(it => it.opcoes.some(o => o.selecionado && o.cotacao_convite_id === v.id && String(o.quant) === String(quant) && (o.variante ?? '') === variante))

  return (
    <div className="mt-3 space-y-5">
      {c.itens.map(pedido => {
        // Quantidades que ALGUÉM cotou para este item (o fornecedor pode ter trocado as pedidas).
        const quants = [...new Set(respostas.flatMap(({ r }) => precosDoItem(r, pedido.idx).map(p => p.quant)))].sort((a, b) => a - b)
        if (!quants.length) return null
        return (
          <div key={pedido.idx}>
            <p className="text-sm font-medium text-gray-900 mb-1.5">{pedido.nome}</p>
            <div className="overflow-x-auto border border-gray-100 rounded-xl">
              <table className="w-full text-sm" style={{ minWidth: 120 + respostas.length * 150 }}>
                <thead>
                  <tr className="bg-gray-50 text-[11px] text-gray-500">
                    <th className="px-3 py-2 text-left font-medium w-24">Quant.</th>
                    {respostas.map(({ v }) => <th key={v.id} className="px-3 py-2 text-right font-medium">{v.fornecedor}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {quants.map(q => {
                    const celulas = respostas.map(({ v, r }) => ({
                      v, linhas: precosDoItem(r, pedido.idx).filter(p => p.quant === q),
                      naoFornece: !!r.itens.find(i => i.idx === pedido.idx)?.nao_fornece,
                    }))
                    const menor = Math.min(...celulas.flatMap(cl => cl.linhas.map(l => l.unit)))
                    return (
                      <tr key={q} className="border-t border-gray-100 align-top">
                        <td className="px-3 py-2 tabular-nums text-gray-700">{q.toLocaleString('pt-BR')}</td>
                        {celulas.map(({ v, linhas, naoFornece }) => (
                          <td key={v.id} className="px-2 py-1.5 text-right">
                            {!linhas.length && <span className="text-xs text-gray-300">{naoFornece ? 'não fornece' : '—'}</span>}
                            {linhas.map(l => {
                              const sel = escolhida(v, l.variante, q)
                              const melhor = l.unit === menor && respostas.length > 1
                              return (
                                <button key={l.variante} type="button" onClick={() => onEscolher(v.id, pedido, l.variante, q)}
                                  title={sel ? 'Escolhida no orçamento — clique para desmarcar' : 'Escolher esta opção no orçamento'}
                                  className={cn('w-full flex items-start justify-end gap-1.5 px-1.5 py-1 rounded-lg text-right transition-colors active:scale-[0.98]',
                                    sel ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-gray-50')}>
                                  <span className="min-w-0">
                                    {l.variante && <span className="block text-[11px] font-medium text-orange-700 truncate">{l.variante}</span>}
                                    <span className={cn('block tabular-nums', melhor ? 'font-semibold text-emerald-700' : 'text-gray-900')}>{formatBRL(l.unit)}<span className="text-[11px] font-normal text-gray-400"> /un</span></span>
                                    <span className="block text-[11px] tabular-nums text-gray-500">{formatBRL(l.total)}</span>
                                  </span>
                                  {sel ? <CircleCheck className="w-3.5 h-3.5 mt-0.5 text-emerald-600 shrink-0" /> : <Circle className="w-3.5 h-3.5 mt-0.5 text-gray-200 shrink-0" />}
                                </button>
                              )
                            })}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                  {/* Condições: o mais barato nem sempre é o que entrega a tempo. */}
                  {([['Produção', 'prazo_producao'], ['Pagamento', 'pgto'], ['Validade', 'validade']] as const).map(([rotulo, k]) => (
                    <Fragment key={k}>
                      {respostas.some(({ r }) => r[k]) && (
                        <tr className="border-t border-gray-100 align-top text-xs">
                          <td className="px-3 py-1.5 text-gray-400">{rotulo}</td>
                          {respostas.map(({ v, r }) => <td key={v.id} className="px-3 py-1.5 text-right text-gray-600">{r[k] || '—'}</td>)}
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
      <p className="text-xs text-gray-400">Verde = menor unitário da quantidade. Clique num valor para escolher a opção no orçamento (depois, salve).</p>
    </div>
  )
}

function precosDoItem(r: Resposta, idx: number) {
  const it = r.itens.find(i => i.idx === idx)
  if (!it || it.nao_fornece) return []
  return it.precos.flatMap(p => {
    const v = precoResolvido(p)
    return v ? [{ quant: p.quant, variante: (p.variante ?? '').trim(), unit: v.unit, total: v.total }] : []
  })
}

/** Ordena as colunas: quem tem o menor total aparece primeiro. */
function menorTotal(r: Resposta): number {
  const ts = r.itens.flatMap(i => i.nao_fornece ? [] : i.precos.map(p => precoResolvido(p)?.total ?? Infinity))
  return ts.length ? Math.min(...ts) : Infinity
}
