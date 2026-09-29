'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  NotebookPen, Sparkles, Loader2, Plus, X, Trash2, Globe, ChevronDown, ExternalLink, ListPlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { salvarReuniao, excluirReuniao, organizarReuniao } from '@/app/actions/reunioes'
import type { Reuniao, PassoReuniao, ResponsavelPasso } from '@/lib/reunioes'

export interface TarefaDoPasso { titulo: string; href: string }

const inputCls = 'w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:opacity-70'

const passoVazio = (responsavel: ResponsavelPasso = 'agencia'): PassoReuniao =>
  ({ id: null, texto: '', responsavel, rascunho: '', activityId: null })

/**
 * Editor da ata (mig. 306). Colar notas → "Organizar com IA" propõe resumo e
 * passos (não grava) → a pessoa revisa e salva. "Criar tarefa" salva antes e
 * abre a Nova atividade com o rascunho do passo (?passo=<id>), que o form
 * organiza no padrão da casa.
 */
export function ReuniaoEditor({
  orgSlug, workspaceId, clienteNome, inicial, campanhas, tarefas, podeEditar,
}: {
  orgSlug: string
  workspaceId: string
  clienteNome: string
  inicial: Reuniao
  campanhas: { id: string; name: string }[]
  /** passoId → tarefa criada a partir dele. */
  tarefas: Record<string, TarefaDoPasso>
  podeEditar: boolean
}) {
  const router = useRouter()
  const [ata, setAta] = useState<Reuniao>(inicial)
  const [salvo, setSalvo] = useState(() => JSON.stringify(inicial))
  const sujo = JSON.stringify(ata) !== salvo
  const [salvando, startSalvar] = useTransition()
  const [organizando, setOrganizando] = useState(false)
  const [verTranscricao, setVerTranscricao] = useState(!!inicial.transcricao && !inicial.notas)
  const [abertos, setAbertos] = useState<Set<number>>(new Set())
  const [confirmPublicar, setConfirmPublicar] = useState(false)
  const [confirmExcluir, setConfirmExcluir] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  // Passo à espera de uma campanha pra virar tarefa (ata sem campanha).
  const [pedeCampanha, setPedeCampanha] = useState<number | null>(null)
  const [campanhaEscolhida, setCampanhaEscolhida] = useState('')

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
  async function gravar(dados: Reuniao): Promise<Reuniao | null> {
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
      // Passo que já virou tarefa não some: a IA propõe, o vínculo fica.
      const comTarefa = ata.passos.filter(p => p.activityId)
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
          <span className="block text-xs font-medium text-gray-500 mb-1">Participantes</span>
          <input value={ata.participantes} disabled={ro} placeholder="Ana (cliente), Rafael…"
            onChange={e => set('participantes', e.target.value)} className={inputCls} />
        </label>
      </div>

      {/* ── Material bruto (interno) ── */}
      <section className="mb-6">
        <div className="flex items-end justify-between gap-3 mb-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Notas da reunião</h2>
            <p className="text-xs text-gray-500">Cole as notas do Granola. Só o time vê.</p>
          </div>
          {podeEditar && (
            <button type="button" onClick={organizar} disabled={!temTexto || organizando}
              className="press inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors disabled:opacity-50">
              {organizando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {organizando ? 'Organizando…' : 'Organizar com IA'}
            </button>
          )}
        </div>
        <textarea value={ata.notas} disabled={ro} rows={8}
          onChange={e => set('notas', e.target.value)}
          placeholder="Resumo, decisões e combinados, do jeito que o Granola gerou"
          className={cn(inputCls, 'resize-y leading-relaxed')} />
        <button type="button" onClick={() => setVerTranscricao(v => !v)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors">
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', verTranscricao && 'rotate-180')} />
          Transcrição {ata.transcricao.trim() ? `(${Math.round(ata.transcricao.length / 1000)} mil caracteres)` : '(opcional)'}
        </button>
        {verTranscricao && (
          <textarea value={ata.transcricao} disabled={ro} rows={10}
            onChange={e => set('transcricao', e.target.value)}
            placeholder="Cole a transcrição completa. A IA usa para achar detalhes que as notas não trazem. Nunca vai para o cliente."
            className={cn(inputCls, 'mt-2 resize-y font-mono text-xs leading-relaxed')} />
        )}
      </section>

      {/* ── O que o cliente lê ── */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-gray-900">Resumo</h2>
        <p className="text-xs text-gray-500 mb-2">É o texto que o cliente lê no portal quando a ata é publicada.</p>
        <textarea value={ata.resumo} disabled={ro} rows={7}
          onChange={e => set('resumo', e.target.value)}
          placeholder="Contexto, decisões e pontos em aberto"
          className={cn(inputCls, 'resize-y leading-relaxed')} />
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-gray-900">Próximos passos</h2>
        <p className="text-xs text-gray-500 mb-2">Os da agência viram tarefa com o briefing rascunhado. Os do cliente aparecem para ele no portal.</p>

        <ul className="space-y-2">
          {ata.passos.map((p, i) => {
            const tarefa = p.id ? tarefas[p.id] : undefined
            const aberto = abertos.has(i)
            return (
              <li key={p.id ?? `novo-${i}`} className="rounded-2xl bg-white border border-gray-200 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="inline-flex shrink-0 rounded-lg bg-gray-100 p-0.5 text-xs">
                    {(['agencia', 'cliente'] as const).map(r => (
                      <button key={r} type="button" disabled={ro || !!p.activityId}
                        onClick={() => setPasso(i, { responsavel: r })}
                        className={cn('px-2 py-1 rounded-md font-medium transition-colors',
                          p.responsavel === r ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                        {r === 'agencia' ? 'Agência' : 'Cliente'}
                      </button>
                    ))}
                  </div>
                  <input value={p.texto} disabled={ro} onChange={e => setPasso(i, { texto: e.target.value })}
                    placeholder="O que foi combinado"
                    className="flex-1 min-w-0 bg-transparent text-sm text-gray-900 placeholder-gray-400 px-2 py-1.5 rounded-lg focus:outline-none focus:bg-gray-100 disabled:opacity-100" />
                  {p.responsavel === 'agencia' && (
                    tarefa ? (
                      <Link href={tarefa.href} title={tarefa.titulo}
                        className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded-lg hover:bg-green-200 transition-colors">
                        Tarefa <ExternalLink className="w-3 h-3" />
                      </Link>
                    ) : p.activityId ? (
                      <span className="shrink-0 text-xs text-gray-400">Tarefa criada</span>
                    ) : podeEditar && (
                      <button type="button" onClick={() => criarTarefa(i)} disabled={salvando || !p.texto.trim()}
                        className="press shrink-0 inline-flex items-center gap-1 text-xs font-medium text-[#fff] bg-orange-600 hover:bg-orange-700 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                        <ListPlus className="w-3.5 h-3.5" /> Criar tarefa
                      </button>
                    )
                  )}
                  {p.responsavel === 'agencia' && (
                    <button type="button" title={aberto ? 'Esconder o rascunho do briefing' : 'Ver o rascunho do briefing'}
                      onClick={() => setAbertos(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })}
                      className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                      <ChevronDown className={cn('w-4 h-4 transition-transform', aberto && 'rotate-180')} />
                    </button>
                  )}
                  {podeEditar && !p.activityId && (
                    <button type="button" title="Remover passo"
                      onClick={() => setAta(a => ({ ...a, passos: a.passos.filter((_, j) => j !== i) }))}
                      className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {p.responsavel === 'agencia' && aberto && (
                  <textarea value={p.rascunho} disabled={ro || !!p.activityId} rows={5}
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
