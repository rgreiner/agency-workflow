'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Check, ChevronRight, Loader2, Plus, Repeat, Link2, Power, CalendarClock,
  FolderOpen, FolderPlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import {
  ativarClienteMidia, aplicarRotinas, desativarRotina, salvarDadosOperacao,
  marcarImplantacao, listarPastasDoDrive, vincularPastaCliente, abrirPastaDoMes,
  definirPastaRotina, type EstadoImplantacao,
} from '@/app/actions/midia-hub'

export interface RotinaCatalogo {
  id: string; nome: string; descricao: string | null
  frequencia: string; dia_mes: number | null; dia_semana: number | null
  pasta: string | null; padrao: boolean; ordem: number; ativo: boolean
}

export interface ItemImplantacao {
  id: string; bloco: 'acessos' | 'documentos' | 'social' | 'pixel_crm'; nome: string; ordem: number
}

export interface ClienteRow {
  workspaceId: string
  nome: string
  /** item_id → estado. Sem chave = pendente (não existe seed por cliente). */
  implantacao: Record<string, { estado: string; nota: string | null }>
  operacao: {
    id: string; ano: number; ativo: boolean; campaignId: string | null
    planoUrl: string | null; specsUrl: string | null; crmUrl: string | null
    driveFolderId: string | null; observacao: string | null
    rotinas: { vinculoId: string; rotinaId: string; activityId: string | null; viva: boolean; prazo: string | null }[]
  } | null
}

const FREQ_LABEL: Record<string, string> = {
  weekly: 'semanal', biweekly: 'quinzenal', monthly: 'mensal',
  bimonthly: 'bimestral', quarterly: 'trimestral', semiannual: 'semestral', annual: 'anual',
}
const DIA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** "mensal, dia 3" · "semanal, quinta" — a régua da rotina em uma linha. */
function quando(r: RotinaCatalogo): string {
  const base = FREQ_LABEL[r.frequencia] ?? r.frequencia
  if (r.dia_mes) return `${base}, dia ${r.dia_mes}`
  if (r.dia_semana != null) return `${base}, ${DIA_SEMANA[r.dia_semana]}`
  return base
}
const fmtPrazo = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—')

export function ClientesMidia({ orgSlug, clientes, rotinas, itensImplantacao, pessoas, anoCorrente }: {
  orgSlug: string
  clientes: ClienteRow[]
  rotinas: RotinaCatalogo[]
  itensImplantacao: ItemImplantacao[]
  pessoas: { id: string; nome: string }[]
  anoCorrente: number
}) {
  const [aberto, setAberto] = useState<string | null>(null)
  const ativos = clientes.filter(c => c.operacao?.ativo)
  const inativos = clientes.filter(c => !c.operacao?.ativo)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Clientes e rotinas</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Ativar a mídia num cliente cria a campanha <span className="text-gray-600">Mídia · Operação {anoCorrente}</span> no
          próprio cliente — as rotinas viram tarefas recorrentes lá, e as horas passam a contar no cliente certo.
        </p>
      </div>

      <section>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Com mídia ativa <span className="text-gray-300 font-normal">· {ativos.length}</span>
        </h2>
        {ativos.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center bg-white border border-gray-200 rounded-xl">
            Nenhum cliente ainda. Ative o primeiro na lista abaixo.
          </p>
        ) : (
          <div className="space-y-2">
            {ativos.map(c => (
              <CardCliente key={c.workspaceId} orgSlug={orgSlug} cliente={c} rotinas={rotinas}
                itensImplantacao={itensImplantacao} pessoas={pessoas}
                aberto={aberto === c.workspaceId} onToggle={() => setAberto(aberto === c.workspaceId ? null : c.workspaceId)} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Sem mídia <span className="text-gray-300 font-normal">· {inativos.length}</span>
        </h2>
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50">
          {inativos.map(c => <LinhaInativa key={c.workspaceId} orgSlug={orgSlug} cliente={c} />)}
          {inativos.length === 0 && <p className="text-sm text-gray-400 p-4">Todo cliente já tem mídia ativa.</p>}
        </div>
      </section>
    </div>
  )
}

function LinhaInativa({ orgSlug, cliente }: { orgSlug: string; cliente: ClienteRow }) {
  const [pending, start] = useTransition()
  function ativar() {
    start(async () => {
      const r = await ativarClienteMidia(orgSlug, cliente.workspaceId)
      if ('error' in r && r.error) toast.error(r.error)
      else toast.success(`Mídia ativada em ${cliente.nome}. Agora escolha as rotinas.`)
    })
  }
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-sm text-gray-700">{cliente.nome}</span>
      <button onClick={ativar} disabled={pending}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-orange-100 hover:text-orange-700 transition-colors disabled:opacity-60">
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Ativar mídia
      </button>
    </div>
  )
}

function CardCliente({ orgSlug, cliente, rotinas, itensImplantacao, pessoas, aberto, onToggle }: {
  orgSlug: string
  cliente: ClienteRow
  rotinas: RotinaCatalogo[]
  itensImplantacao: ItemImplantacao[]
  pessoas: { id: string; nome: string }[]
  aberto: boolean
  onToggle: () => void
}) {
  const op = cliente.operacao!
  const [pending, start] = useTransition()
  const [responsavel, setResponsavel] = useState('')
  const ativasIds = new Set(op.rotinas.filter(r => r.viva).map(r => r.rotinaId))
  const faltando = rotinas.filter(r => !ativasIds.has(r.id))

  function aplicar(ids: string[]) {
    start(async () => {
      const r = await aplicarRotinas(orgSlug, op.id, ids, responsavel || null)
      if ('error' in r && r.error) toast.error(r.error)
      else toast.success(r.criadas === 1 ? 'Rotina criada como tarefa recorrente.' : `${r.criadas} rotinas criadas.`)
    })
  }
  function desligar(vinculoId: string) {
    start(async () => {
      const r = await desativarRotina(orgSlug, vinculoId)
      if (r?.error) toast.error(r.error)
      else toast.success('Rotina desligada. A tarefa em andamento continua na pauta.')
    })
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <ChevronRight className={cn('w-4 h-4 text-gray-400 transition-transform shrink-0', aberto && 'rotate-90')} />
        <span className="text-sm font-medium text-gray-900 flex-1 min-w-0 truncate">{cliente.nome}</span>
        <span className="text-[11px] text-gray-400 shrink-0">operação {op.ano}</span>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 shrink-0 tabular-nums">
          {op.rotinas.filter(r => r.viva).length} rotina{op.rotinas.filter(r => r.viva).length === 1 ? '' : 's'}
        </span>
        <ProgressoImplantacao itens={itensImplantacao} estados={cliente.implantacao} />
      </button>

      {aberto && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-3">
          <div>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rotinas</h3>
              {faltando.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="w-44">
                    <Select size="sm" value={responsavel} onChange={setResponsavel}
                      options={[{ value: '', label: 'Sem responsável' }, ...pessoas.map(p => ({ value: p.id, label: p.nome }))]}
                      placeholder="Responsável" />
                  </div>
                  <button onClick={() => aplicar(faltando.filter(r => r.padrao).map(r => r.id))} disabled={pending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors disabled:opacity-60">
                    {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Criar as padrão
                  </button>
                </div>
              )}
            </div>

            <ul className="space-y-1.5">
              {rotinas.map(r => {
                const v = op.rotinas.find(x => x.rotinaId === r.id && x.viva)
                return (
                  <li key={r.id} className={cn('flex items-center gap-3 px-3 py-2 rounded-lg border',
                    v ? 'border-emerald-100 bg-emerald-50/40' : 'border-gray-100')}>
                    <span className={cn('w-5 h-5 rounded-md flex items-center justify-center shrink-0',
                      v ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-300')}>
                      <Check className="w-3 h-3" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-sm text-gray-800 block truncate">{r.nome}</span>
                      <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
                        <Repeat className="w-3 h-3" /> {quando(r)}
                        {r.pasta && <span className="text-gray-300">· {r.pasta}</span>}
                      </span>
                    </span>
                    {v?.activityId && op.campaignId && (
                      <Link href={`/${orgSlug}/workspaces/${cliente.workspaceId}/campaigns/${op.campaignId}/activities/${v.activityId}?from=${encodeURIComponent(`/${orgSlug}/midia/clientes`)}`}
                        className="text-[11px] text-gray-500 hover:text-orange-600 transition-colors inline-flex items-center gap-1 shrink-0">
                        <CalendarClock className="w-3 h-3" /> {fmtPrazo(v.prazo)}
                      </Link>
                    )}
                    {v && r.pasta && (
                      <BotaoPastaDoMes orgSlug={orgSlug} vinculoId={v.vinculoId}
                        temPastaCliente={!!op.driveFolderId} pasta={r.pasta} />
                    )}
                    {v ? (
                      <button onClick={() => desligar(v.vinculoId)} disabled={pending} title="Desligar rotina"
                        className="text-gray-300 hover:text-red-600 transition-colors shrink-0">
                        <Power className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button onClick={() => aplicar([r.id])} disabled={pending}
                        className="text-[11px] font-medium px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-orange-100 hover:text-orange-700 transition-colors shrink-0 disabled:opacity-60">
                        criar
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>

          <Implantacao orgSlug={orgSlug} workspaceId={cliente.workspaceId}
            itens={itensImplantacao} estados={cliente.implantacao} />

          <PastaDoCliente orgSlug={orgSlug} op={op} cliente={cliente.nome} />

          <LinksOperacao orgSlug={orgSlug} op={op} />
        </div>
      )}
    </div>
  )
}

/** Os links fixos que ela abre toda semana — hoje vivem num favorito do navegador. */
function LinksOperacao({ orgSlug, op }: { orgSlug: string; op: NonNullable<ClienteRow['operacao']> }) {
  const [pending, start] = useTransition()
  const [form, setForm] = useState({
    plano_url: op.planoUrl ?? '', specs_url: op.specsUrl ?? '',
    crm_url: op.crmUrl ?? '', observacao: op.observacao ?? '',
  })
  const campos: { k: keyof typeof form; label: string; ph: string }[] = [
    { k: 'plano_url', label: 'Plano de mídia', ph: 'link do plano' },
    { k: 'specs_url', label: 'Tabela de especificações', ph: 'link da tabela' },
    { k: 'crm_url', label: 'CRM do cliente', ph: 'link do CRM' },
    { k: 'observacao', label: 'Observação', ph: 'o que a mídia precisa lembrar deste cliente' },
  ]
  function salvar() {
    start(async () => {
      const r = await salvarDadosOperacao(orgSlug, op.id, form)
      if (r?.error) toast.error(r.error)
      else toast.success('Links salvos.')
    })
  }
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 inline-flex items-center gap-1.5">
        <Link2 className="w-3.5 h-3.5" /> Links da operação
      </h3>
      <div className="grid sm:grid-cols-2 gap-2">
        {campos.map(c => (
          <label key={c.k} className="block">
            <span className="text-[11px] text-gray-400">{c.label}</span>
            <input value={form[c.k]} onChange={e => setForm(f => ({ ...f, [c.k]: e.target.value }))}
              placeholder={c.ph}
              className="w-full mt-0.5 bg-gray-100 border border-transparent rounded-xl px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:bg-white focus:border-orange-300 focus:outline-none transition-colors" />
          </label>
        ))}
      </div>
      <button onClick={salvar} disabled={pending}
        className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-60">
        {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Salvar links
      </button>
    </div>
  )
}

const BLOCOS: { id: ItemImplantacao['bloco']; label: string }[] = [
  { id: 'acessos', label: 'Acessos' },
  { id: 'documentos', label: 'Documentos' },
  { id: 'social', label: 'Social' },
  { id: 'pixel_crm', label: 'Pixel e CRM' },
]

/** % de implantação: 'na' (não se aplica) sai do denominador — item que nunca
 *  vai existir naquele cliente não pode segurar o cliente em 80% para sempre. */
function calcula(itens: ItemImplantacao[], estados: ClienteRow['implantacao']) {
  let vale = 0, ok = 0, perdidos = 0
  for (const i of itens) {
    const e = estados[i.id]?.estado ?? 'pendente'
    if (e === 'na') continue
    vale++
    if (e === 'ok') ok++
    if (e === 'perdido') perdidos++
  }
  return { pct: vale ? Math.round((ok / vale) * 100) : 100, ok, vale, perdidos }
}

function ProgressoImplantacao({ itens, estados }: { itens: ItemImplantacao[]; estados: ClienteRow['implantacao'] }) {
  const { pct, perdidos } = calcula(itens, estados)
  if (itens.length === 0) return null
  return (
    <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 tabular-nums',
      perdidos > 0 ? 'bg-red-50 text-red-700' : pct === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
      implantação {pct}%{perdidos > 0 ? ` · ${perdidos} perdido${perdidos > 1 ? 's' : ''}` : ''}
    </span>
  )
}

const ESTADOS: { v: EstadoImplantacao; label: string; cls: string }[] = [
  { v: 'ok', label: 'ok', cls: 'bg-emerald-100 text-emerald-700' },
  { v: 'pendente', label: 'pendente', cls: 'bg-gray-100 text-gray-500' },
  { v: 'perdido', label: 'perdido', cls: 'bg-red-100 text-red-700' },
  { v: 'na', label: 'n/a', cls: 'bg-gray-100 text-gray-400' },
]

/** Checklist de ESTADO — não é uma lista de tarefas a concluir: o item volta
 *  para 'perdido' quando o acesso cai, e é esse o ponto de existir. */
function Implantacao({ orgSlug, workspaceId, itens, estados }: {
  orgSlug: string
  workspaceId: string
  itens: ItemImplantacao[]
  estados: ClienteRow['implantacao']
}) {
  const [pending, start] = useTransition()
  const { pct, ok, vale } = calcula(itens, estados)
  if (itens.length === 0) return null

  function marcar(itemId: string, estado: EstadoImplantacao) {
    start(async () => {
      const r = await marcarImplantacao(orgSlug, workspaceId, itemId, estado)
      if (r?.error) toast.error(r.error)
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Implantação</h3>
        <span className="text-[11px] text-gray-400 tabular-nums">{ok} de {vale} · {pct}%</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {BLOCOS.map(b => {
          const doBloco = itens.filter(i => i.bloco === b.id)
          if (doBloco.length === 0) return null
          return (
            <div key={b.id} className="border border-gray-100 rounded-xl p-3">
              <p className="text-[11px] font-semibold text-gray-500 mb-1.5">{b.label}</p>
              <ul className="space-y-1">
                {doBloco.map(i => {
                  const atual = (estados[i.id]?.estado ?? 'pendente') as EstadoImplantacao
                  return (
                    <li key={i.id} className="flex items-center gap-2">
                      <span className="text-[12px] text-gray-700 min-w-0 flex-1 truncate" title={i.nome}>{i.nome}</span>
                      <span className="flex items-center gap-0.5 shrink-0">
                        {ESTADOS.map(e => (
                          <button key={e.v} onClick={() => marcar(i.id, e.v)} disabled={pending}
                            title={e.label}
                            className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-md transition-colors disabled:opacity-60',
                              atual === e.v ? e.cls : 'text-gray-300 hover:bg-gray-100')}>
                            {e.label}
                          </button>
                        ))}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Vincula a pasta do cliente no drive Mídia. Escolha em lista, não link colado:
 *  os nomes de lá não batem com os do Flow ("É O Amor" × "É o Amor - Condomínio
 *  Fazenda"), e digitar ID é onde o erro nasce. */
function PastaDoCliente({ orgSlug, op, cliente }: {
  orgSlug: string
  op: NonNullable<ClienteRow['operacao']>
  cliente: string
}) {
  const [pending, start] = useTransition()
  const [pastas, setPastas] = useState<{ id: string; nome: string }[] | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function carregar() {
    if (pastas || carregando) return
    setCarregando(true)
    const r = await listarPastasDoDrive(orgSlug)
    setCarregando(false)
    if ('error' in r && r.error) { toast.error(r.error); return }
    setPastas(r.pastas ?? [])
  }

  function vincular(folderId: string) {
    start(async () => {
      const r = await vincularPastaCliente(orgSlug, op.id, folderId)
      if (r?.error) toast.error(r.error)
      else toast.success('Pasta do cliente vinculada.')
    })
  }

  const atual = pastas?.find(p => p.id === op.driveFolderId)

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 inline-flex items-center gap-1.5">
        <FolderOpen className="w-3.5 h-3.5" /> Pasta no drive Mídia
      </h3>
      {op.driveFolderId ? (
        <div className="flex items-center gap-2 flex-wrap">
          <a href={`https://drive.google.com/drive/folders/${op.driveFolderId}`} target="_blank" rel="noopener noreferrer"
            className="text-[12px] text-gray-600 hover:text-orange-600 transition-colors inline-flex items-center gap-1">
            <FolderOpen className="w-3.5 h-3.5" /> {atual?.nome ?? 'abrir a pasta do cliente'}
          </a>
          <button onClick={carregar} disabled={carregando}
            className="text-[11px] font-medium text-gray-400 hover:text-gray-700 transition-colors">
            {carregando ? 'carregando…' : 'trocar'}
          </button>
        </div>
      ) : (
        <button onClick={carregar} disabled={carregando}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-60">
          {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
          Vincular a pasta de {cliente}
        </button>
      )}

      {pastas && (
        <div className="mt-2 w-full sm:w-80">
          <Select size="sm" value={op.driveFolderId ?? ''} onChange={vincular}
            options={pastas.map(p => ({ value: p.id, label: p.nome }))}
            placeholder={pending ? 'salvando…' : 'Escolha a pasta no drive Mídia'} />
        </div>
      )}
    </div>
  )
}

/** Cria (ou reusa) a pasta do mês da rotina e deixa o link na tarefa. Quando o
 *  Flow não reconhece a pasta da rotina, PERGUNTA em vez de criar outra grafia. */
function BotaoPastaDoMes({ orgSlug, vinculoId, temPastaCliente, pasta }: {
  orgSlug: string; vinculoId: string; temPastaCliente: boolean; pasta: string
}) {
  const [pending, start] = useTransition()
  const [escolha, setEscolha] = useState<{ canonica: string; anoFolderId: string; opcoes: { id: string; nome: string }[] } | null>(null)

  function abrir() {
    if (!temPastaCliente) { toast.error('Vincule primeiro a pasta do cliente no drive Mídia.'); return }
    start(async () => {
      const r = await abrirPastaDoMes(orgSlug, vinculoId)
      if ('error' in r && r.error) { toast.error(r.error); return }
      if ('precisaEscolher' in r && r.precisaEscolher) {
        setEscolha({ canonica: r.canonica!, anoFolderId: r.anoFolderId!, opcoes: r.opcoes ?? [] })
        return
      }
      toast.success(r.criadas?.length ? `Pasta criada: ${r.caminho}` : `Pasta do mês: ${r.caminho}`)
      if (r.link) window.open(r.link, '_blank', 'noopener')
    })
  }

  function definir(folderId?: string, criar?: boolean) {
    if (!escolha) return
    start(async () => {
      const r = await definirPastaRotina(orgSlug, vinculoId,
        criar ? { criarEm: { anoFolderId: escolha.anoFolderId, nome: escolha.canonica } } : { folderId })
      if ('error' in r && r.error) { toast.error(r.error); return }
      setEscolha(null)
      const r2 = await abrirPastaDoMes(orgSlug, vinculoId)
      if ('error' in r2 && r2.error) { toast.error(r2.error); return }
      toast.success(`Pasta do mês: ${r2.caminho}`)
      if (r2.link) window.open(r2.link, '_blank', 'noopener')
    })
  }

  return (
    <>
      <button onClick={abrir} disabled={pending} title={`Pasta do mês em ${pasta}`}
        className="text-gray-300 hover:text-orange-600 transition-colors shrink-0 disabled:opacity-60">
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
      </button>

      {escolha && (
        <Modal open onClose={() => setEscolha(null)} size="lg" label="Qual pasta é esta?" dismissable={!pending}>
          <ModalHeader title="Qual pasta é esta?" onClose={() => setEscolha(null)} />
          <div className="px-6 py-5 space-y-3">
            <p className="text-sm text-gray-600">
              Não encontrei <b>{escolha.canonica}</b> neste cliente. Escolha a pasta que já é usada para
              isso — assim o Flow não cria mais uma grafia ao lado das que existem.
            </p>
            <ul className="space-y-1 max-h-64 overflow-y-auto">
              {escolha.opcoes.map(o => (
                <li key={o.id}>
                  <button onClick={() => definir(o.id)} disabled={pending}
                    className="w-full text-left px-3 py-2 rounded-xl border border-gray-200 hover:border-orange-300 hover:bg-orange-50/50 transition-colors text-sm text-gray-700 disabled:opacity-60">
                    {o.nome}
                  </button>
                </li>
              ))}
              {escolha.opcoes.length === 0 && (
                <li className="text-sm text-gray-400">Este ano ainda não tem nenhuma subpasta.</li>
              )}
            </ul>
            <button onClick={() => definir(undefined, true)} disabled={pending}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors disabled:opacity-60">
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
              Criar &ldquo;{escolha.canonica}&rdquo;
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
