'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, CheckCheck, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { notasDosLancamentos, type NotaDoLancamento } from '@/app/actions/nfse'
import { setLancamentoFlags } from '@/app/actions/financeiro'
import { NotaCelula, NotaCarregando } from '../lancamentos/NotaFiscal'

export interface ItemNota {
  id: string
  /** "MX 1632", "PP 146" — o que o financeiro reconhece. */
  doc: string | null
  titulo: string
  /** Veículo · período — o que distingue duas mídias do mesmo cliente e valor. */
  detalhe: string | null
  /** Só quando não é a comissão principal (mídia com parte de produção). */
  parte: string | null
  valor: number
  competencia: string
  origem: 'producao' | 'midia'
  cliente: string
  /** Estado atual do boleto — a ação de flag grava os dois de uma vez. */
  boleto: boolean
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const mesLegivel = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`

/**
 * A lista de emissão do mês, agrupada por cliente.
 *
 * Agrupa por cliente porque é assim que a emissão acontece: o tomador é o
 * mesmo. Cada linha diz o DOCUMENTO (MX/PP + título + veículo + período), não a
 * descrição do lançamento — em mídia ela é "Desconto Padrão Agência" sempre, e
 * deixava sete linhas da mesma cliente indistinguíveis.
 */
export function NotasDoMesClient({ orgSlug, itens, mesCorrente }: {
  orgSlug: string; itens: ItemNota[]; mesCorrente: string
}) {
  const router = useRouter()
  const [notas, setNotas] = useState<Record<string, NotaDoLancamento>>({})
  const [carregando, setCarregando] = useState(itens.length > 0)
  // Marcadas como emitidas fora do Flow nesta sessão: somem da conta na hora,
  // com desfazer, sem esperar o servidor redesenhar a página.
  const [fora, setFora] = useState<Set<string>>(new Set())

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

  const registrar = (id: string, n: NotaDoLancamento) => setNotas(m => ({ ...m, [id]: n }))

  async function marcarFora(item: ItemNota, valor: boolean) {
    setFora(s => { const n = new Set(s); if (valor) n.add(item.id); else n.delete(item.id); return n })
    const r = await setLancamentoFlags(orgSlug, item.id, valor, item.boleto)
    if (r?.error) {
      setFora(s => { const n = new Set(s); if (valor) n.delete(item.id); else n.add(item.id); return n })
      toast.error(r.error)
      return
    }
    if (valor) {
      toast.success(`${item.doc ?? 'Item'} marcado como emitido fora do Flow.`, {
        action: { label: 'Desfazer', onClick: () => { void marcarFora(item, false) } },
      })
    }
    router.refresh()
  }

  const visiveis = useMemo(() => itens.filter(i => !fora.has(i.id)), [itens, fora])
  const { doMes, atrasados } = useMemo(() => {
    const doMes: ItemNota[] = [], atrasados: ItemNota[] = []
    for (const i of visiveis) (i.competencia.slice(0, 7) === mesCorrente ? doMes : atrasados).push(i)
    return { doMes, atrasados }
  }, [visiveis, mesCorrente])

  const emitida = (id: string) => notas[id]?.status === 'autorizada'
  const pendentes = visiveis.filter(i => !emitida(i.id))
  const total = pendentes.reduce((s, i) => s + i.valor, 0)

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">NF do mês</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          O que precisa de nota fiscal na competência de <strong className="font-medium text-gray-700">{mesLegivel(mesCorrente)}</strong>.
          Parcela de mês futuro não aparece: a nota dela ainda não é devida.
        </p>
      </div>

      {visiveis.length === 0 ? (
        <Vazio />
      ) : (
        <div className="space-y-8">
          <Bloco
            orgSlug={orgSlug}
            titulo={`Competência de ${mesLegivel(mesCorrente)}`}
            resumo={pendentes.length > 0
              ? <>A emitir: <strong className="text-emerald-600 tabular-nums">{formatBRL(total)}</strong> <span className="text-gray-400">· {pendentes.length} nota(s)</span></>
              : <span className="inline-flex items-center gap-1 text-emerald-600"><Check className="w-3.5 h-3.5" /> tudo emitido</span>}
            itens={doMes} notas={notas} carregando={carregando}
            onEmitida={registrar} onFora={i => marcarFora(i, true)}
          />
          {atrasados.length > 0 && (
            <Bloco
              orgSlug={orgSlug}
              titulo="De meses anteriores"
              aviso="Competência passada sem nota. Se ela saiu pelo emissor web, marque como emitida fora do Flow."
              itens={atrasados} notas={notas} carregando={carregando}
              onEmitida={registrar} onFora={i => marcarFora(i, true)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function Vazio() {
  return (
    <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
      <Check className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
      <h3 className="text-gray-900 font-medium">Nenhuma nota a emitir</h3>
      <p className="text-gray-500 text-sm mt-1 max-w-md mx-auto">
        Tudo que tem competência até este mês já está com nota — emitida aqui, anexada ou marcada como emitida fora.
        As parcelas dos próximos meses aparecem quando chegar a competência delas.
      </p>
    </div>
  )
}

function Bloco({ orgSlug, titulo, resumo, aviso, itens, notas, carregando, onEmitida, onFora }: {
  orgSlug: string; titulo: string; resumo?: React.ReactNode; aviso?: string; itens: ItemNota[]
  notas: Record<string, NotaDoLancamento>; carregando: boolean
  onEmitida: (id: string, n: NotaDoLancamento) => void
  onFora: (i: ItemNota) => void
}) {
  const grupos = useMemo(() => {
    const m = new Map<string, ItemNota[]>()
    for (const i of itens) m.set(i.cliente, [...(m.get(i.cliente) ?? []), i])
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
  }, [itens])

  if (itens.length === 0) return null

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-3">
        <h2 className="text-sm font-semibold text-gray-800">
          {titulo} <span className="text-gray-400 font-normal">({itens.length})</span>
        </h2>
        {resumo && <span className="text-sm text-gray-500">{resumo}</span>}
      </div>
      {aviso && <p className="text-xs text-amber-700 -mt-1 mb-3">{aviso}</p>}

      <div className="space-y-4">
        {grupos.map(([cliente, linhas]) => (
          <div key={cliente} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50/50">
              <span className="text-sm font-medium text-gray-900 truncate">{cliente}</span>
              <span className="text-xs text-gray-500 tabular-nums shrink-0">
                {linhas.length} {linhas.length === 1 ? 'item' : 'itens'} · {formatBRL(linhas.reduce((s, l) => s + l.valor, 0))}
              </span>
            </div>
            <ul className="divide-y divide-gray-100">
              {linhas.map(l => (
                <Linha key={l.id} orgSlug={orgSlug} item={l} nota={notas[l.id]} carregando={carregando}
                  onEmitida={n => onEmitida(l.id, n)} onFora={() => onFora(l)} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Uma emissão. Em grade, não tabela: no celular as colunas viram duas linhas
 * em vez de rolar de lado, que é o que uma tabela de 5 colunas faria.
 */
function Linha({ orgSlug, item: l, nota, carregando, onEmitida, onFora }: {
  orgSlug: string; item: ItemNota; nota?: NotaDoLancamento; carregando: boolean
  onEmitida: (n: NotaDoLancamento) => void; onFora: () => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [marcando, setMarcando] = useState(false)
  const emitida = nota?.status === 'autorizada'

  return (
    <li className={cn('px-4 py-3.5 grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_7rem_8rem_11rem] items-center gap-x-4 gap-y-2 transition-colors',
      emitida ? 'bg-emerald-50/40' : 'hover:bg-gray-50/60')}>
      {/* o documento */}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          {l.doc && (
            <span className="shrink-0 text-xs font-semibold text-gray-500 tabular-nums">{l.doc}</span>
          )}
          <span className="text-sm text-gray-900 truncate" title={l.titulo}>{l.titulo}</span>
        </div>
        {(l.detalhe || l.parte) && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {[l.parte, l.detalhe].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {/* valor — no celular divide a linha com o documento */}
      <div className="text-sm font-medium text-gray-900 text-right tabular-nums sm:order-3">
        {formatBRL(l.valor)}
      </div>

      {/* competência */}
      <div className="text-xs text-gray-400 tabular-nums sm:order-2">
        <span className="sm:hidden">Competência </span>{formatDateBR(l.competencia)}
      </div>

      {/* ações */}
      <div className="flex items-center justify-end gap-1 sm:order-4">
        {carregando ? (
          <NotaCarregando />
        ) : emitida ? (
          <NotaCelula orgSlug={orgSlug} lancamentoId={l.id} nota={nota} podeEmitir onEmitida={onEmitida} />
        ) : confirmando ? (
          <span className="inline-flex items-center gap-2 text-xs">
            <span className="text-gray-500">Saiu fora do Flow?</span>
            <button
              type="button"
              disabled={marcando}
              onClick={async () => { setMarcando(true); onFora() }}
              className="font-medium text-orange-600 hover:text-orange-700 disabled:opacity-50 transition-colors">
              {marcando ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Sim'}
            </button>
            <button type="button" onClick={() => setConfirmando(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors">Não</button>
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              title="A nota foi emitida pelo emissor web ou outro caminho — tirar da lista"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 active:scale-[0.97] transition-colors">
              <CheckCheck className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Já emitida</span>
            </button>
            <NotaCelula orgSlug={orgSlug} lancamentoId={l.id} nota={nota} podeEmitir onEmitida={onEmitida} />
          </>
        )}
      </div>
    </li>
  )
}
