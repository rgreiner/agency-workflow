'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, Loader2, PartyPopper,
  Repeat, Send, Truck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MachinePath } from '@/components/ui/MachinePath'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { concluirTarefaMidia, mudarSituacaoEntrega } from '@/app/actions/midia-hub'

export interface ItemFila {
  chave: string
  tipo: 'pedido' | 'rotina' | 'entrega'
  titulo: string
  cliente: string
  data: string | null
  activityId: string | null
  status: string | null
  workspaceId: string | null
  campaignId: string | null
  pastaPath: string | null
  previewUrl: string | null
  finalUrl: string | null
  entregaId: string | null
  veiculo: string | null
  conflito: boolean
  /** Entrega cuja tarefa ainda não chegou num status da mídia. */
  esperandoCriacao: boolean
  frequencia: string | null
}

interface StatusCfg { valor: string; label: string; bg: string; txt: string }

const FREQ: Record<string, string> = {
  weekly: 'semanal', biweekly: 'quinzenal', monthly: 'mensal',
  bimonthly: 'bimestral', quarterly: 'trimestral', semiannual: 'semestral', annual: 'anual',
}

const hojeBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const fmt = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—')

function prazo(data: string | null) {
  if (!data) return { texto: 'sem prazo', tom: 'neutro' as const, dias: 9999 }
  const d = data.slice(0, 10)
  const dias = Math.round(
    (new Date(d + 'T12:00:00').getTime() - new Date(hojeBR() + 'T12:00:00').getTime()) / 86400000)
  if (dias < 0) return { texto: `${fmt(d)} · atrasado`, tom: 'atraso' as const, dias }
  if (dias === 0) return { texto: `${fmt(d)} · hoje`, tom: 'hoje' as const, dias }
  if (dias === 1) return { texto: `${fmt(d)} · amanhã`, tom: 'perto' as const, dias }
  if (dias <= 7) return { texto: `${fmt(d)} · em ${dias}d`, tom: 'perto' as const, dias }
  return { texto: fmt(d), tom: 'neutro' as const, dias }
}

const TOM: Record<string, string> = {
  atraso: 'text-red-700 bg-red-50',
  hoje: 'text-orange-700 bg-orange-50',
  perto: 'text-amber-700 bg-amber-50',
  neutro: 'text-gray-500 bg-gray-100',
}

/**
 * A fila da mídia em UMA lista, ordenada por data — o que fazer agora e o que
 * vem depois. O painel (Visão geral) continua existindo para o retrato da
 * operação; aqui não entra KPI, radar nem agrupamento por cliente, porque foi
 * exatamente isso que fazia perder o foco.
 *
 * Uma linha por trabalho: entrega vinculada a uma tarefa que já está na fila
 * aparece só como entrega — o prazo do veículo é o que manda.
 */
export function Trabalhar({ orgSlug, itens, statusCfg }: {
  orgSlug: string
  itens: ItemFila[]
  statusCfg: StatusCfg[]
}) {
  const cfg = useMemo(() => new Map(statusCfg.map(s => [s.valor, s])), [statusCfg])
  const [feitos, setFeitos] = useState<Set<string>>(new Set())

  const lista = useMemo(() => itens.filter(i => !feitos.has(i.chave)), [itens, feitos])
  const atrasados = lista.filter(i => prazo(i.data).dias < 0).length
  const hoje = lista.filter(i => prazo(i.data).dias === 0).length

  function concluir(chave: string) {
    setFeitos(prev => new Set([...prev, chave]))
  }

  if (lista.length === 0) {
    return (
      <div className="p-6">
        <Cabecalho orgSlug={orgSlug} atrasados={0} hoje={0} total={0} />
        <div className="text-center py-20 bg-white border border-gray-200 rounded-xl mt-5">
          <PartyPopper className="w-8 h-8 text-emerald-600 mx-auto" />
          <p className="text-sm text-gray-600 mt-3">Fila limpa. Nada esperando por você.</p>
        </div>
      </div>
    )
  }

  const [primeiro, ...resto] = lista

  return (
    <div className="p-6">
      <Cabecalho orgSlug={orgSlug} atrasados={atrasados} hoje={hoje} total={lista.length} />

      <section className="mt-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Agora</h2>
        <Item orgSlug={orgSlug} item={primeiro} cfg={cfg} destaque onFeito={concluir} />
      </section>

      {resto.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Depois <span className="text-gray-300 font-normal">· {resto.length}</span>
          </h2>
          <ul className="space-y-1.5">
            {resto.map(i => (
              <li key={i.chave}>
                <Item orgSlug={orgSlug} item={i} cfg={cfg} onFeito={concluir} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Cabecalho({ orgSlug, atrasados, hoje, total }: {
  orgSlug: string; atrasados: number; hoje: number; total: number
}) {
  const partes = [
    atrasados > 0 ? `${atrasados} atrasado${atrasados > 1 ? 's' : ''}` : null,
    hoje > 0 ? `${hoje} para hoje` : null,
    `${total} na fila`,
  ].filter(Boolean)
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Trabalhar</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          {partes.join(' · ')} — em ordem de data, pedidos, rotinas e entregas juntos.
        </p>
      </div>
      <Link href={`/${orgSlug}/midia/visao-geral`}
        className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
        Visão geral <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  )
}

function Item({ orgSlug, item, cfg, destaque = false, onFeito }: {
  orgSlug: string
  item: ItemFila
  cfg: Map<string, StatusCfg>
  destaque?: boolean
  onFeito: (chave: string) => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirmar, setConfirmar] = useState(false)
  const p = prazo(item.data)
  const st = item.status ? cfg.get(item.status) : null

  const linkTarefa = item.activityId && item.workspaceId && item.campaignId
    ? `/${orgSlug}/workspaces/${item.workspaceId}/campaigns/${item.campaignId}/activities/${item.activityId}?from=${encodeURIComponent(`/${orgSlug}/midia`)}`
    : null

  function enviar() {
    if (item.esperandoCriacao) { setConfirmar(true); return }
    executarEnvio()
  }

  function executarEnvio() {
    start(async () => {
      const r = await mudarSituacaoEntrega(orgSlug, item.entregaId!, 'liberado')
      if (r?.error) { toast.error(r.error); return }
      setConfirmar(false)
      const t = r.tarefa
      if (t?.recorreu) toast.success(`Enviado ao veículo. A rotina volta em ${fmt(t.novoPrazo)}.`)
      else if (t) toast.success('Enviado ao veículo e tarefa concluída.')
      else toast.success('Marcado como enviado ao veículo.')
      onFeito(item.chave)
      router.refresh()
    })
  }

  function feito() {
    start(async () => {
      const r = await concluirTarefaMidia(orgSlug, item.activityId!)
      if ('error' in r && r.error) { toast.error(r.error); return }
      if (r.recorreu) toast.success(`Feito. Volta em ${fmt(r.novoPrazo ?? null)}.`)
      else toast.success('Feito.')
      onFeito(item.chave)
      router.refresh()
    })
  }

  return (
    <div className={cn('bg-white border rounded-xl',
      destaque ? 'p-5 shadow-sm' : 'px-4 py-3',
      item.conflito ? 'border-red-200' : destaque ? 'border-orange-200' : 'border-gray-200')}>
      <div className="flex items-start gap-3 flex-wrap">
        <span className={cn('shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium tabular-nums',
          TOM[p.tom])}>
          {p.texto}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {item.tipo === 'entrega' && <Truck className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
            {item.tipo === 'rotina' && <Repeat className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
            {linkTarefa ? (
              <Link href={linkTarefa}
                className={cn('font-medium text-gray-900 hover:text-orange-600 transition-colors',
                  destaque ? 'text-base' : 'text-sm')}>
                {item.titulo}
              </Link>
            ) : (
              <span className={cn('font-medium text-gray-900', destaque ? 'text-base' : 'text-sm')}>
                {item.titulo}
              </span>
            )}
            {st && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: st.bg, color: st.txt }}>{st.label}</span>
            )}
            {item.esperandoCriacao && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                com a criação
              </span>
            )}
          </div>

          <p className="text-[11px] text-gray-400 mt-0.5">
            {item.cliente}
            {item.veiculo && ` · ${item.veiculo}`}
            {item.frequencia && ` · ${FREQ[item.frequencia] ?? item.frequencia}`}
          </p>

          {item.conflito && (
            <p className="text-[11px] text-red-700 mt-1 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" /> A criação prometeu para depois do envio.
            </p>
          )}

          {destaque && (
            <div className="flex items-center gap-2 flex-wrap mt-2.5">
              {item.previewUrl && <Atalho url={item.previewUrl} label="Preview" />}
              {item.finalUrl && <Atalho url={item.finalUrl} label="Final" />}
              {item.pastaPath && (
                <div className="min-w-0 max-w-full"><MachinePath winPath={item.pastaPath} compact /></div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0">
          {item.entregaId ? (
            <button onClick={enviar} disabled={pending}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-[#fff] hover:bg-emerald-700 transition-colors disabled:opacity-60">
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Enviei ao veículo
            </button>
          ) : item.activityId ? (
            <button onClick={feito} disabled={pending}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-60">
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Feito
            </button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmar}
        title="Concluir a tarefa junto?"
        description={`A peça ainda está com a criação${st ? ` (${st.label})` : ''}. Marcar como enviado ao `
          + `veículo também CONCLUI a tarefa — e isso não se desfaz por aqui.`}
        confirmLabel="Enviei ao veículo"
        cancelLabel="Cancelar"
        loading={pending}
        onConfirm={executarEnvio}
        onCancel={() => setConfirmar(false)}
      />
    </div>
  )
}

function Atalho({ url, label }: { url: string; label: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-50 text-[11px] font-medium text-gray-600 hover:bg-orange-50 hover:text-orange-700 transition-colors">
      <ExternalLink className="w-3 h-3" /> {label}
    </a>
  )
}
