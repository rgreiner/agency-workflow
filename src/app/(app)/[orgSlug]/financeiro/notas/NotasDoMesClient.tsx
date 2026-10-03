'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { notasDosLancamentos, type NotaDoLancamento } from '@/app/actions/nfse'
import { NotaCelula, NotaCarregando } from '../lancamentos/NotaFiscal'

export interface ItemNota {
  id: string
  descricao: string
  valor: number
  competencia: string
  origem: 'producao' | 'midia'
  cliente: string
}

const mesLegivel = (ym: string) => {
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  return `${MESES[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`
}

/**
 * A lista de emissão do mês, agrupada por cliente.
 *
 * Agrupar por cliente e não por data porque é assim que a emissão acontece: o
 * tomador é o mesmo, e ver "É O Amor — 6 comissões" responde de uma vez uma
 * pergunta que seis linhas soltas não respondem.
 */
export function NotasDoMesClient({ orgSlug, itens, mesCorrente }: {
  orgSlug: string; itens: ItemNota[]; mesCorrente: string
}) {
  const [notas, setNotas] = useState<Record<string, NotaDoLancamento>>({})
  const [carregando, setCarregando] = useState(itens.length > 0)

  // A nota pode ter sido emitida noutra tela nesta mesma sessão; a linha tem
  // que refletir isso sem exigir F5.
  useEffect(() => {
    // Lista vazia já nasce com carregando=false — nada a sincronizar aqui.
    if (itens.length === 0) return
    let vivo = true
    notasDosLancamentos(orgSlug, itens.map(i => i.id)).then(m => {
      if (!vivo) return
      setNotas(m); setCarregando(false)
    })
    return () => { vivo = false }
  }, [orgSlug, itens])

  const { doMes, atrasados } = useMemo(() => {
    const doMes: ItemNota[] = [], atrasados: ItemNota[] = []
    for (const i of itens) (i.competencia.slice(0, 7) === mesCorrente ? doMes : atrasados).push(i)
    return { doMes, atrasados }
  }, [itens, mesCorrente])

  // A linha emitida continua na tela, agora mostrando a nota: sumir com ela no
  // instante do clique esconde o número que a pessoa acabou de gerar.
  const registrar = (id: string, n: NotaDoLancamento) => setNotas(m => ({ ...m, [id]: n }))

  const emitida = (id: string) => notas[id]?.status === 'autorizada'
  const pendentes = itens.filter(i => !emitida(i.id))
  const total = pendentes.reduce((s, i) => s + i.valor, 0)

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900">NF do mês</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        O que precisa de nota fiscal na competência de <strong className="text-gray-700">{mesLegivel(mesCorrente)}</strong>.
        Parcela de mês futuro não aparece: a nota dela ainda não é devida.
      </p>

      {itens.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <Resumo rotulo="A emitir" valor={String(pendentes.length)} tom="pendente" />
          <Resumo rotulo="Valor" valor={formatBRL(total)} tom="valor" />
          {atrasados.length > 0 && <Resumo rotulo="De meses anteriores" valor={String(atrasados.filter(i => !emitida(i.id)).length)} tom="atraso" />}
        </div>
      )}

      {itens.length === 0 ? (
        <Vazio />
      ) : (
        <div className="space-y-6">
          <Bloco orgSlug={orgSlug} titulo={`Competência de ${mesLegivel(mesCorrente)}`} itens={doMes}
            notas={notas} carregando={carregando} onEmitida={registrar} />
          {atrasados.length > 0 && (
            <Bloco orgSlug={orgSlug} titulo="De meses anteriores" itens={atrasados}
              notas={notas} carregando={carregando} onEmitida={registrar}
              nota="Competência passada sem nota — confira se a nota saiu por fora antes de emitir." />
          )}
        </div>
      )}
    </div>
  )
}

function Resumo({ rotulo, valor, tom }: { rotulo: string; valor: string; tom: 'pendente' | 'valor' | 'atraso' }) {
  return (
    <div className={cn('rounded-xl border px-4 py-2.5',
      tom === 'atraso' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white')}>
      <div className="text-[11px] text-gray-400">{rotulo}</div>
      <div className={cn('text-lg font-semibold tabular-nums',
        tom === 'atraso' ? 'text-amber-700' : tom === 'valor' ? 'text-emerald-600' : 'text-gray-900')}>{valor}</div>
    </div>
  )
}

function Vazio() {
  return (
    <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
      <Check className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
      <h3 className="text-gray-900 font-medium">Nenhuma nota a emitir</h3>
      <p className="text-gray-500 text-sm mt-1 max-w-md mx-auto">
        Tudo que tem competência até este mês já está com nota — emitida aqui ou anexada.
        As parcelas dos próximos meses aparecem quando chegar a competência delas.
      </p>
    </div>
  )
}

function Bloco({ orgSlug, titulo, itens, notas, carregando, nota, onEmitida }: {
  orgSlug: string; titulo: string; itens: ItemNota[]
  notas: Record<string, NotaDoLancamento>; carregando: boolean; nota?: string
  onEmitida: (id: string, n: NotaDoLancamento) => void
}) {
  // Por cliente: o tomador da nota é o mesmo, e o financeiro emite de uma vez.
  const grupos = useMemo(() => {
    const m = new Map<string, ItemNota[]>()
    for (const i of itens) m.set(i.cliente, [...(m.get(i.cliente) ?? []), i])
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
  }, [itens])

  if (itens.length === 0) return null

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-800 mb-1">{titulo} <span className="text-gray-400 font-normal">({itens.length})</span></h2>
      {nota && <p className="text-xs text-amber-700 mb-2">{nota}</p>}
      <div className="space-y-3">
        {grupos.map(([cliente, linhas]) => (
          <div key={cliente} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gray-50/60 border-b border-gray-100">
              <span className="text-sm font-medium text-gray-900 truncate">{cliente}</span>
              <span className="text-xs text-gray-500 tabular-nums shrink-0">
                {linhas.length} item(ns) · {formatBRL(linhas.reduce((s, l) => s + l.valor, 0))}
              </span>
            </div>
            <table className="w-full">
              <tbody className="divide-y divide-gray-50">
                {linhas.map(l => (
                  <tr key={l.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-2.5 text-sm text-gray-900">{l.descricao || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                      <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />{formatDateBR(l.competencia)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap capitalize">{l.origem}</td>
                    <td className="px-3 py-2.5 text-sm font-medium text-gray-900 text-right tabular-nums whitespace-nowrap">{formatBRL(l.valor)}</td>
                    <td className="px-4 py-2.5 text-right w-32">
                      {carregando
                        ? <NotaCarregando />
                        : <NotaCelula orgSlug={orgSlug} lancamentoId={l.id} nota={notas[l.id]} podeEmitir
                            onEmitida={n => onEmitida(l.id, n)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  )
}

