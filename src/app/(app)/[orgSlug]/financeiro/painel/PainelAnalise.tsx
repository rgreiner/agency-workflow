'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/midia'
import { Select } from '@/components/ui/Select'
import {
  macroPorCategoria, coresPorNome, isTransferenciaCategoria,
  type CategoriaGrupoLike,
} from '@/lib/finance-categorias'
import type { FinanceCentro } from '@/app/actions/financeiro'

export interface AnaliseLanc {
  tipo: string
  valor: number | string
  categoria: string | null
  centro_custo: string | null
  competencia: string | null
  vencimento: string | null
}

type Gran = 'trimestre' | 'semestre' | 'ano'
const GRANS: { value: Gran; label: string }[] = [
  { value: 'trimestre', label: 'Trimestre' },
  { value: 'semestre', label: 'Semestre' },
  { value: 'ano', label: 'Ano' },
]

const PALETA = ['#f97316', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#eab308', '#14b8a6', '#ef4444', '#6366f1', '#06b6d4']

function dataDe(l: AnaliseLanc): string | null {
  return l.competencia ?? l.vencimento
}
function periodoDe(iso: string, g: Gran): string {
  const y = iso.slice(0, 4)
  const mo = Number(iso.slice(5, 7))
  if (g === 'ano') return y
  if (g === 'semestre') return `${y}-S${mo <= 6 ? 1 : 2}`
  return `${y}-T${Math.ceil(mo / 3)}`
}
function periodoLabel(p: string): string {
  return p.replace('-S', ' · S').replace('-T', ' · T')
}

interface Fatia { nome: string; valor: number; cor: string }

/** Os 3 gráficos de análise do painel: receita por cliente, faturado por linha,
 *  custo por macro. Transferência entre contas é EXCLUÍDA (não é venda nem despesa). */
export function PainelAnalise({ lancamentos, categorias, centros }: {
  lancamentos: AnaliseLanc[]
  categorias: CategoriaGrupoLike[]
  centros: FinanceCentro[]
}) {
  const [gran, setGran] = useState<Gran>('ano')

  const periodos = useMemo(() => {
    const set = new Set<string>()
    for (const l of lancamentos) {
      const d = dataDe(l)
      if (d) set.add(periodoDe(d, gran))
    }
    return Array.from(set).sort().reverse()
  }, [lancamentos, gran])

  const [periodo, setPeriodo] = useState<string>('')
  // período válido = o escolhido, se existir na granularidade atual; senão o mais recente.
  const periodoAtivo = periodos.includes(periodo) ? periodo : (periodos[0] ?? '')

  const macroMap = useMemo(() => macroPorCategoria(categorias), [categorias])
  const cores = useMemo(() => coresPorNome(categorias), [categorias])
  const coresCentro = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of centros) if (c.cor) m.set(c.nome.toLowerCase(), c.cor)
    return m
  }, [centros])

  const { porCentro, porLinha, porMacro } = useMemo(() => {
    const noPeriodo = lancamentos.filter(l => {
      const d = dataDe(l)
      return d && periodoDe(d, gran) === periodoAtivo && !isTransferenciaCategoria(l.categoria)
    })

    const agrupa = (arr: AnaliseLanc[], chave: (l: AnaliseLanc) => string, cor: (nome: string) => string): Fatia[] => {
      const m = new Map<string, number>()
      for (const l of arr) {
        const k = chave(l)
        m.set(k, (m.get(k) ?? 0) + Number(l.valor ?? 0))
      }
      return [...m.entries()]
        .map(([nome, valor]) => ({ nome, valor, cor: cor(nome) }))
        .filter(f => f.valor > 0.005)
        .sort((a, b) => b.valor - a.valor)
    }

    const entradas = noPeriodo.filter(l => l.tipo === 'entrada')
    const saidas = noPeriodo.filter(l => l.tipo === 'saida')
    // Cor da config quando existe; senão uma cor estável por nome (não pisca entre renders).
    const corConfig = (n: string) => cores.get(n.toLowerCase()) ?? PALETA[hash(n) % PALETA.length]

    return {
      porCentro: agrupa(entradas, l => l.centro_custo || '(sem centro)', n => coresCentro.get(n.toLowerCase()) ?? PALETA[hash(n) % PALETA.length]),
      porLinha: agrupa(entradas, l => l.categoria || '(sem categoria)', corConfig),
      porMacro: agrupa(saidas, l => macroMap.get((l.categoria || '').toLowerCase()) || l.categoria || '(sem categoria)', corConfig),
    }
  }, [lancamentos, gran, periodoAtivo, macroMap, cores, coresCentro])

  const temDado = porCentro.length + porLinha.length + porMacro.length > 0

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-900">Análise por período</h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl bg-gray-100 p-0.5">
            {GRANS.map(g => (
              <button key={g.value} onClick={() => setGran(g.value)}
                className={cn('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  gran === g.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                {g.label}
              </button>
            ))}
          </div>
          <div className="w-40">
            <Select size="sm" value={periodoAtivo}
              onChange={setPeriodo}
              options={periodos.map(p => ({ value: p, label: periodoLabel(p) }))}
              placeholder="Período" />
          </div>
        </div>
      </div>

      {!temDado ? (
        <p className="text-sm text-gray-400 py-8 text-center">Sem lançamentos neste período.</p>
      ) : (
        <div className="grid lg:grid-cols-3 gap-5">
          <BarCard titulo="Receita por cliente" subtitulo="quem trouxe mais dinheiro" fatias={porCentro} />
          <BarCard titulo="Faturado por linha" subtitulo="Fee · Job · Produção · Comissão" fatias={porLinha} />
          <BarCard titulo="Custo por macro-categoria" subtitulo="para onde vai a saída" fatias={porMacro} />
        </div>
      )}
      <p className="text-[11px] text-gray-400">Transferência entre contas não entra (é dinheiro mudando de conta, não venda nem despesa).</p>
    </section>
  )
}

/** Barras horizontais com o top 8 + "outros"; total e % por fatia. */
function BarCard({ titulo, subtitulo, fatias }: { titulo: string; subtitulo: string; fatias: Fatia[] }) {
  const total = fatias.reduce((s, f) => s + f.valor, 0)
  const TOP = 8
  const visiveis = fatias.slice(0, TOP)
  const resto = fatias.slice(TOP)
  const linhas = resto.length
    ? [...visiveis, { nome: `Outros (${resto.length})`, valor: resto.reduce((s, f) => s + f.valor, 0), cor: '#cbd5e1' }]
    : visiveis
  const max = Math.max(1, ...linhas.map(f => f.valor))

  return (
    <div className="min-w-0">
      <div className="mb-3">
        <h3 className="text-xs font-semibold text-gray-800">{titulo}</h3>
        <p className="text-[11px] text-gray-400">{subtitulo}</p>
        <p className="text-sm font-semibold text-gray-900 mt-1 tabular-nums">{formatBRL(total)}</p>
      </div>
      <ul className="space-y-2">
        {linhas.map(f => (
          <li key={f.nome} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 mb-0.5">
              <span className="text-xs text-gray-600 truncate" title={f.nome}>{f.nome}</span>
              <span className="text-[11px] text-gray-500 tabular-nums shrink-0">
                {formatBRL(f.valor)} <span className="text-gray-300">·</span> {Math.round((f.valor / total) * 100)}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.max((f.valor / max) * 100, 3)}%`, backgroundColor: f.cor }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Hash estável nome→índice, pra cor consistente entre renders quando não há cor na config.
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
