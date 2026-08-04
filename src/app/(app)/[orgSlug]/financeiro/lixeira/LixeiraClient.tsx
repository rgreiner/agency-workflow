'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Search, RotateCcw, Loader2, Trash2, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { Modal } from '@/components/ui/Modal'
import { restaurarExtrato } from '@/app/actions/financeiro'

export interface LixeiraItem {
  import_ref: string
  motivo: string | null
  descartado_em: string
  descartado_por: string | null
  /** false = a linha não voltou no último import da Conta Azul (descarte órfão). */
  existe: boolean
  contato: string | null
  descricao: string | null
  categoria: string | null
  conta: string | null
  tipo: string | null          // receita | despesa
  situacao: string | null      // rótulo da Conta Azul
  valor: number | string | null
  vencimento: string | null
  /** Já existe lançamento promovido desta linha — restaurar duplicaria na tela. */
  promovido: boolean
}

type Filtro = 'todos' | 'receita' | 'despesa'

const quando = (iso: string) => `${formatDateBR(iso.slice(0, 10))} às ${iso.slice(11, 16)}`

export function LixeiraClient({ orgSlug, itens, today }: {
  orgSlug: string; itens: LixeiraItem[]; today: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [query, setQuery] = useState('')
  const [tipo, setTipo] = useState<Filtro>('todos')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [confirmarLote, setConfirmarLote] = useState(false)

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase()
    return itens.filter(i => {
      if (tipo !== 'todos' && (i.tipo ?? '') !== tipo) return false
      if (!q) return true
      return [i.contato, i.descricao, i.categoria, i.motivo, i.descartado_por]
        .some(v => (v ?? '').toLowerCase().includes(q))
    })
  }, [itens, query, tipo])

  const totais = useMemo(() => {
    let receber = 0, pagar = 0
    for (const i of itens) {
      const v = Math.abs(Number(i.valor ?? 0))
      if (i.tipo === 'despesa') pagar += v; else receber += v
    }
    return { receber, pagar }
  }, [itens])

  // A seleção é por import_ref e sobrevive à troca de filtro — mas o "selecionar
  // todas" só marca o que está à vista, senão um clique restauraria coisa fora do
  // recorte sem a pessoa nunca ter visto.
  const visiveis = filtrados.map(i => i.import_ref)
  const todasVisiveisMarcadas = visiveis.length > 0 && visiveis.every(r => sel.has(r))

  function toggle(ref: string) {
    setSel(prev => { const n = new Set(prev); if (n.has(ref)) n.delete(ref); else n.add(ref); return n })
  }
  function toggleTodas() {
    setSel(prev => {
      const n = new Set(prev)
      if (todasVisiveisMarcadas) visiveis.forEach(r => n.delete(r))
      else visiveis.forEach(r => n.add(r))
      return n
    })
  }

  function restaurar(refs: string[]) {
    setConfirmarLote(false)
    startTransition(async () => {
      const r = await restaurarExtrato(orgSlug, refs)
      if (r?.error) { toast.error(r.error); return }
      const n = r?.restauradas ?? 0
      toast.success(n === 1
        ? 'Linha restaurada — voltou para Lançamentos.'
        : `${n} linhas restauradas — voltaram para Lançamentos.`)
      setSel(new Set())
      router.refresh()
    })
  }

  const nSel = sel.size

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900">Lixeira do extrato</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Linhas do extrato importado (Conta Azul) que foram descartadas — nada foi apagado.
          Restaurar traz a linha de volta para Lançamentos e Inadimplentes.
        </p>
      </div>

      {/* Cards de total */}
      <div className="grid grid-cols-3 gap-3 mb-5 max-w-2xl">
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-[11px] font-medium text-gray-400 mb-1">Linhas descartadas</p>
          <p className="text-base font-semibold text-gray-900 tabular-nums">{itens.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-[11px] font-medium text-gray-400 mb-1">Fora do a receber</p>
          <p className="text-base font-semibold text-emerald-600 tabular-nums">{formatBRL(totais.receber)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-[11px] font-medium text-gray-400 mb-1">Fora do a pagar</p>
          <p className="text-base font-semibold text-red-600 tabular-nums">{formatBRL(totais.pagar)}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-xl p-0.5">
          {([['todos', 'Todas'], ['receita', 'A receber'], ['despesa', 'A pagar']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setTipo(v)} aria-pressed={tipo === v}
              className={cn('px-3 py-1.5 text-sm font-medium rounded-[10px] transition-colors',
                tipo === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por contato, descrição, motivo ou quem descartou"
            className="w-full pl-9 pr-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
        </div>
      </div>

      {/* Barra de seleção */}
      <div className="flex items-center justify-between gap-3 mb-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <span className="text-sm text-gray-500">
          {filtrados.length} de {itens.length} linha(s)
          {nSel > 0 && <span className="text-gray-900 font-medium"> · {nSel} selecionada(s)</span>}
        </span>
        <button type="button" disabled={nSel === 0 || isPending}
          onClick={() => (nSel === 1 ? restaurar([...sel]) : setConfirmarLote(true))}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-[#fff] bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97]">
          {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          Restaurar selecionadas
        </button>
      </div>

      {/* Lista */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full min-w-[980px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
              <th className="w-10 px-4 py-3">
                <input type="checkbox" checked={todasVisiveisMarcadas} onChange={toggleTodas}
                  aria-label="Selecionar todas as linhas à vista"
                  className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500" />
              </th>
              <th className="text-left px-4 py-3 w-28">Vencimento</th>
              <th className="text-left px-4 py-3">Contato / descrição</th>
              <th className="text-right px-4 py-3 w-32">Valor</th>
              <th className="text-left px-4 py-3 w-56">Descartada</th>
              <th className="w-32" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtrados.map(i => (
              <Linha key={i.import_ref} item={i} today={today} marcada={sel.has(i.import_ref)}
                onToggle={() => toggle(i.import_ref)} onRestaurar={() => restaurar([i.import_ref])}
                pendente={isPending} />
            ))}
          </tbody>
        </table>
        {filtrados.length === 0 && (
          <p className="text-sm text-gray-400 px-4 py-12 text-center">
            {itens.length === 0 ? 'A lixeira está vazia — nenhuma linha do extrato foi descartada.' : 'Nada encontrado com esse filtro.'}
          </p>
        )}
      </div>

      <Modal open={confirmarLote} onClose={() => setConfirmarLote(false)} size="sm" label="Restaurar linhas">
        <div className="p-5">
          <h2 className="text-sm font-semibold text-gray-900">Restaurar {nSel} linhas?</h2>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">
            Elas voltam a aparecer em Lançamentos e a contar como título em aberto em
            Inadimplentes. Dá para descartar de novo a qualquer momento.
          </p>
          <div className="flex items-center justify-end gap-2 mt-5">
            <button onClick={() => setConfirmarLote(false)}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
              Cancelar
            </button>
            <button onClick={() => restaurar([...sel])} disabled={isPending}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#fff] bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors disabled:opacity-60">
              {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Restaurar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Linha({ item, today, marcada, onToggle, onRestaurar, pendente }: {
  item: LixeiraItem; today: string; marcada: boolean
  onToggle: () => void; onRestaurar: () => void; pendente: boolean
}) {
  const isSaida = item.tipo === 'despesa'
  const valor = Math.abs(Number(item.valor ?? 0))
  const vencida = !!item.vencimento && item.vencimento < today

  return (
    <tr className={cn('text-sm transition-colors', marcada ? 'bg-orange-50/40' : 'hover:bg-gray-50/60')}>
      <td className="px-4 py-3 align-top">
        <input type="checkbox" checked={marcada} onChange={onToggle}
          aria-label={`Selecionar ${item.contato ?? 'linha'}`}
          className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500" />
      </td>
      <td className="px-4 py-3 align-top whitespace-nowrap">
        <span className={cn('tabular-nums', vencida ? 'text-red-600' : 'text-gray-700')}>
          {item.vencimento ? formatDateBR(item.vencimento) : '—'}
        </span>
      </td>
      <td className="px-4 py-3 align-top">
        <p className="font-medium text-gray-900">{item.contato?.trim() || 'Sem contato'}</p>
        {item.descricao && <p className="text-gray-500 mt-0.5 line-clamp-2">{item.descricao}</p>}
        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          {item.categoria && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500">{item.categoria}</span>
          )}
          {item.situacao && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500">{item.situacao}</span>
          )}
          {/* Restaurar aqui criaria a linha do extrato ao lado do lançamento que já
              veio dela — o mesmo título duas vezes na tela. */}
          {item.promovido && (
            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700">
              <AlertTriangle className="w-3 h-3" /> já virou lançamento
            </span>
          )}
          {!item.existe && (
            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500">
              <Info className="w-3 h-3" /> não está mais no extrato
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 align-top text-right whitespace-nowrap">
        <span className={cn('font-semibold tabular-nums', isSaida ? 'text-red-600' : 'text-emerald-600')}>
          {isSaida ? '−' : ''}{formatBRL(valor)}
        </span>
      </td>
      <td className="px-4 py-3 align-top">
        <p className="text-gray-600 whitespace-nowrap">{quando(item.descartado_em)}</p>
        {item.descartado_por && <p className="text-gray-400 text-xs mt-0.5">por {item.descartado_por}</p>}
        {item.motivo && <p className="text-gray-500 text-xs mt-0.5 italic line-clamp-2">{item.motivo}</p>}
      </td>
      <td className="px-4 py-3 align-top text-right">
        <button type="button" onClick={onRestaurar} disabled={pendente}
          title={item.existe ? 'Trazer a linha de volta para Lançamentos' : 'A linha não está mais no extrato — isto só limpa o registro do descarte'}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40 active:scale-[0.97]">
          {item.existe ? <RotateCcw className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
          {item.existe ? 'Restaurar' : 'Limpar'}
        </button>
      </td>
    </tr>
  )
}
