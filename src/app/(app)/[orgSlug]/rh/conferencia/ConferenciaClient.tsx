'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { GitCompareArrows, AlertTriangle, Check, ArrowRight, Info } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { carregarConferenciaFolha, type ConferenciaLinha } from '@/app/actions/rh-financeiro'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const labelMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`

const SITUACAO: Record<string, { label: string; cls: string; explica: string }> = {
  sobra: { label: 'Previsto a mais', cls: 'bg-red-50 text-red-700 ring-red-200',
    explica: 'Está previsto no fluxo, mas a pessoa não estará na casa neste mês.' },
  falta: { label: 'Sem previsão', cls: 'bg-amber-50 text-amber-800 ring-amber-200',
    explica: 'A pessoa estará na casa e não há remuneração prevista para ela neste mês.' },
  nome_divergente: { label: 'Nome diferente', cls: 'bg-sky-50 text-sky-700 ring-sky-200',
    explica: 'O nome no lançamento não bate com o da ficha — corrigir evita que a pessoa suma da conferência.' },
  divergente: { label: 'Valor distante', cls: 'bg-amber-50 text-amber-800 ring-amber-200',
    explica: 'Previsto e salário da ficha diferem em mais de 40% — reajuste não lançado ou valor errado.' },
  fora_do_time: { label: 'Fora do time', cls: 'bg-gray-100 text-gray-500 ring-gray-200',
    explica: 'Nome que não é de ninguém no RH: fornecedor de benefício, repasse coletivo.' },
}

export function ConferenciaClient({ orgSlug }: { orgSlug: string }) {
  const [meses, setMeses] = useState(6)
  const [linhas, setLinhas] = useState<ConferenciaLinha[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [verTudo, setVerTudo] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    const r = await carregarConferenciaFolha(orgSlug, meses)
    if (r.error || !r.linhas) { toast.error(r.error ?? 'Falha na conferência'); setLinhas(null) }
    else setLinhas(r.linhas)
    setLoading(false)
  }, [orgSlug, meses])

  useEffect(() => { carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const problemas = useMemo(
    () => (linhas ?? []).filter(l => l.situacao !== 'ok' && (verTudo || l.situacao !== 'fora_do_time')),
    [linhas, verTudo])

  // O número que interessa: quanto de dinheiro está previsto e não vai acontecer.
  const totalSobra = useMemo(
    () => (linhas ?? []).filter(l => l.situacao === 'sobra').reduce((s, l) => s + l.previsto, 0),
    [linhas])
  const totalFalta = useMemo(
    () => (linhas ?? []).filter(l => l.situacao === 'falta').reduce((s, l) => s + l.esperado, 0),
    [linhas])

  // Agrupa por pessoa: o mesmo problema costuma repetir mês a mês.
  const porPessoa = useMemo(() => {
    const m = new Map<string, { nome: string; id: string | null; situacao: string; meses: string[]; total: number; nomeFin: string | null }>()
    for (const l of problemas) {
      const chave = `${l.colaborador_id ?? l.nome_financeiro}|${l.situacao}`
      const atual = m.get(chave)
      const valor = l.situacao === 'falta' ? l.esperado : l.previsto
      if (atual) { atual.meses.push(l.mes); atual.total += valor }
      else m.set(chave, {
        nome: l.nome ?? l.nome_financeiro ?? '—', id: l.colaborador_id,
        situacao: l.situacao, meses: [l.mes], total: valor, nomeFin: l.nome_financeiro,
      })
    }
    const ordem = ['sobra', 'nome_divergente', 'divergente', 'falta', 'fora_do_time']
    return [...m.values()].sort((a, b) =>
      ordem.indexOf(a.situacao) - ordem.indexOf(b.situacao) || b.total - a.total)
  }, [problemas])

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <GitCompareArrows className="w-5 h-5 text-orange-600" /> Folha × Financeiro
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            O que está previsto no fluxo de caixa comparado com quem realmente estará na casa.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
          {[3, 6, 12].map(n => (
            <button key={n} onClick={() => setMeses(n)}
              className={cn('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                meses === n ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800')}>
              {n} meses
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Conferindo…</div>
      ) : !porPessoa.length ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4 py-6 text-center">
          <Check className="w-6 h-6 text-emerald-600 mx-auto mb-1.5" />
          <p className="text-sm font-medium text-emerald-900">Folha prevista e time batem nos próximos {meses} meses.</p>
        </div>
      ) : (<>
        {(totalSobra > 0 || totalFalta > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {totalSobra > 0 && (
              <div className="rounded-2xl border border-red-100 bg-red-50/50 p-4">
                <p className="text-xs text-gray-500 mb-1">Previsto a mais</p>
                <p className="text-xl font-semibold tabular-nums text-red-700">{brl(totalSobra)}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">de gente que não estará na casa — some do fluxo ao limpar</p>
              </div>
            )}
            {totalFalta > 0 && (
              <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
                <p className="text-xs text-gray-500 mb-1">Sem previsão no fluxo</p>
                <p className="text-xl font-semibold tabular-nums text-amber-700">{brl(totalFalta)}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">gente na casa cujo pagamento não está lançado</p>
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
          {porPessoa.map((p, i) => {
            const s = SITUACAO[p.situacao] ?? SITUACAO.fora_do_time
            return (
              <div key={i} className="px-4 py-3 flex items-start gap-3 flex-wrap">
                <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 shrink-0 mt-0.5', s.cls)}>
                  {s.label}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">
                    {p.id ? (
                      <Link href={`/${orgSlug}/rh/${p.id}`} className="hover:text-orange-600 transition-colors">{p.nome}</Link>
                    ) : p.nome}
                    {p.situacao === 'nome_divergente' && p.nomeFin && (
                      <span className="text-xs font-normal text-gray-500"> — no financeiro está “{p.nomeFin}”</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {p.meses.map(labelMes).join(' · ')} · <b className="tabular-nums">{brl(p.total)}</b>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">{s.explica}</p>
                </div>
                {p.situacao === 'sobra' && p.id && (
                  <Link href={`/${orgSlug}/rh/${p.id}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors shrink-0">
                    Resolver na ficha <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
            <input type="checkbox" checked={verTudo} onChange={e => setVerTudo(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-gray-300 accent-orange-600" />
            mostrar também fornecedores e repasses coletivos
          </label>
        </div>
      </>)}

      <p className="text-[11px] text-gray-400 mt-3 flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>
          Compara os lançamentos <b>em aberto</b> de Remuneração (Funcionários, Autônomos, Estagiários) com
          o salário da ficha de quem tem vínculo em cada mês. Guias e benefícios coletivos (FGTS, DARF, VR,
          13º, rescisões) não são por pessoa e ficam de fora. O lançamento costuma trazer o líquido e a ficha
          o bruto — por isso só uma diferença acima de 40% é apontada. O Flow não altera nada no financeiro:
          quem decide é você, na ficha da pessoa.
        </span>
      </p>

      {!loading && !!porPessoa.length && (
        <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-500 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
          <span>
            A conferência só enxerga o que o RH sabe: se o desligamento ainda não foi registrado na ficha,
            a sobra não aparece aqui. Registre a saída primeiro — a demissão é o que dispara tudo.
          </span>
        </div>
      )}
    </div>
  )
}
