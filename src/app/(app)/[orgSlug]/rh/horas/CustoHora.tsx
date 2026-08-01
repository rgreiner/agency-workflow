'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Coins, Loader2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setCustoConfig } from '@/app/actions/org-custo'

export interface CamadaPessoa {
  user_id: string; nome: string | null; clt: boolean
  fonte: 'folha' | 'ficha'
  bruto: number; fgts: number; encargos: number; provisoes: number; beneficios: number
  horas_uteis: number; custo_direto_h: number | null; overhead_h: number | null; custo_hora: number | null
}

/** Custo mensal cheio da pessoa (o "Sub Total" do controle anual): tudo que ela
 *  custa no mês, provisões e estrutura incluídas. Anual = ×12. */
const custoMes = (c: CamadaPessoa) => (c.custo_hora ?? 0) * (c.horas_uteis ?? 0)
export interface PrecoVenda {
  comp: string | null
  custo_hora_medio: number | null
  horas_uteis_mes: number
  overhead_estrutura_mes: number
  provisao_lucro_mes: number
  imposto_pct: number
  imposto_auto_pct: number | null
  imposto_manual: boolean
  das_12m: number; recebido_12m: number
  margem_pct: number
  preco_hora: number | null
}

const brl = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const compLabel = (c: string | null) => {
  if (!c) return ''
  const [y, m] = c.split('-')
  return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(m) - 1]}/${y}`
}

/**
 * Composição do custo da hora (5 camadas, migration 170) + preço de venda.
 * Simples Nacional em regime de caixa: a CPP mora no DAS, então "encargos" tende
 * a zero e o peso tributário entra como % sobre o recebido, na fórmula do preço.
 */
export function CustoHora({ orgSlug, orgId, camadas, preco, canConfig }: {
  orgSlug: string; orgId: string
  camadas: CamadaPessoa[]; preco: PrecoVenda | null; canConfig: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [provisao, setProvisao] = useState(preco ? String(preco.provisao_lucro_mes || '') : '')
  const [margem, setMargem] = useState(preco ? String(preco.margem_pct) : '20')
  const [imposto, setImposto] = useState(preco?.imposto_manual ? String(preco.imposto_pct) : '')

  if (!camadas.length) return null

  function salvar() {
    start(async () => {
      const r = await setCustoConfig(orgSlug, orgId, {
        provisaoLucro: provisao === '' ? 0 : Number(provisao.replace(',', '.')),
        margemAlvoPct: margem === '' ? 20 : Number(margem.replace(',', '.')),
        impostoPct: imposto === '' ? null : Number(imposto.replace(',', '.')),
      })
      if (r?.error) toast.error(r.error)
      else { toast.success('Configuração do custo salva.'); router.refresh() }
    })
  }

  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
        <Coins className="w-4 h-4" /> Custo da hora — composição completa
        {preco?.comp && <span className="text-gray-400 font-normal">· folha de {compLabel(preco.comp)}</span>}
      </h2>
      <p className="text-xs text-gray-400 mb-3">
        Bruto + FGTS + encargos da guia + provisões (13º/férias/aviso, só CLT) + benefícios, ÷ horas úteis,
        + estrutura rateada. Custo/mês é o proporcional mensal do custo global anual (Custo/ano = ×12).
        O relatório acima já usa este custo cheio.
      </p>

      {/* Preço de venda */}
      {preco && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500 mb-1">Custo médio da hora</p>
            <p className="text-xl font-semibold tabular-nums text-gray-900">{brl(preco.custo_hora_medio)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">ponderado · {preco.horas_uteis_mes}h úteis/mês</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500 mb-1">Estrutura + provisão de lucro</p>
            <p className="text-xl font-semibold tabular-nums text-gray-900">
              {brl((preco.overhead_estrutura_mes || 0) + (preco.provisao_lucro_mes || 0))}<span className="text-sm font-normal text-gray-400">/mês</span>
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">{brl(preco.overhead_estrutura_mes)} estrutura · {brl(preco.provisao_lucro_mes)} lucro</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500 mb-1">Imposto sobre a venda</p>
            <p className="text-xl font-semibold tabular-nums text-gray-900">{preco.imposto_pct}%</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {preco.imposto_manual
                ? `manual · auto seria ${preco.imposto_auto_pct ?? '—'}%`
                : `automático: DAS ÷ recebido (12m)`}
            </p>
          </div>
          <div className="rounded-2xl border border-orange-100 bg-orange-50/50 p-4">
            <p className="text-xs text-gray-500 mb-1">Preço de venda da hora</p>
            <p className="text-xl font-semibold tabular-nums text-orange-700">{brl(preco.preco_hora)}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">custo ÷ (1 − {preco.imposto_pct}% − {preco.margem_pct}%)</p>
          </div>
        </div>
      )}

      {/* Composição por pessoa */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              <th className="px-4 py-2.5 font-medium">Pessoa</th>
              <th className="px-3 py-2.5 font-medium text-right">Bruto</th>
              <th className="px-3 py-2.5 font-medium text-right">FGTS</th>
              <th className="px-3 py-2.5 font-medium text-right">Encargos</th>
              <th className="px-3 py-2.5 font-medium text-right">Provisões</th>
              <th className="px-3 py-2.5 font-medium text-right">Benefícios</th>
              <th className="px-3 py-2.5 font-medium text-right">Direto/h</th>
              <th className="px-3 py-2.5 font-medium text-right">Estrutura/h</th>
              <th className="px-3 py-2.5 font-medium text-right">Custo/h cheio</th>
              <th className="px-3 py-2.5 font-medium text-right">Custo/mês</th>
              <th className="px-4 py-2.5 font-medium text-right">Custo/ano</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {camadas.map(c => (
              <tr key={c.user_id}>
                <td className="px-4 py-2.5 text-gray-800 whitespace-nowrap">
                  {c.nome ?? '—'}
                  {c.fonte === 'ficha'
                    ? <span className="ml-1.5 text-[10px] text-sky-600 bg-sky-50 rounded-full px-1.5 py-0.5" title="Fora da folha da contabilidade — custo vem da ficha (bolsa/valor mensal + benefícios)">ficha</span>
                    : !c.clt && <span className="ml-1.5 text-[10px] text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">sócio</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{brl(c.bruto)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{brl(c.fgts)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{brl(c.encargos)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{brl(c.provisoes)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{brl(c.beneficios)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{brl(c.custo_direto_h)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{brl(c.overhead_h)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-900">{brl(c.custo_hora)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-900">{brl(custoMes(c))}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{brl(custoMes(c) * 12)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50/60 text-gray-900 font-semibold">
              <td className="px-4 py-2.5">Total do time</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{brl(camadas.reduce((s, c) => s + c.bruto, 0))}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{brl(camadas.reduce((s, c) => s + c.fgts, 0))}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{brl(camadas.reduce((s, c) => s + c.encargos, 0))}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{brl(camadas.reduce((s, c) => s + c.provisoes, 0))}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{brl(camadas.reduce((s, c) => s + c.beneficios, 0))}</td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-right tabular-nums">{brl(camadas.reduce((s, c) => s + custoMes(c), 0))}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{brl(camadas.reduce((s, c) => s + custoMes(c), 0) * 12)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[11px] text-gray-400 mt-2 flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>
          Encargos vêm da guia INSS lançada pela Folha → Financeiro (no Simples a CPP está dentro do DAS,
          então tendem a zero — o peso tributário entra no preço da hora, não aqui). Provisões = 22% do
          bruto (13º 8,33% + férias+⅓ 11,11% + FGTS sobre ambos ~1,6% + aviso indenizado 1%), só CLT.
          Benefícios (VR/VT/plano a custo-empresa) saem da ficha de cada pessoa (RH → Pessoas). Quem não
          vem na folha da contabilidade (estágio/terceiro) entra com a etiqueta “ficha”: bolsa + benefícios
          da ficha, sem encargos. Custo/mês × 12 = custo global anual provisionado.
        </span>
      </p>

      {/* Config — owner/admin */}
      {canConfig && (
        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-1">Provisão de lucro (R$/mês)</label>
            <input
              inputMode="decimal" value={provisao} onChange={e => setProvisao(e.target.value)}
              placeholder="0,00"
              className="w-36 text-sm bg-gray-100 border border-transparent rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
            <p className="text-[10px] text-gray-400 mt-1">distribuição projetada · entra na estrutura</p>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-1">Margem alvo (%)</label>
            <input
              inputMode="decimal" value={margem} onChange={e => setMargem(e.target.value)}
              className="w-24 text-sm bg-gray-100 border border-transparent rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-1">Imposto s/ venda (%)</label>
            <input
              inputMode="decimal" value={imposto} onChange={e => setImposto(e.target.value)}
              placeholder={`auto: ${preco?.imposto_auto_pct ?? '—'}%`}
              className="w-28 text-sm bg-gray-100 border border-transparent rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
            <p className="text-[10px] text-gray-400 mt-1">vazio = automático pelo caixa</p>
          </div>
          <button
            type="button" onClick={salvar} disabled={pending}
            className={cn('flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl transition-colors',
              'bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-50')}
          >
            {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar
          </button>
        </div>
      )}
    </section>
  )
}
