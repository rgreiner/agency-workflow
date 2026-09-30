'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  NotebookPen, Sparkles, Loader2, Plus, X, Trash2, Globe, ChevronDown, ExternalLink, ListPlus, Link2, Unlink, Search, Check, Undo2, Calculator,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  salvarReuniao, excluirReuniao, organizarReuniao, buscarTarefasCliente, buscarOrcamentosCliente, ajustarPasso,
} from '@/app/actions/reunioes'
import {
  passoResolvido,
  type Reuniao, type PassoReuniao, type ResponsavelPasso, type TarefaVinculavel, type OrcamentoVinculavel, type LinkPasso,
} from '@/lib/reunioes'
import { useStatusConfig } from '@/components/ui/StatusBadge'

export type TarefaDoPasso = LinkPasso

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const inputCls = 'w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:opacity-70'

const passoVazio = (responsavel: ResponsavelPasso = 'agencia'): PassoReuniao =>
  ({ id: null, texto: '', responsavel, rascunho: '', activityId: null, producaoId: null, feito: false })

/**
 * Editor da ata (mig. 306). Colar notas → "Organizar com IA" propõe resumo e
 * passos (não grava) → a pessoa revisa e salva. "Criar tarefa" salva antes e
 * abre a Nova atividade com o rascunho do passo (?passo=<id>), que o form
 * organiza no padrão da casa.
 */
export function ReuniaoEditor({
  orgSlug, workspaceId, clienteNome, inicial, campanhas, tarefas, orcamentos, podeEditar,
}: {
  orgSlug: string
  workspaceId: string
  clienteNome: string
  inicial: Reuniao
  campanhas: { id: string; name: string }[]
  /** passoId → tarefa criada a partir dele. */
  tarefas: Record<string, LinkPasso>
  /** passoId → orçamento ligado a ele (mig. 307). */
  orcamentos: Record<string, LinkPasso>
  podeEditar: boolean
}) {
  const router = useRouter()
  const [ata, setAta] = useState<Reuniao>(inicial)
  const [salvo, setSalvo] = useState(() => JSON.stringify(inicial))
  const sujo = JSON.stringify(ata) !== salvo
  const [salvando, startSalvar] = useTransition()
  const [organizando, setOrganizando] = useState(false)
  const [abertos, setAbertos] = useState<Set<number>>(new Set())
  const [confirmPublicar, setConfirmPublicar] = useState(false)
  const [confirmExcluir, setConfirmExcluir] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  // Passo à espera de uma campanha pra virar tarefa (ata sem campanha).
  const [pedeCampanha, setPedeCampanha] = useState<number | null>(null)
  const [campanhaEscolhida, setCampanhaEscolhida] = useState('')
  // Vincular a uma tarefa ou orçamento que já existe (em vez de criar outra tarefa).
  const [vinculando, setVinculando] = useState<{ i: number; aba: 'tarefa' | 'orcamento' } | null>(null)
  const [busca, setBusca] = useState('')
  const [achadas, setAchadas] = useState<TarefaVinculavel[]>([])
  const [achados, setAchados] = useState<OrcamentoVinculavel[]>([])
  const [buscando, setBuscando] = useState(false)
  // Links feitos nesta tela, até o refresh trazer tarefas/orçamentos novos do servidor.
  const [linksLocais, setLinksLocais] = useState<Record<string, { tarefa?: LinkPasso; orcamento?: LinkPasso }>>({})
  const statusCfg = useStatusConfig()

  const base = `/${orgSlug}/workspaces/${workspaceId}/reunioes`
  const lista = `/${orgSlug}/reunioes?ws=${workspaceId}`
  const opcoesCampanha = useMemo(
    () => [{ value: '', label: 'Sem campanha' }, ...campanhas.map(c => ({ value: c.id, label: c.name }))],
    [campanhas],
  )

  const set = <K extends keyof Reuniao>(k: K, v: Reuniao[K]) => setAta(a => ({ ...a, [k]: v }))
  const setPasso = (i: number, patch: Partial<PassoReuniao>) =>
    setAta(a => ({ ...a, passos: a.passos.map((p, j) => (j === i ? { ...p, ...patch } : p)) }))

  /** Grava e devolve a ata com os ids que o banco deu (passos novos incluídos). */
  async function gravar(dados: Reuniao, navegar = true): Promise<Reuniao | null> {
    const res = await salvarReuniao(orgSlug, workspaceId, dados)
    if (!res.ok) { toast.error(res.error); return null }
    const gravada: Reuniao = {
      ...dados,
      id: res.id,
      // Mesmo índice do que foi enviado (passo vazio fica sem id) — criarTarefa depende disso.
      passos: dados.passos.map((p, i) => ({ ...p, id: res.passoIds[i] || null })),
    }
    setAta(gravada)
    setSalvo(JSON.stringify(gravada))
    if (!navegar) return gravada
    if (!dados.id) router.replace(`${base}/${res.id}`)
    else router.refresh()
    return gravada
  }

  function salvar() {
    startSalvar(async () => {
      const ok = await gravar(ata)
      if (ok) toast.success('Ata salva.')
    })
  }

  function alternarPublicada(v: boolean) {
    if (v) { setConfirmPublicar(true); return }
    startSalvar(async () => {
      const ok = await gravar({ ...ata, publicada: false })
      if (ok) toast.success('A ata saiu do portal do cliente.')
    })
  }

  function publicar() {
    startSalvar(async () => {
      const ok = await gravar({ ...ata, publicada: true })
      setConfirmPublicar(false)
      if (ok) toast.success('Publicada: o cliente já vê no portal.')
    })
  }

  async function organizar() {
    if (organizando) return
    setOrganizando(true)
    const anterior = ata
    try {
      const res = await organizarReuniao(workspaceId, ata.notas, ata.transcricao)
      if (!res.ok) { toast.error(res.error, { duration: 8000 }); return }
      const { ata: ia } = res
      // Passo que já tem desfecho (tarefa, orçamento, feito) não some: a IA propõe, o vínculo fica.
      const comTarefa = ata.passos.filter(passoResolvido)
      setAta(a => ({
        ...a,
        titulo: a.titulo.trim() ? a.titulo : (ia.titulo ?? ''),
        resumo: ia.resumo || a.resumo,
        passos: [...comTarefa, ...ia.passos.map(p => ({ ...passoVazio(p.responsavel), texto: p.texto, rascunho: p.rascunho }))],
      }))
      setAbertos(new Set())
      toast.success(
        ia.passos.length ? `Ata organizada: ${ia.passos.length} próximo(s) passo(s). Revise e salve.` : 'Resumo pronto. Nenhum próximo passo encontrado.',
        { action: { label: 'Desfazer', onClick: () => setAta(anterior) } },
      )
    } finally {
      setOrganizando(false)
    }
  }

  function criarTarefa(i: number, campanhaId?: string) {
    const campaignId = campanhaId ?? ata.campaignId
    if (!campaignId) { setCampanhaEscolhida(''); setPedeCampanha(i); return }
    startSalvar(async () => {
      const salvo = await gravar({ ...ata, campaignId })
      const passo = salvo?.passos[i]
      if (!passo?.id) return
      setPedeCampanha(null)
      router.push(`/${orgSlug}/workspaces/${workspaceId}/campaigns/${campaignId}/activities/new?passo=${passo.id}`)
    })
  }

  // Busca com respiro de 250 ms; abrir o modal já lista os mais recentes do cliente.
  const abaAberta = vinculando?.aba ?? null
  useEffect(() => {
    if (!abaAberta) return
    let vivo = true
    const t = setTimeout(async () => {
      setBuscando(true)
      const res = abaAberta === 'tarefa'
        ? await buscarTarefasCliente(workspaceId, busca)
        : await buscarOrcamentosCliente(workspaceId, busca)
      if (!vivo) return
      setBuscando(false)
      if (!res.ok) { toast.error(res.error); return }
      if ('tarefas' in res) setAchadas(res.tarefas)
      else setAchados(res.orcamentos)
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [busca, abaAberta, workspaceId])

  function abrirVincular(i: number) {
    setBusca(''); setAchadas([]); setAchados([]); setVinculando({ i, aba: 'tarefa' })
  }

  type Patch = { activityId?: string | null; producaoId?: string | null; feito?: boolean }

  /** Grava o desfecho de um passo (salvando a ata antes, se preciso) e reflete na tela. */
  function ajustar(i: number, patch: Patch, links: { tarefa?: LinkPasso | null; orcamento?: LinkPasso | null } = {}, aviso = '') {
    startSalvar(async () => {
      // Passo novo ou editado precisa existir no banco antes do vínculo.
      const base = sujo || !ata.id || !ata.passos[i]?.id ? await gravar(ata, false) : ata
      const passo = base?.passos[i]
      if (!base?.id || !passo?.id) return
      const res = await ajustarPasso(orgSlug, workspaceId, base.id, passo.id, patch)
      if (!res.ok) { toast.error(res.error); return }
      const pid = passo.id
      setLinksLocais(v => {
        const atual = { ...(v[pid] ?? {}) }
        if (links.tarefa !== undefined) atual.tarefa = links.tarefa ?? undefined
        if (links.orcamento !== undefined) atual.orcamento = links.orcamento ?? undefined
        return { ...v, [pid]: atual }
      })
      const mudar = (lista: PassoReuniao[]) => lista.map((p, j) => (j === i ? { ...p, ...patch } : p))
      setAta(a => ({ ...a, passos: mudar(a.passos) }))
      setSalvo(JSON.stringify({ ...base, passos: mudar(base.passos) }))
      setVinculando(null)
      if (aviso) toast.success(aviso)
      // Ata nova ganhou id agora: a URL passa a ser a dela.
      if (!ata.id) router.replace(`/${orgSlug}/workspaces/${workspaceId}/reunioes/${base.id}`)
      else router.refresh()
    })
  }

  const vincularTarefa = (t: TarefaVinculavel) => vinculando && ajustar(vinculando.i, { activityId: t.id }, {
    tarefa: { titulo: t.titulo, href: `/${orgSlug}/workspaces/${workspaceId}/campaigns/${t.campaignId}/activities/${t.id}` },
  }, 'Passo vinculado à tarefa.')
  const vincularOrcamento = (o: OrcamentoVinculavel) => vinculando && ajustar(vinculando.i, { producaoId: o.id }, {
    orcamento: { titulo: `${o.numero} · ${o.titulo}`, href: `/${orgSlug}/producao/orcamento/${o.id}` },
  }, 'Passo vinculado ao orçamento.')

  async function excluir() {
    if (!ata.id) return
    setExcluindo(true)
    const res = await excluirReuniao(orgSlug, workspaceId, ata.id)
    setExcluindo(false)
    if (!res.ok) { toast.error(res.error); return }
    toast.success('Ata excluída.')
    router.replace(lista)
  }

  const temTexto = !!(ata.notas.trim() || ata.transcricao.trim())
  const ro = !podeEditar

  return (
    <div className="p-6 max-w-4xl pb-28">
      <div className="mb-1 text-xs text-gray-400">
        <Link href={`/${orgSlug}/workspaces`} className="hover:text-gray-600 transition-colors">Clientes</Link>
        {' / '}
        <Link href={`/${orgSlug}/workspaces/${workspaceId}`} className="hover:text-gray-600 transition-colors">{clienteNome}</Link>
        {' / '}
        <Link href={lista} className="hover:text-gray-600 transition-colors">Reuniões</Link>
      </div>

      <div className="flex items-start gap-3 mb-5">
        <NotebookPen className="w-5 h-5 text-orange-600 mt-2.5 shrink-0" />
        <input
          value={ata.titulo}
          onChange={e => set('titulo', e.target.value)}
          disabled={ro}
          placeholder="Assunto da reunião"
          className="flex-1 min-w-0 bg-transparent text-lg font-semibold text-gray-900 placeholder-gray-300 px-2 py-1.5 -mx-2 rounded-lg focus:outline-none focus:bg-gray-100 disabled:opacity-100"
        />
        {ata.id && podeEditar && (
          <button type="button" onClick={() => setConfirmExcluir(true)} title="Excluir ata"
            className="press p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr_1fr] gap-3 mb-6">
        <label className="block">
          <span className="block text-xs font-medium text-gray-500 mb-1">Data</span>
          <input type="date" value={ata.realizadaEm} disabled={ro}
            onChange={e => set('realizadaEm', e.target.value)} className={inputCls} />
        </label>
        <div>
          <span className="block text-xs font-medium text-gray-500 mb-1">Campanha</span>
          {ro
            ? <p className={cn(inputCls, 'truncate')}>{campanhas.find(c => c.id === ata.campaignId)?.name ?? 'Sem campanha'}</p>
            : <Select value={ata.campaignId ?? ''} onChange={v => set('campaignId', v || null)} options={opcoesCampanha} className="w-full" />}
        </div>
        <label className="block">
          {/* Só quem veio do cliente: da agência vai sempre o Rafael (29/09/2026). */}
          <span className="block text-xs font-medium text-gray-500 mb-1">Participantes do cliente</span>
          <input value={ata.participantes} disabled={ro} placeholder="Ana (marketing), Rodrigo…"
            onChange={e => set('participantes', e.target.value)} className={inputCls} />
        </label>
      </div>

      {/* ── 1. O que aconteceu: material bruto, só o time vê ── */}
      <section className="mb-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-3">
          1 · O que aconteceu <span className="normal-case tracking-normal font-normal text-gray-400">— só o time vê</span>
        </h2>
        <label className="block mb-3">
          <span className="block text-sm font-semibold text-gray-900">Notas da reunião</span>
          <span className="block text-xs text-gray-500 mb-2">Cole as notas que o Granola gerou.</span>
          <textarea value={ata.notas} disabled={ro} rows={8}
            onChange={e => set('notas', e.target.value)}
            placeholder="Resumo, decisões e combinados, do jeito que o Granola gerou"
            className={cn(inputCls, 'resize-y leading-relaxed')} />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold text-gray-900">
            Transcrição <span className="font-normal text-gray-400">(opcional{ata.transcricao.trim() ? ` · ${Math.round(ata.transcricao.length / 1000)} mil caracteres` : ''})</span>
          </span>
          <span className="block text-xs text-gray-500 mb-2">A IA usa para achar detalhes que as notas não trazem. Nunca vai para o cliente.</span>
          <textarea value={ata.transcricao} disabled={ro} rows={10}
            onChange={e => set('transcricao', e.target.value)}
            placeholder="Cole a transcrição completa"
            className={cn(inputCls, 'resize-y font-mono text-xs leading-relaxed')} />
        </label>
      </section>

      {/* A ponte entre os dois blocos: a IA lê o 1 e escreve o 2. */}
      {podeEditar && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-orange-500/40 bg-orange-500/5 px-4 py-3 mb-6">
          <p className="flex-1 min-w-[14rem] text-sm text-gray-600">
            A IA lê as notas e a transcrição e escreve o resumo e os próximos passos abaixo. Você revisa antes de salvar.
          </p>
          <button type="button" onClick={organizar} disabled={!temTexto || organizando}
            className="press inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-xl text-[#fff] bg-orange-600 hover:bg-orange-700 transition-colors disabled:opacity-50">
            {organizando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {organizando ? 'Organizando…' : 'Organizar com IA'}
          </button>
        </div>
      )}

      {/* ── 2. O resultado: o que o cliente vê quando a ata é publicada ── */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-3">
        2 · Resultado <span className="normal-case tracking-normal font-normal text-gray-400">— o cliente vê se você publicar</span>
      </h2>
      <section className="mb-6">
        <label className="block">
          <span className="block text-sm font-semibold text-gray-900">Resumo para o cliente</span>
          <span className="block text-xs text-gray-500 mb-2">
            A versão limpa das notas: contexto, decisões e pontos em aberto, sem comentário interno. É o texto que o cliente lê no portal.
          </span>
          <textarea value={ata.resumo} disabled={ro} rows={7}
            onChange={e => set('resumo', e.target.value)}
            placeholder={podeEditar ? 'Use "Organizar com IA" para escrever a partir das notas, ou escreva aqui' : ''}
            className={cn(inputCls, 'resize-y leading-relaxed')} />
        </label>
      </section>

      <section className="mb-6">
        <h3 className="text-sm font-semibold text-gray-900">Próximos passos</h3>
        <p className="text-xs text-gray-500 mb-2">Os da agência viram tarefa (ou se ligam a uma que já existe). Os do cliente aparecem para ele no portal.</p>

        <ul className="space-y-2">
          {ata.passos.map((p, i) => {
            const tarefa = p.id && p.activityId ? (linksLocais[p.id]?.tarefa ?? tarefas[p.id]) : undefined
            const orcamento = p.id && p.producaoId ? (linksLocais[p.id]?.orcamento ?? orcamentos[p.id]) : undefined
            const aberto = abertos.has(i)
            return (
              <li key={p.id ?? `novo-${i}`} className="rounded-2xl bg-white border border-gray-200 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="inline-flex shrink-0 rounded-lg bg-gray-100 p-0.5 text-xs">
                    {(['agencia', 'cliente'] as const).map(r => (
                      <button key={r} type="button" disabled={ro || passoResolvido(p)}
                        onClick={() => setPasso(i, { responsavel: r })}
                        className={cn('px-2 py-1 rounded-md font-medium transition-colors',
                          p.responsavel === r ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                        {r === 'agencia' ? 'Agência' : 'Cliente'}
                      </button>
                    ))}
                  </div>
                  <input value={p.texto} disabled={ro} onChange={e => setPasso(i, { texto: e.target.value })}
                    placeholder="O que foi combinado"
                    className={cn('flex-1 min-w-0 bg-transparent text-sm placeholder-gray-400 px-2 py-1.5 rounded-lg focus:outline-none focus:bg-gray-100 disabled:opacity-100',
                      p.feito ? 'text-gray-400 line-through' : 'text-gray-900')} />
                  {/* Desfechos: tarefa, orçamento, feito — cada um com o seu "desfazer". */}
                  {(p.activityId || p.producaoId || p.feito) && (
                    <span className="shrink-0 inline-flex items-center gap-1">
                      {p.activityId && (
                        <span className="inline-flex items-center rounded-lg bg-green-500/15 text-green-600">
                          {tarefa ? (
                            <Link href={tarefa.href} title={tarefa.titulo}
                              className="inline-flex items-center gap-1 text-xs font-medium pl-2 pr-1.5 py-1 rounded-lg hover:bg-green-500/15 transition-colors">
                              Tarefa <ExternalLink className="w-3 h-3" />
                            </Link>
                          ) : <span className="text-xs font-medium px-2 py-1">Tarefa</span>}
                          {podeEditar && (
                            <button type="button" disabled={salvando} title="Desvincular (a tarefa continua existindo)"
                              onClick={() => ajustar(i, { activityId: null }, { tarefa: null }, 'Vínculo desfeito. A tarefa continua existindo.')}
                              className="p-1 mr-0.5 rounded-md text-green-600/70 hover:text-red-600 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                              <Unlink className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      )}
                      {p.producaoId && (
                        <span className="inline-flex items-center rounded-lg bg-blue-500/15 text-blue-500">
                          {orcamento ? (
                            <Link href={orcamento.href} title={orcamento.titulo}
                              className="inline-flex items-center gap-1 text-xs font-medium pl-2 pr-1.5 py-1 rounded-lg hover:bg-blue-500/15 transition-colors">
                              <Calculator className="w-3 h-3" /> Orçamento <ExternalLink className="w-3 h-3" />
                            </Link>
                          ) : <span className="text-xs font-medium px-2 py-1">Orçamento</span>}
                          {podeEditar && (
                            <button type="button" disabled={salvando} title="Desvincular (o orçamento continua existindo)"
                              onClick={() => ajustar(i, { producaoId: null }, { orcamento: null }, 'Vínculo desfeito. O orçamento continua existindo.')}
                              className="p-1 mr-0.5 rounded-md text-blue-500/70 hover:text-red-600 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                              <Unlink className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      )}
                      {p.feito && (
                        <span className="inline-flex items-center rounded-lg bg-gray-100 text-gray-600">
                          <span className="inline-flex items-center gap-1 text-xs font-medium pl-2 pr-1.5 py-1"><Check className="w-3 h-3" /> Feito</span>
                          {podeEditar && (
                            <button type="button" disabled={salvando} title="Reabrir o passo"
                              onClick={() => ajustar(i, { feito: false }, {}, 'Passo reaberto.')}
                              className="p-1 mr-0.5 rounded-md text-gray-400 hover:text-gray-800 hover:bg-gray-200 transition-colors disabled:opacity-50">
                              <Undo2 className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      )}
                    </span>
                  )}
                  {podeEditar && !passoResolvido(p) && (
                    <span className="shrink-0 inline-flex items-center gap-1">
                      <button type="button" onClick={() => ajustar(i, { feito: true }, {}, 'Marcado como feito.')}
                        disabled={salvando || !p.texto.trim()}
                        title="Consulta ou combinado resolvido, sem virar trabalho de pauta"
                        className="press inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                        <Check className="w-3.5 h-3.5" /> Feito
                      </button>
                      {p.responsavel === 'agencia' && (<>
                        <button type="button" onClick={() => abrirVincular(i)} disabled={salvando || !p.texto.trim()}
                          title="Já existe uma tarefa ou um orçamento para isso? Vincule em vez de criar outro"
                          className="press inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                          <Link2 className="w-3.5 h-3.5" /> Vincular
                        </button>
                        <button type="button" onClick={() => criarTarefa(i)} disabled={salvando || !p.texto.trim()}
                          className="press inline-flex items-center gap-1 text-xs font-medium text-[#fff] bg-orange-600 hover:bg-orange-700 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                          <ListPlus className="w-3.5 h-3.5" /> Criar tarefa
                        </button>
                      </>)}
                    </span>
                  )}
                  {p.responsavel === 'agencia' && (
                    <button type="button" title={aberto ? 'Esconder o rascunho do briefing' : 'Ver o rascunho do briefing'}
                      onClick={() => setAbertos(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })}
                      className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                      <ChevronDown className={cn('w-4 h-4 transition-transform', aberto && 'rotate-180')} />
                    </button>
                  )}
                  {podeEditar && !passoResolvido(p) && (
                    <button type="button" title="Remover passo"
                      onClick={() => setAta(a => ({ ...a, passos: a.passos.filter((_, j) => j !== i) }))}
                      className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {p.responsavel === 'agencia' && aberto && (
                  <textarea value={p.rascunho} disabled={ro || passoResolvido(p)} rows={5}
                    onChange={e => setPasso(i, { rascunho: e.target.value })}
                    placeholder="Tudo o que a reunião disse sobre este trabalho. Vai para o briefing da tarefa."
                    className={cn(inputCls, 'mt-2 resize-y leading-relaxed')} />
                )}
              </li>
            )
          })}
        </ul>
        {podeEditar && (
          <button type="button" onClick={() => setAta(a => ({ ...a, passos: [...a.passos, passoVazio()] }))}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <Plus className="w-4 h-4" /> Adicionar passo
          </button>
        )}
      </section>

      {/* ── Barra de ações ── */}
      {podeEditar && (
        <div className="sticky bottom-[calc(var(--barra-inferior,0px)+1rem)] z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/95 backdrop-blur border border-gray-200 shadow-lg px-4 py-3">
          <label className="flex items-center gap-2.5 text-sm text-gray-700">
            <Switch checked={ata.publicada} onChange={alternarPublicada} disabled={salvando || !ata.resumo.trim()}
              label="Mostrar no portal do cliente" />
            <span className="inline-flex items-center gap-1.5">
              <Globe className={cn('w-4 h-4', ata.publicada ? 'text-green-600' : 'text-gray-400')} />
              {ata.publicada ? 'No portal do cliente' : 'Só o time vê'}
            </span>
          </label>
          <button type="button" onClick={salvar} disabled={salvando || (!sujo && !!ata.id)}
            className="press inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl text-[#fff] bg-orange-600 hover:bg-orange-700 transition-colors disabled:opacity-50">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
            {ata.id ? (sujo ? 'Salvar alterações' : 'Salvo') : 'Salvar ata'}
          </button>
        </div>
      )}

      <Modal open={confirmPublicar} onClose={() => setConfirmPublicar(false)} size="sm" label="Publicar no portal" dismissable={!salvando}>
        <ModalHeader title="Publicar no portal do cliente?" onClose={() => setConfirmPublicar(false)} />
        <div className="px-6 py-4 text-sm text-gray-600 leading-relaxed space-y-2">
          <p>{clienteNome} vai ver o título, a data, os participantes, o resumo e os próximos passos.</p>
          <p>As notas, a transcrição e o rascunho dos briefings continuam só com o time.</p>
        </div>
        <div className="flex justify-end gap-2 px-6 pb-5">
          <button type="button" onClick={() => setConfirmPublicar(false)} disabled={salvando}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
          <button type="button" onClick={publicar} disabled={salvando}
            className="press inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#fff] bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors disabled:opacity-60">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Publicar
          </button>
        </div>
      </Modal>

      <Modal open={pedeCampanha !== null} onClose={() => setPedeCampanha(null)} size="sm" label="Escolher campanha" dismissable={!salvando}>
        <ModalHeader title="Em qual campanha?" onClose={() => setPedeCampanha(null)} />
        <div className="px-6 py-4 space-y-2">
          <p className="text-sm text-gray-600">Toda tarefa mora numa campanha. A escolha vale para a ata inteira.</p>
          <Select value={campanhaEscolhida} onChange={setCampanhaEscolhida}
            options={campanhas.map(c => ({ value: c.id, label: c.name }))} placeholder="Escolher campanha" className="w-full" />
          {campanhas.length === 0 && <p className="text-xs text-amber-700">Este cliente não tem campanha ativa. Crie uma antes.</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 pb-5">
          <button type="button" onClick={() => setPedeCampanha(null)} disabled={salvando}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
          <button type="button" disabled={!campanhaEscolhida || salvando}
            onClick={() => pedeCampanha !== null && criarTarefa(pedeCampanha, campanhaEscolhida)}
            className="press inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[#fff] bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors disabled:opacity-60">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Criar tarefa
          </button>
        </div>
      </Modal>

      <Modal open={vinculando !== null} onClose={() => setVinculando(null)} size="lg" label="Vincular" dismissable={!salvando}>
        <ModalHeader title="Vincular a algo que já existe" onClose={() => setVinculando(null)} />
        <div className="px-6 pt-4 pb-2">
          {vinculando !== null && (
            <p className="text-xs text-gray-500 mb-3 truncate">Passo: <span className="text-gray-700">{ata.passos[vinculando.i]?.texto}</span></p>
          )}
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-sm mb-3">
            {(['tarefa', 'orcamento'] as const).map(aba => (
              <button key={aba} type="button"
                onClick={() => { if (vinculando) { setBusca(''); setVinculando({ ...vinculando, aba }) } }}
                className={cn('px-3 py-1.5 rounded-md font-medium transition-colors',
                  abaAberta === aba ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                {aba === 'tarefa' ? 'Tarefa' : 'Orçamento'}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input autoFocus value={busca} onChange={e => setBusca(e.target.value)}
              placeholder={abaAberta === 'orcamento' ? `Buscar orçamento de ${clienteNome} (título ou número)` : `Buscar nas tarefas de ${clienteNome}`}
              className={cn(inputCls, 'pl-10')} />
          </div>
        </div>
        <ul className="px-3 pb-4 max-h-[50vh] overflow-y-auto">
          {(() => {
            const vazio = abaAberta === 'tarefa' ? achadas.length === 0 : achados.length === 0
            if (buscando && vazio) return <li className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Buscando…</li>
            if (!buscando && vazio) return <li className="py-8 text-center text-sm text-gray-400">Nada encontrado{busca.trim() ? ' com esse termo' : ''}.</li>
            return null
          })()}
          {abaAberta === 'tarefa' && achadas.map(t => {
            const st = statusCfg.find(x => x.value === t.status)
            return (
              <li key={t.id}>
                <button type="button" onClick={() => vincularTarefa(t)} disabled={salvando}
                  className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-gray-900 truncate">{t.titulo}</span>
                    <span className="block text-xs text-gray-500 truncate">{t.campanha}{t.arquivada ? ' · arquivada' : ''}</span>
                  </span>
                  {st && (
                    <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: st.bg, color: st.text }}>
                      {st.label}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
          {abaAberta === 'orcamento' && achados.map(o => (
            <li key={o.id}>
              <button type="button" onClick={() => vincularOrcamento(o)} disabled={salvando}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50">
                <span className="shrink-0 w-16 text-xs text-gray-500 tabular-nums">{o.numero}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-gray-900 truncate">{o.titulo}</span>
                  <span className="block text-xs text-gray-500 truncate">{o.situacao}</span>
                </span>
                <span className="shrink-0 text-xs text-gray-600 tabular-nums">{brl(o.valor)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      <ConfirmDialog
        open={confirmExcluir}
        title="Excluir esta ata?"
        description="Some para o time e, se estiver publicada, para o cliente. As tarefas criadas a partir dela continuam."
        loading={excluindo}
        onConfirm={excluir}
        onCancel={() => setConfirmExcluir(false)}
      />
    </div>
  )
}
