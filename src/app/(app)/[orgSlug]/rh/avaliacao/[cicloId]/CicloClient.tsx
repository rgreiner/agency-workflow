'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check, Play, Square, Wand2, ChevronDown, ChevronRight, Lock, BarChart3, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  sugerirMatriz, definirMatriz, mudarStatusCiclo, carregarResultado,
  type Ciclo, type SugestaoLinha,
} from '@/app/actions/rh-avaliacao'

const REL: Record<string, string> = {
  auto: 'Autoavaliação', gestor: 'Gestor', liderado: 'Liderado', par: 'Colega',
  // Balde dos grupos pequenos demais para aparecer sozinhos (ver rh_aval_resultado).
  equipe: 'Equipe',
}

/** Escolha por avaliado: quem entra na avaliação dele. */
type Escolha = Record<string, Set<string>>   // avaliado_id → set de avaliador_id
type RelMap = Record<string, string>          // `${avaliado}:${avaliador}` → relação

export function CicloClient({ orgSlug, ciclo, progresso }: {
  orgSlug: string; ciclo: Ciclo
  progresso: {
    por_avaliado: { avaliado_id: string; nome: string; cargo: string | null; convidados: number; respondidos: number }[]
    por_avaliador: { avaliador_id: string; nome: string; pendentes: number; total: number }[]
  }
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [sug, setSug] = useState<SugestaoLinha[] | null>(null)
  const [escolha, setEscolha] = useState<Escolha>({})
  const [rel, setRel] = useState<RelMap>({})
  const [aberto, setAberto] = useState<string | null>(null)
  const [verResultado, setVerResultado] = useState<{ id: string; nome: string } | null>(null)

  const carregarSugestao = useCallback(() => {
    start(async () => {
      const r = await sugerirMatriz(orgSlug, ciclo.id)
      if (r?.error) { toast.error(r.error); return }
      const linhas = r.linhas ?? []
      setSug(linhas)
      // Pré-marca tudo que o sistema sugeriu — o RH desmarca o que não quer.
      const e: Escolha = {}; const rl: RelMap = {}
      for (const l of linhas) {
        const s = new Set<string>([l.avaliado_id])
        rl[`${l.avaliado_id}:${l.avaliado_id}`] = 'auto'
        if (l.gestor) { s.add(l.gestor.id); rl[`${l.avaliado_id}:${l.gestor.id}`] = 'gestor' }
        for (const d of l.liderados) { s.add(d.id); rl[`${l.avaliado_id}:${d.id}`] = 'liderado' }
        for (const p of l.pares) { s.add(p.id); rl[`${l.avaliado_id}:${p.id}`] = 'par' }
        e[l.avaliado_id] = s
      }
      setEscolha(e); setRel(rl)
    })
  }, [orgSlug, ciclo.id])

  useEffect(() => { if (ciclo.status === 'rascunho') carregarSugestao() }, [ciclo.status, carregarSugestao])

  const alternar = (avaliado: string, avaliador: string) => setEscolha(p => {
    const s = new Set(p[avaliado] ?? [])
    if (s.has(avaliador)) s.delete(avaliador); else s.add(avaliador)
    return { ...p, [avaliado]: s }
  })

  function salvarMatriz(abrirDepois: boolean) {
    const matriz = Object.entries(escolha)
      .map(([avaliado_id, set]) => ({
        avaliado_id,
        avaliadores: [...set].map(id => ({ id, relacao: rel[`${avaliado_id}:${id}`] ?? 'par' })),
      }))
      .filter(m => m.avaliadores.length > 0)
    if (matriz.length === 0) { toast.error('Selecione ao menos um avaliador.'); return }

    start(async () => {
      const r = await definirMatriz(orgSlug, ciclo.id, matriz)
      if (r?.error) { toast.error(r.error); return }
      if (!abrirDepois) { toast.success(`Matriz salva — ${r.convites} avaliações.`); router.refresh(); return }
      const a = await mudarStatusCiclo(orgSlug, ciclo.id, 'aberto')
      if (a?.error) toast.error(a.error)
      else { toast.success('Ciclo aberto! O time já vê as pendências em Avaliação.'); router.refresh() }
    })
  }

  function encerrar() {
    start(async () => {
      const r = await mudarStatusCiclo(orgSlug, ciclo.id, 'encerrado')
      if (r?.error) toast.error(r.error)
      else { toast.success('Ciclo encerrado. Os resultados já podem ser vistos.'); router.refresh() }
    })
  }

  const totalConvites = Object.values(escolha).reduce((s, x) => s + x.size, 0)
  const respondidos = progresso.por_avaliado.reduce((s, x) => s + x.respondidos, 0)
  const convidados = progresso.por_avaliado.reduce((s, x) => s + x.convidados, 0)

  return (
    <div className="p-6 max-w-4xl">
      <Link href={`/${orgSlug}/rh/avaliacao`} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4 transition">
        <ArrowLeft className="w-4 h-4" /> Ciclos
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{ciclo.nome}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {ciclo.status === 'rascunho' && 'Monte quem avalia quem e abra o ciclo.'}
            {ciclo.status === 'aberto' && `${respondidos} de ${convidados} avaliações respondidas.`}
            {ciclo.status === 'encerrado' && 'Encerrado — resultados disponíveis.'}
          </p>
        </div>
        {ciclo.status === 'aberto' && (
          <button onClick={encerrar} disabled={pending}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition">
            <Square className="w-4 h-4" /> Encerrar ciclo
          </button>
        )}
      </div>

      {!ciclo.ident_ascendente && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 mb-5 text-[12px] text-emerald-900 flex items-start gap-2">
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Quem avalia o próprio gestor entra <b>anônimo</b> — o nome não é gravado no banco.
            Nas demais relações, você e o gestor veem quem respondeu.</span>
        </div>
      )}

      {/* ── Rascunho: montar a matriz ── */}
      {ciclo.status === 'rascunho' && (
        <>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Quem avalia quem</h2>
            <button onClick={carregarSugestao} disabled={pending}
              className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-600 transition disabled:opacity-50">
              <Wand2 className="w-3.5 h-3.5" /> Sugerir de novo
            </button>
          </div>

          {sug === null ? (
            <div className="py-10 text-center text-sm text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Montando a sugestão…
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50 mb-4">
                {sug.map(l => {
                  const sel = escolha[l.avaliado_id] ?? new Set<string>()
                  const abertoAqui = aberto === l.avaliado_id
                  const cand = [
                    ...(l.gestor ? [{ ...l.gestor, relacao: 'gestor', juntos: 0 }] : []),
                    ...l.liderados.map(d => ({ ...d, relacao: 'liderado', juntos: 0 })),
                    ...l.pares.map(p => ({ ...p, relacao: 'par' })),
                  ]
                  return (
                    <div key={l.avaliado_id}>
                      <button onClick={() => setAberto(abertoAqui ? null : l.avaliado_id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50/70 transition text-left">
                        {abertoAqui ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900">{l.nome}</div>
                          <div className="text-xs text-gray-500">{l.cargo ?? '—'}{!l.funcao && <span className="text-amber-600"> · sem função definida</span>}</div>
                        </div>
                        <span className="text-xs text-gray-500 tabular-nums">{sel.size} avaliando</span>
                      </button>
                      {abertoAqui && (
                        <div className="px-4 pb-3 pl-11 flex flex-wrap gap-1.5">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-orange-50 text-orange-800 border border-orange-200">
                            <Check className="w-3 h-3" /> Autoavaliação
                          </span>
                          {cand.map(p => {
                            const on = sel.has(p.id)
                            return (
                              <button key={p.id} onClick={() => alternar(l.avaliado_id, p.id)}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border transition ${
                                  on ? 'bg-gray-900 text-[#fff] border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                                {on && <Check className="w-3 h-3" />}
                                {p.nome.split(' ')[0]}
                                <span className={on ? 'text-gray-300' : 'text-gray-400'}>
                                  {REL[p.relacao]}{p.juntos > 0 && ` · ${p.juntos} jobs`}
                                </span>
                              </button>
                            )
                          })}
                          {cand.length === 0 && <span className="text-xs text-gray-400">Ninguém dividiu atividade com essa pessoa no período.</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center gap-2">
                <button onClick={() => salvarMatriz(true)} disabled={pending}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
                  {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Abrir ciclo
                </button>
                <button onClick={() => salvarMatriz(false)} disabled={pending}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition disabled:opacity-50">
                  Só salvar
                </button>
                <span className="text-xs text-gray-400 ml-1 tabular-nums">{totalConvites} avaliações no total</span>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Aberto/encerrado: progresso e resultados ── */}
      {ciclo.status !== 'rascunho' && (
        <div className="space-y-6">
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Por pessoa avaliada</h2>
            <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
              {progresso.por_avaliado.map(a => {
                const pronto = a.respondidos >= ciclo.min_respondentes
                return (
                  <div key={a.avaliado_id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{a.nome}</div>
                      <div className="text-xs text-gray-500">{a.cargo ?? '—'}</div>
                    </div>
                    <span className={`text-xs tabular-nums ${pronto ? 'text-gray-500' : 'text-amber-600'}`}>
                      {a.respondidos}/{a.convidados} responderam
                    </span>
                    {ciclo.status === 'encerrado' && (
                      <button onClick={() => setVerResultado({ id: a.avaliado_id, nome: a.nome })}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition">
                        <BarChart3 className="w-3.5 h-3.5" /> Resultado
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {ciclo.status === 'aberto' && (
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Quem ainda deve responder</h2>
              <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
                {progresso.por_avaliador.filter(a => a.pendentes > 0).map(a => (
                  <div key={a.avaliador_id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex-1 text-sm text-gray-800">{a.nome}</span>
                    <span className="text-xs text-amber-600 tabular-nums">{a.pendentes} pendente{a.pendentes > 1 ? 's' : ''}</span>
                  </div>
                ))}
                {progresso.por_avaliador.every(a => a.pendentes === 0) && (
                  <p className="px-4 py-3 text-sm text-emerald-700">Todo mundo respondeu. Pode encerrar o ciclo.</p>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {verResultado && (
        <ResultadoModal cicloId={ciclo.id} avaliado={verResultado} onClose={() => setVerResultado(null)} />
      )}
    </div>
  )
}

interface ResultadoComp {
  competencia: string; bloco: string; descricao: string | null
  grupos: Record<string, { media: number; n: number }>
  geral: number | null
}

function ResultadoModal({ cicloId, avaliado, onClose }: {
  cicloId: string; avaliado: { id: string; nome: string }; onClose: () => void
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [r, setR] = useState<any>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [down, setDown] = useState(false)

  useEffect(() => {
    carregarResultado(cicloId, avaliado.id).then(x => {
      if ('error' in x) setErro(x.error as string); else setR(x.r)
    })
  }, [cicloId, avaliado.id])

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onMouseDown={() => setDown(true)}
      onClick={e => { if (down && e.target === e.currentTarget) onClose(); setDown(false) }}>
      <div className="modal-card w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{avaliado.nome}</h2>
            {r && <p className="text-xs text-gray-500 mt-0.5">{r.respondentes} de {r.convidados} responderam</p>}
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5">
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          {!r && !erro && <p className="text-sm text-gray-400 text-center py-6"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></p>}
          {r && <ResultadoCorpo r={r} />}
        </div>
      </div>
    </div>
  )
}

/** Corpo do resultado — reusado na tela do próprio avaliado. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ResultadoCorpo({ r }: { r: any }) {
  const comps = (r.competencias ?? []) as ResultadoComp[]
  const coments = (r.comentarios ?? []) as { relacao: string; texto: string; competencia: string | null; por: string | null }[]

  if (comps.length === 0) {
    return <p className="text-sm text-gray-500">Ainda não há resposta suficiente para mostrar resultado.</p>
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {comps.map((c, i) => (
          <div key={i} className="rounded-xl border border-gray-200 p-3.5">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <div>
                <div className="text-sm font-medium text-gray-900">{c.competencia}</div>
                {c.descricao && <div className="text-[11px] text-gray-500 mt-0.5">{c.descricao}</div>}
              </div>
              <div className="text-lg font-semibold tabular-nums text-gray-900 shrink-0">
                {c.geral?.toFixed(1) ?? '—'}<span className="text-xs text-gray-400 font-normal">/4</span>
              </div>
            </div>
            {/* Barra por grupo: autoavaliação vs. como os outros veem — a distância
                entre as duas é o que gera a conversa de desenvolvimento. */}
            <div className="space-y-1">
              {Object.entries(c.grupos).map(([g, v]) => (
                <div key={g} className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500 w-24 shrink-0">{REL[g] ?? g}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${g === 'auto' ? 'bg-sky-400' : 'bg-orange-500'}`}
                      style={{ width: `${(v.media / 4) * 100}%` }} />
                  </div>
                  <span className="text-[11px] text-gray-600 tabular-nums w-14 text-right">
                    {v.media.toFixed(1)} <span className="text-gray-400">n={v.n}</span>
                  </span>
                </div>
              ))}
              {Object.keys(c.grupos).length === 0 && (
                <p className="text-[11px] text-gray-400">Nenhum grupo atingiu o mínimo de {r.min_respondentes} respondentes.</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {coments.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Comentários</h3>
          <div className="space-y-2">
            {coments.map((c, i) => (
              <div key={i} className="rounded-xl bg-gray-50 px-3.5 py-2.5">
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.texto}</p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {c.competencia && <span>{c.competencia} · </span>}
                  {REL[c.relacao] ?? c.relacao}{c.por && ` · ${c.por}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
