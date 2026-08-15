'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRight, Check, Archive, Loader2, Repeat } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import {
  carregarMigracao, migrarRotina, arquivarOrigem, type CandidataMigracao,
} from '@/app/actions/midia-hub'

const FREQ: Record<string, string> = {
  weekly: 'semanal', biweekly: 'quinzenal', monthly: 'mensal',
  bimonthly: 'bimestral', quarterly: 'trimestral', semiannual: 'semestral', annual: 'anual',
}
const fmt = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—')

interface Escolha { clienteId: string; rotinaId: string; marcada: boolean }

export function MigrarRotinas({ orgSlug, origens }: {
  orgSlug: string
  origens: { id: string; nome: string; total: number }[]
}) {
  const [origem, setOrigem] = useState(origens[0]?.id ?? '')
  const [dados, setDados] = useState<{
    candidatas: CandidataMigracao[]
    clientes: { id: string; nome: string }[]
    rotinas: { id: string; nome: string; descricao: string | null }[]
  } | null>(null)
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({})
  const [carregando, setCarregando] = useState(false)
  const [pending, start] = useTransition()

  // O setState inicial fica DENTRO do then, não no corpo do efeito: o lint da
  // casa barra setState síncrono em effect (cascata de render).
  useEffect(() => {
    if (!origem) return
    let vivo = true
    const buscar = async () => {
      setCarregando(true)
      const r = await carregarMigracao(orgSlug, origem)
      if (!vivo) return
      setCarregando(false)
      if ('error' in r && r.error) { toast.error(r.error); return }
      setDados({ candidatas: r.candidatas ?? [], clientes: r.clientes ?? [], rotinas: r.rotinas ?? [] })
      // Sugestão fraca nasce DESMARCADA: é onde o erro aconteceria em silêncio.
      const inicial: Record<string, Escolha> = {}
      for (const c of r.candidatas ?? []) {
        inicial[c.id] = {
          clienteId: c.clienteSugerido ?? '',
          rotinaId: c.rotinaSugerida ?? '',
          marcada: !!c.clienteSugerido && !!c.rotinaSugerida && !c.sugestaoFraca && !c.migradaPara,
        }
      }
      setEscolhas(inicial)
    }
    void buscar()
    return () => { vivo = false }
  }, [orgSlug, origem])

  function set(id: string, patch: Partial<Escolha>) {
    setEscolhas(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  const pendentes = (dados?.candidatas ?? []).filter(c => !c.migradaPara)
  const migradas = (dados?.candidatas ?? []).filter(c => c.migradaPara)
  const prontas = pendentes.filter(c => {
    const e = escolhas[c.id]
    return e?.marcada && e.clienteId && e.rotinaId
  })

  function migrarSelecionadas() {
    start(async () => {
      let ok = 0
      const erros: string[] = []
      for (const c of prontas) {
        const e = escolhas[c.id]
        const r = await migrarRotina(orgSlug, c.id, e.clienteId, e.rotinaId)
        if ('error' in r && r.error) erros.push(`${c.titulo}: ${r.error}`)
        else ok++
      }
      if (ok) toast.success(`${ok} rotina${ok > 1 ? 's' : ''} copiada${ok > 1 ? 's' : ''} para o cliente.`)
      for (const msg of erros.slice(0, 3)) toast.error(msg)
      const r2 = await carregarMigracao(orgSlug, origem)
      if (!('error' in r2)) setDados({ candidatas: r2.candidatas ?? [], clientes: r2.clientes ?? [], rotinas: r2.rotinas ?? [] })
    })
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Migrar rotinas</h1>
        <p className="text-gray-500 text-sm mt-0.5 max-w-3xl">
          Copia as tarefas recorrentes que hoje moram num cliente-balde para o cliente real, preservando
          prazo, recorrência e responsáveis. <b>A tarefa original não é tocada</b> — some do balde só
          quando você mandar, depois de conferir.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-72">
          <Select value={origem} onChange={setOrigem}
            options={origens.map(o => ({ value: o.id, label: `${o.nome} · ${o.total} recorrente${o.total > 1 ? 's' : ''}` }))}
            placeholder="De onde migrar" />
        </div>
        {prontas.length > 0 && (
          <button onClick={migrarSelecionadas} disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors disabled:opacity-60">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            Migrar {prontas.length} selecionada{prontas.length > 1 ? 's' : ''}
          </button>
        )}
      </div>

      {carregando && <p className="text-sm text-gray-400 py-10 text-center">Carregando…</p>}

      {dados && pendentes.length > 0 && (
        <ul className="space-y-2">
          {pendentes.map(c => {
            const e = escolhas[c.id] ?? { clienteId: '', rotinaId: '', marcada: false }
            const incompleta = !e.clienteId || !e.rotinaId
            return (
              <li key={c.id} className={cn('bg-white border rounded-xl p-4',
                c.sugestaoFraca ? 'border-amber-200' : 'border-gray-200')}>
                <div className="flex items-start gap-3 flex-wrap">
                  <button onClick={() => set(c.id, { marcada: !e.marcada })} disabled={incompleta}
                    className={cn('w-5 h-5 mt-0.5 rounded-md border flex items-center justify-center shrink-0 transition-colors',
                      e.marcada ? 'bg-orange-600 border-orange-600' : 'border-gray-300',
                      incompleta && 'opacity-40 cursor-not-allowed')}>
                    {e.marcada && <Check className="w-3.5 h-3.5 text-[#fff]" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{c.titulo}</p>
                    <p className="text-[11px] text-gray-400 inline-flex items-center gap-2 flex-wrap mt-0.5">
                      <span className="inline-flex items-center gap-1">
                        <Repeat className="w-3 h-3" /> {FREQ[c.recorrencia ?? ''] ?? c.recorrencia}
                      </span>
                      <span>prazo {fmt(c.prazo)}</span>
                      {c.responsaveis.length > 0 && <span>· {c.responsaveis.join(', ')}</span>}
                      <span className="text-gray-300">· {c.campanha}</span>
                    </p>

                    {c.sugestaoFraca && (
                      <p className="text-[11px] text-amber-700 mt-1.5 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        Não achei rotina parecida — confira antes de marcar.
                      </p>
                    )}

                    <div className="grid sm:grid-cols-2 gap-2 mt-2.5">
                      <label className="block">
                        <span className="text-[11px] text-gray-400">Cliente</span>
                        <div className="mt-0.5">
                          <Select size="sm" value={e.clienteId} onChange={v => set(c.id, { clienteId: v })}
                            options={(dados.clientes ?? []).map(cl => ({ value: cl.id, label: cl.nome }))}
                            placeholder="Escolha o cliente" />
                        </div>
                      </label>
                      <label className="block">
                        <span className="text-[11px] text-gray-400">Rotina do catálogo</span>
                        <div className="mt-0.5">
                          <Select size="sm" value={e.rotinaId} onChange={v => set(c.id, { rotinaId: v })}
                            options={(dados.rotinas ?? []).map(r => ({ value: r.id, label: r.nome }))}
                            placeholder="Escolha a rotina" />
                        </div>
                      </label>
                    </div>
                    {!e.rotinaId && (
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        Falta a rotina certa?{' '}
                        <Link href={`/${orgSlug}/midia/rotinas`} className="text-orange-600 hover:text-orange-700">
                          crie no catálogo
                        </Link>{' '}e volte aqui.
                      </p>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {dados && pendentes.length === 0 && !carregando && (
        <p className="text-sm text-gray-400 text-center py-12 bg-white border border-gray-200 rounded-xl">
          Nada para migrar aqui.
        </p>
      )}

      {migradas.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Já migradas <span className="text-gray-300 font-normal">· {migradas.length}</span>
          </h2>
          <ul className="space-y-1.5">
            {migradas.map(c => <LinhaMigrada key={c.id} orgSlug={orgSlug} c={c} />)}
          </ul>
        </section>
      )}
    </div>
  )
}

function LinhaMigrada({ orgSlug, c }: { orgSlug: string; c: CandidataMigracao }) {
  const [pending, start] = useTransition()
  const [arquivada, setArquivada] = useState(false)
  function arquivar() {
    start(async () => {
      const r = await arquivarOrigem(orgSlug, c.id)
      if (r?.error) toast.error(r.error)
      else { setArquivada(true); toast.success('Tarefa antiga arquivada.') }
    })
  }
  return (
    <li className="bg-white border border-gray-100 rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
      <Check className="w-4 h-4 text-emerald-600 shrink-0" />
      <span className={cn('text-sm min-w-0 flex-1 truncate', arquivada ? 'text-gray-400 line-through' : 'text-gray-600')}>
        {c.titulo}
      </span>
      {arquivada ? (
        <span className="text-[11px] text-gray-400 shrink-0">arquivada no balde</span>
      ) : (
        <button onClick={arquivar} disabled={pending}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors shrink-0 disabled:opacity-60">
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Archive className="w-3 h-3" />}
          Arquivar a antiga
        </button>
      )}
    </li>
  )
}
