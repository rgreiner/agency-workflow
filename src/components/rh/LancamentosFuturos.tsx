'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { Wallet, Trash2, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { lancamentosFuturosPessoa, type LancFuturo } from '@/app/actions/rh-financeiro'
import { deleteLancamento } from '@/app/actions/financeiro'

const brl = (v: number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

/**
 * O que ainda está previsto no financeiro para esta pessoa (mig. 268).
 *
 * Aparece na ficha de quem está saindo ou já saiu: o desligamento no RH não
 * mexe no fluxo de caixa sozinho — decisão do Rafael (28/08), o Flow avisa e
 * ele decide. Nasceu de um caso real: a Heloísa saiu com R$ 10.343 de
 * remuneração prevista até fev/2027.
 */
export function LancamentosFuturos({ orgSlug, colaboradorId, nome, ativo }: {
  orgSlug: string; colaboradorId: string; nome: string
  /** false = desligado ou em aviso: é quando a lista importa de verdade. */
  ativo: boolean
}) {
  const [linhas, setLinhas] = useState<LancFuturo[] | null>(null)
  const [pending, start] = useTransition()
  const [excluindo, setExcluindo] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const r = await lancamentosFuturosPessoa(orgSlug, colaboradorId)
    // Sem acesso ao Financeiro a RPC recusa: o bloco simplesmente não aparece.
    if (r.error || !r.linhas) { setLinhas([]); return }
    setLinhas(r.linhas)
  }, [orgSlug, colaboradorId])

  useEffect(() => { carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  function excluir(l: LancFuturo) {
    setExcluindo(l.id)
    start(async () => {
      const r = await deleteLancamento(orgSlug, l.id)
      setExcluindo(null)
      if (r?.error) { toast.error(r.error); return }
      toast.success(`Lançamento de ${dataBR(l.vencimento)} excluído.`)
      carregar()
    })
  }

  if (!linhas?.length) return null

  const total = linhas.reduce((s, l) => s + Number(l.valor), 0)

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
        <Wallet className="w-4 h-4" /> Previsto no financeiro
        <span className="text-gray-400 font-normal">{linhas.length} lançamento(s) · {brl(total)}</span>
      </h2>
      <p className="text-xs text-gray-400 mb-3">
        {ativo
          ? `Saídas em aberto no nome de ${nome.split(' ')[0]} daqui para frente.`
          : `${nome.split(' ')[0]} está saindo (ou já saiu) e estes valores continuam previstos no fluxo de caixa. Exclua o que não vai acontecer — o Flow não mexe no financeiro sozinho.`}
      </p>

      <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50 overflow-hidden">
        {linhas.map(l => (
          <div key={l.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-900">
                <span className="tabular-nums">{dataBR(l.vencimento)}</span>
                <span className="font-medium tabular-nums ml-2">{brl(l.valor)}</span>
              </div>
              <div className="text-xs text-gray-400 truncate">
                {l.categoria ?? '—'}{l.descricao && ` · ${l.descricao}`}
              </div>
            </div>
            <button onClick={() => excluir(l)} disabled={pending}
              title="Excluir este lançamento do fluxo"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors shrink-0">
              {excluindo === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Excluir
            </button>
          </div>
        ))}
      </div>

      {!ativo && (
        <p className="text-[11px] text-gray-400 mt-2 flex items-start gap-1.5">
          <Check className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            A rescisão continua sendo lançada por você com o valor da contabilidade — o Flow não calcula
            verbas. Guias (FGTS, DARF) e benefícios coletivos caem no mês seguinte e não aparecem aqui.
          </span>
        </p>
      )}
    </section>
  )
}
