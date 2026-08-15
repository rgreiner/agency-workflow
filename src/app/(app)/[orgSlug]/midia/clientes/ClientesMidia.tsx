'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Check, ChevronRight, Loader2, Plus, Repeat, Link2, Power, CalendarClock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { ativarClienteMidia, aplicarRotinas, desativarRotina, salvarDadosOperacao } from '@/app/actions/midia-hub'

export interface RotinaCatalogo {
  id: string; nome: string; descricao: string | null
  frequencia: string; dia_mes: number | null; dia_semana: number | null
  pasta: string | null; padrao: boolean; ordem: number; ativo: boolean
}

export interface ClienteRow {
  workspaceId: string
  nome: string
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

export function ClientesMidia({ orgSlug, clientes, rotinas, pessoas, anoCorrente }: {
  orgSlug: string
  clientes: ClienteRow[]
  rotinas: RotinaCatalogo[]
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
              <CardCliente key={c.workspaceId} orgSlug={orgSlug} cliente={c} rotinas={rotinas} pessoas={pessoas}
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

function CardCliente({ orgSlug, cliente, rotinas, pessoas, aberto, onToggle }: {
  orgSlug: string
  cliente: ClienteRow
  rotinas: RotinaCatalogo[]
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
