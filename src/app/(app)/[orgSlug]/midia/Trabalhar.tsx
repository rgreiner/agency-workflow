'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, ExternalLink, Flag, Link2, ListChecks, Loader2,
  PartyPopper, Send,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PRIORITY_CONFIG, COMPLEXITY_CONFIG, type ActivityPriority, type ActivityComplexity } from '@/types'
import { MachinePath } from '@/components/ui/MachinePath'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { lerLinhaComData } from '@/lib/checklist-datas'
import { DATE_FILTERS, matchesDateFilter } from '@/lib/prazo-filtro'
import { criarPrefLocal } from '@/lib/pref-local'
import { concluirTarefaMidia, desdobrarEmDatas, marcarItemChecklist, mudarSituacaoEntrega } from '@/app/actions/midia-hub'

/**
 * O tipo do trabalho — a cor da barra (ver TIPOS). `implantar` é implantação/
 * validação (a peça chegou), `trabalho` é o que está sendo feito (plano,
 * tabela), `peca` é a entrega ao veículo e `rotina` vem do catálogo. Post
 * datado herda o tipo da tarefa-mãe. O nome ficou de quando eram regiões.
 */
export type Regiao = 'implantar' | 'trabalho' | 'peca' | 'rotina'

export interface ItemFila {
  chave: string
  tipo: 'pedido' | 'rotina' | 'entrega'
  regiao: Regiao
  titulo: string
  cliente: string
  data: string | null
  activityId: string | null
  status: string | null
  workspaceId: string | null
  campaignId: string | null
  pastaPath: string | null
  pastaUrl: string | null
  redacaoUrl: string | null
  previewUrl: string | null
  finalUrl: string | null
  entregaId: string | null
  veiculo: string | null
  /** Contato do cadastro do veículo, quando a entrega aponta para ele. */
  veiculoContato: string | null
  formato: string | null
  especificacao: string | null
  conflito: boolean
  /** Entrega cuja tarefa ainda não chegou num status da mídia. */
  esperandoCriacao: boolean
  frequencia: string | null
  /** Quem está na tarefa (a entrega herda da tarefa vinculada). */
  assigneeIds: string[]
  pedidoPor: string | null
  /** Primeira entrada num status da mídia; sem histórico, mostra a criação. */
  entrouEm: string | null
  criadaEm: string | null
  prioridade: string
  complexidade: string
  checklist: { feitos: number; total: number } | null
  /** Linha de um item datado do checklist da tarefa (a demanda da data X). */
  item: { id: string; texto: string } | null
}

interface StatusCfg { valor: string; label: string; bg: string; txt: string }

const FREQ: Record<string, string> = {
  daily: 'diária', weekly: 'semanal', biweekly: 'quinzenal', monthly: 'mensal',
  bimonthly: 'bimestral', quarterly: 'trimestral', semiannual: 'semestral', annual: 'anual',
}

/** Quantos dias antes o planejador de posts aceita agendar (Meta: 28) — só para o chip. */
const JANELA_AGENDAMENTO = 28

// ── Preferências locais (por navegador) — ver lib/pref-local ────────────────

type ChaveLink = 'redacao' | 'preview' | 'final' | 'pasta'
type LinksVisiveis = Record<ChaveLink, boolean>
const LINKS: { chave: ChaveLink; label: string }[] = [
  { chave: 'redacao', label: 'Redação' },
  { chave: 'preview', label: 'Preview' },
  { chave: 'final',   label: 'Final' },
  { chave: 'pasta',   label: 'Pasta do Drive' },
]
const LINKS_PADRAO: LinksVisiveis = { redacao: true, preview: true, final: true, pasta: true }

const prefEu = criarPrefLocal<boolean>('flow:midia:trabalhar:eu:v1', false,
  b => b === '1' || b === 'true')
const prefLinks = criarPrefLocal<LinksVisiveis>('flow:midia:trabalhar:links:v1', LINKS_PADRAO,
  b => ({ ...LINKS_PADRAO, ...(JSON.parse(b) as Partial<LinksVisiveis>) }))
/** Filtro de prazo — os mesmos presets da Lista (lib/prazo-filtro). */
const prefPrazo = criarPrefLocal<string>('flow:midia:trabalhar:prazo:v1', '',
  b => { const v = JSON.parse(b); return DATE_FILTERS.some(f => f.value === v) ? v : '' })

// ── Datas ────────────────────────────────────────────────────────────────────

const hojeBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const fmt = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—')

/** Dias até a data (negativo = atrasado); sem data vai para o fim. */
function prazo(data: string | null) {
  if (!data) return { dias: 9999 }
  const d = data.slice(0, 10)
  return { dias: Math.round(
    (new Date(d + 'T12:00:00').getTime() - new Date(hojeBR() + 'T12:00:00').getTime()) / 86400000) }
}

const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300'
const BTN = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors active:scale-[0.97] disabled:opacity-60 disabled:active:scale-100 ' + FOCO
const BTN_NEUTRO = BTN + ' bg-gray-100 text-gray-700 hover:bg-gray-200'
const BTN_OK = BTN + ' bg-emerald-600 text-[#fff] hover:bg-emerald-700'
const CHIP = 'text-[11px] font-medium px-2 py-0.5 rounded-full'

// ── Tipo de trabalho: a cor da barra à esquerda da linha ────────────────────

/**
 * As quatro regiões viraram TIPO (Rafael, 12/10): uma lista só, por data, e a
 * cor diz o que é. Cores fixas de propósito: não são cadastro da org como o
 * status, são a classificação da própria fila. Nenhuma repete os tons do prazo
 * (vermelho/laranja/âmbar), para a cor do tipo nunca ser lida como urgência.
 * Rotina é cinza: é o fundo da agenda, não o que pede atenção.
 */
const TIPOS: { chave: Regiao; label: string; barra: string; texto: string }[] = [
  { chave: 'implantar', label: 'Para implantar', barra: 'bg-sky-500',     texto: 'text-sky-700' },
  { chave: 'trabalho',  label: 'Em trabalho',    barra: 'bg-pink-500',    texto: 'text-pink-700' },
  { chave: 'peca',      label: 'Entrega',        barra: 'bg-emerald-500', texto: 'text-emerald-700' },
  { chave: 'rotina',    label: 'Rotina',         barra: 'bg-gray-300',    texto: 'text-gray-500' },
]
const TIPO = new Map(TIPOS.map(t => [t.chave, t]))
const SEM_OCULTOS: Regiao[] = []
/** Tipos escondidos pela legenda — por pessoa, no navegador. */
const prefOcultos = criarPrefLocal<Regiao[]>('flow:midia:trabalhar:ocultos:v1', SEM_OCULTOS, b => {
  const v = JSON.parse(b)
  return Array.isArray(v) ? v.filter((x): x is Regiao => TIPO.has(x)) : SEM_OCULTOS
})

// ── Faixas de data: os marcos de leitura da lista ───────────────────────────

type Faixa = 'atraso' | 'hoje' | 'amanha' | 'semana' | 'depois' | 'sem'
const FAIXA: Record<Faixa, { label: string; cls: string }> = {
  atraso: { label: 'Atrasado',        cls: 'text-red-700' },
  hoje:   { label: 'Hoje',            cls: 'text-orange-700' },
  amanha: { label: 'Amanhã',          cls: 'text-gray-700' },
  semana: { label: 'Próximos 7 dias', cls: 'text-gray-700' },
  depois: { label: 'Mais adiante',    cls: 'text-gray-500' },
  sem:    { label: 'Sem prazo',       cls: 'text-gray-500' },
}
function faixaDe(dias: number): Faixa {
  if (dias === 9999) return 'sem'
  if (dias < 0) return 'atraso'
  if (dias === 0) return 'hoje'
  if (dias === 1) return 'amanha'
  if (dias <= 7) return 'semana'
  return 'depois'
}

/** "seg 13/10" — o dia da semana é o que se usa para planejar a semana. */
function dataCurta(d: string | null) {
  if (!d) return '—'
  const dia = new Date(d.slice(0, 10) + 'T12:00:00')
    .toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' }).replace('.', '')
  return `${dia} ${fmt(d)}`
}

/**
 * A fila da mídia é UMA lista, em ordem de data (Rafael, 12/10 — os quatro
 * blocos confundiam: a mesma pergunta "o que faço agora?" tinha quatro
 * respostas em quatro lugares). O tipo virou cor: a barra à esquerda e a
 * legenda do cabeçalho, que também filtra. A data ganhou marcos (Atrasado,
 * Hoje, Amanhã, Próximos 7 dias, Mais adiante, Sem prazo) — divisórias dentro
 * da mesma lista, não blocos: a ordem continua sendo só a data.
 *
 * Uma linha por trabalho: entrega vinculada a uma tarefa que já está na fila
 * aparece só como entrega — o prazo do veículo é o que manda.
 *
 * ## A régua do que aparece (distill de 02/10, medido em produção)
 *  · **Rotina é densa** (data · nome · cliente · Feito): zero bandeira, zero
 *    checklist e 0,1 link em média em 32 de 50 linhas.
 *  · **O chip de status só aparece quando o TIPO mistura status** — em cada
 *    tipo havia um status só, e o chip repetia o rótulo do tipo.
 *  · **Bandeira e complexidade ficam**: raros, valem quando aparecem.
 * A linha mostra o que muda entre uma linha e outra; o que é igual para o grupo
 * pertence ao rótulo do grupo.
 */
export function Trabalhar({ orgSlug, itens, statusCfg, meuId }: {
  orgSlug: string
  itens: ItemFila[]
  statusCfg: StatusCfg[]
  meuId: string
}) {
  const cfg = useMemo(() => new Map(statusCfg.map(s => [s.valor, s])), [statusCfg])
  const [feitos, setFeitos] = useState<Set<string>>(new Set())
  // No servidor a fila nasce inteira e com todos os links; a preferência entra
  // depois da hidratação.
  const soEu = useSyncExternalStore(prefEu.assinar, prefEu.get, () => false)
  const links = useSyncExternalStore(prefLinks.assinar, prefLinks.get, () => LINKS_PADRAO)
  const prazoFiltro = useSyncExternalStore(prefPrazo.assinar, prefPrazo.get, () => '')
  const ocultos = useSyncExternalStore(prefOcultos.assinar, prefOcultos.get, () => SEM_OCULTOS)
  const hoje = hojeBR()

  // "Eu" = o que está comigo. Entrega sem tarefa não tem dono: é de quem opera,
  // então continua aparecendo. O prazo filtra com a régua da Lista.
  const base = useMemo(() => itens
    .filter(i => !feitos.has(i.chave))
    .filter(i => !soEu || i.assigneeIds.includes(meuId) || (i.tipo === 'entrega' && !i.activityId))
    .filter(i => matchesDateFilter(i.data, prazoFiltro, hoje)),
  [itens, feitos, soEu, meuId, prazoFiltro, hoje])
  // A legenda conta ANTES de esconder o tipo: quem desligou "Rotina" ainda vê
  // quantas estão lá.
  const porTipo = useMemo(() => {
    const m = new Map<Regiao, ItemFila[]>(TIPOS.map(t => [t.chave, []]))
    for (const i of base) m.get(i.regiao)?.push(i)
    return m
  }, [base])
  const lista = base.filter(i => !ocultos.includes(i.regiao))
  const filtrando = soEu || !!prazoFiltro || ocultos.length > 0
  const atrasados = lista.filter(i => prazo(i.data).dias < 0).length
  const hojeCount = lista.filter(i => prazo(i.data).dias === 0).length

  // O chip de status só informa quando o tipo mistura status (medido: não
  // misturava; o chip repetia o rótulo). Entrega mostra sempre, ver Linha.
  const variado = useMemo(() => new Set(
    TIPOS.filter(t => t.chave === 'peca' || new Set(porTipo.get(t.chave)!.map(i => i.status)).size > 1)
      .map(t => t.chave)),
  [porTipo])

  const concluir = (chave: string) => setFeitos(prev => new Set([...prev, chave]))
  const alternarTipo = (t: Regiao) =>
    prefOcultos.set(ocultos.includes(t) ? ocultos.filter(x => x !== t) : [...ocultos, t])

  // A lista já chega ordenada por data (page.tsx); aqui só se intercalam os marcos.
  const linhas: React.ReactNode[] = []
  let faixaAtual: Faixa | null = null
  for (const i of lista) {
    const f = faixaDe(prazo(i.data).dias)
    if (f !== faixaAtual) {
      faixaAtual = f
      const n = lista.filter(x => faixaDe(prazo(x.data).dias) === f).length
      linhas.push(
        <li key={`f:${f}`} aria-hidden
          className="flex items-baseline gap-2 px-4 pt-4 pb-1.5 first:pt-3 bg-gray-50/70">
          <span className={cn('text-[11px] font-semibold uppercase tracking-wide', FAIXA[f].cls)}>{FAIXA[f].label}</span>
          <span className="text-[11px] tabular-nums text-gray-400">{n}</span>
        </li>,
      )
    }
    linhas.push(
      <Linha key={i.chave} orgSlug={orgSlug} item={i} cfg={cfg} links={links} onFeito={concluir}
        faixa={f} densa={i.regiao === 'rotina'} mostrarStatus={variado.has(i.regiao)} />,
    )
  }

  return (
    <div className="p-6 max-w-5xl">
      <Cabecalho orgSlug={orgSlug} atrasados={atrasados} hoje={hojeCount} total={lista.length}
        soEu={soEu} onEu={() => prefEu.set(!soEu)}
        links={links} onLinks={prefLinks.set}
        prazo={prazoFiltro} onPrazo={prefPrazo.set} />

      {/* Legenda = filtro: a cor se explica onde se escolhe o que ver. */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Tipos de trabalho">
        {TIPOS.map(t => {
          const ligado = !ocultos.includes(t.chave)
          const n = porTipo.get(t.chave)!.length
          return (
            <button key={t.chave} type="button" onClick={() => alternarTipo(t.chave)} aria-pressed={ligado}
              title={ligado ? `Esconder ${t.label.toLowerCase()}` : `Mostrar ${t.label.toLowerCase()}`}
              className={cn('inline-flex items-center gap-2 pl-2.5 pr-3 py-1.5 text-xs font-medium rounded-full border transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.97]', FOCO,
                ligado ? 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                  : 'bg-transparent border-dashed border-gray-300 text-gray-400 hover:text-gray-600')}>
              <span className={cn('w-2 h-2 rounded-full transition-opacity duration-150', t.barra, !ligado && 'opacity-30')} aria-hidden />
              {t.label}
              <span className="tabular-nums text-gray-400">{n}</span>
            </button>
          )
        })}
      </div>

      {lista.length === 0 ? (
        <div className="text-center py-20 bg-white border border-gray-200 rounded-2xl mt-4">
          <PartyPopper className="w-8 h-8 text-emerald-600 mx-auto" />
          <p className="text-sm text-gray-600 mt-3">
            {filtrando ? 'Nada com esse filtro. Religue os tipos, limpe o prazo ou desligue o "Eu".'
              : 'Fila limpa. Nada esperando por você.'}
          </p>
        </div>
      ) : (
        <ul className="mt-4 bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden"
          aria-label="Fila da mídia, por data">
          {linhas}
        </ul>
      )}
    </div>
  )
}

/** Pílulas de prazo — o mesmo conjunto da Lista, guardado por pessoa no navegador. */
function FiltroPrazo({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-3 inline-flex flex-wrap bg-gray-100 rounded-xl p-0.5" role="group" aria-label="Filtro de prazo">
      {DATE_FILTERS.map(f => (
        <button key={f.value} type="button" onClick={() => onChange(f.value)} aria-pressed={valor === f.value}
          className={cn('px-3 py-1.5 text-xs font-medium rounded-[10px] transition-colors', FOCO,
            valor === f.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
          {f.label}
        </button>
      ))}
    </div>
  )
}

function Cabecalho({ orgSlug, atrasados, hoje, total, soEu, onEu, links, onLinks, prazo, onPrazo }: {
  orgSlug: string; atrasados: number; hoje: number; total: number
  soEu: boolean; onEu: () => void
  links: LinksVisiveis; onLinks: (v: LinksVisiveis) => void
  prazo: string; onPrazo: (v: string) => void
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
        <p className="text-gray-500 text-sm mt-0.5">{partes.join(' · ')}</p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onEu} aria-pressed={soEu} title="Só o que está comigo"
          className={cn('px-3 py-1.5 text-xs font-medium rounded-full border transition-colors active:scale-[0.97]', FOCO,
            soEu ? 'bg-orange-500 border-orange-500 text-[#fff]' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>
          Eu
        </button>
        <MenuLinks links={links} onChange={onLinks} />
        <Link href={`/${orgSlug}/midia/visao-geral`}
          className={cn('inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors', FOCO)}>
          Visão geral <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* O filtro é controle da fila: mora na faixa do cabeçalho, com ela. */}
      <div className="w-full order-last">
        <FiltroPrazo valor={prazo} onChange={onPrazo} />
      </div>
    </div>
  )
}

/** Quais links aparecem nas linhas — escolha de cada pessoa, no navegador dela. */
function MenuLinks({ links, onChange }: { links: LinksVisiveis; onChange: (v: LinksVisiveis) => void }) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    function fora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    function esc(e: KeyboardEvent) { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])

  const ativos = LINKS.filter(l => links[l.chave]).length

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setAberto(o => !o)} aria-haspopup="menu" aria-expanded={aberto}
        title="Quais links mostrar nas linhas"
        className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors active:scale-[0.97]', FOCO,
          aberto ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>
        <Link2 className="w-3.5 h-3.5" /> Links
        {ativos < LINKS.length && <span className="text-gray-500 tabular-nums">{ativos}/{LINKS.length}</span>}
      </button>
      {aberto && (
        <div role="menu" className="pop-in absolute right-0 mt-2 w-56 bg-white rounded-xl border border-gray-200 py-2 z-30">
          <p className="px-3 pb-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100 mb-1">
            Mostrar nas linhas
          </p>
          {LINKS.map(l => (
            <button key={l.chave} type="button" role="menuitemcheckbox" aria-checked={links[l.chave]}
              onClick={() => onChange({ ...links, [l.chave]: !links[l.chave] })}
              className={cn('flex items-center justify-between w-full px-3 py-2 text-sm text-gray-700 text-left hover:bg-gray-50 transition-colors', FOCO)}>
              <span>{l.label}</span>
              <span className={cn('w-4 h-4 rounded border flex items-center justify-center transition-colors',
                links[l.chave] ? 'bg-orange-600 border-orange-600' : 'border-gray-300')}>
                {links[l.chave] && <Check className="w-2.5 h-2.5 text-[#fff]" strokeWidth={3} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Linha({ orgSlug, item, cfg, links, faixa, densa = false, mostrarStatus = false, onFeito }: {
  orgSlug: string
  item: ItemFila
  /** O marco de data em que a linha está — pinta a data quando é agora. */
  faixa: Faixa
  cfg: Map<string, StatusCfg>
  links: LinksVisiveis
  /** Rotina: repetitiva por natureza, lida como agenda — sem links nem status. */
  densa?: boolean
  /** Só quando a região mistura status; senão o chip repete o título da coluna. */
  mostrarStatus?: boolean
  onFeito: (chave: string) => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirmar, setConfirmar] = useState(false)
  const [desdobrar, setDesdobrar] = useState(false)
  const p = prazo(item.data)
  const st = item.status ? cfg.get(item.status) : null
  const prio = PRIORITY_CONFIG[item.prioridade as ActivityPriority]
  const compl = COMPLEXITY_CONFIG[item.complexidade as ActivityComplexity]

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

  function feitoItem() {
    start(async () => {
      const r = await marcarItemChecklist(orgSlug, item.activityId!, item.item!.id)
      if (r.error) { toast.error(r.error); return }
      if (r.restantes === 0) toast.success('Último item feito. A tarefa voltou para a fila.')
      else toast.success(`Feito. ${r.restantes === 1 ? 'Falta 1 item datado.' : `Faltam ${r.restantes} itens datados.`}`)
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

  // Quem pediu e desde quando — só faz sentido no pedido; a rotina é do catálogo.
  const origem = item.tipo === 'pedido'
    ? [
        item.pedidoPor ? `pedido por ${item.pedidoPor}` : null,
        item.entrouEm ? `entrou ${fmt(item.entrouEm)}` : item.criadaEm ? `criada ${fmt(item.criadaEm)}` : null,
      ].filter(Boolean).join(' · ')
    : ''
  // A linha é para DECIDIR o que fazer agora, não para executar (Rafael, 23/09).
  // Ficam fora: a especificação (detalhe de execução — está na tarefa e no aviso
  // dentro dela) e o contato do veículo, que só serve na hora de enviar e por isso
  // aparece apenas quando a peça já está pronta para ir.
  const prontaParaEnviar = item.tipo === 'entrega' && !!item.entregaId && !item.esperandoCriacao
  // Veículo e formato saem quando o título já os diz — é o caso comum
  // ("Anúncio Página Dupla - Revista Dife" repetia os dois logo abaixo).
  const noTitulo = (v: string | null) =>
    !!v && item.titulo.toLowerCase().includes(v.toLowerCase())
  const meta = [
    item.cliente,
    noTitulo(item.veiculo) ? null : item.veiculo,
    noTitulo(item.formato) ? null : item.formato,
    prontaParaEnviar ? item.veiculoContato : null,
    item.frequencia ? (FREQ[item.frequencia] ?? item.frequencia) : null,
    origem || null,
  ].filter(Boolean).join(' · ')

  // Só o ícone que DISTINGUE dentro do tipo: o post datado, que mora junto dos
  // pedidos.
  const Icone = item.item ? ListChecks : null
  const tipo = TIPO.get(item.regiao)!

  return (
    <li className={cn('relative pl-4 pr-3 transition-colors duration-150 hover:bg-gray-50/70', densa ? 'py-2' : 'py-2.5')}>
      {/* O tipo é a barra: lida de relance na coluna inteira, sem ocupar a linha. */}
      <span className={cn('absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full', tipo.barra)} aria-hidden />
      <div className="flex items-start gap-3">
        {/* Sem pílula: o marco acima já diz "Atrasado"/"Hoje"; a data só ganha a
            cor dele. Largura fixa para alinhar na coluna. */}
        <span className={cn('shrink-0 w-[4.5rem] pt-0.5 text-[11px] tabular-nums',
          faixa === 'atraso' ? 'font-medium text-red-700' : faixa === 'hoje' ? 'font-medium text-orange-700' : 'text-gray-500')}
          title={p.dias < 0 ? `Atrasado há ${-p.dias} dia${p.dias < -1 ? 's' : ''}` : undefined}>
          {dataCurta(item.data)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
            {Icone && <Icone className="w-3.5 h-3.5 text-gray-400 shrink-0" aria-hidden />}
            {linkTarefa ? (
              <Link href={linkTarefa}
                className={cn('text-sm font-medium text-gray-900 hover:text-orange-600 transition-colors rounded', FOCO)}>
                {item.titulo}
              </Link>
            ) : (
              <span className="text-sm font-medium text-gray-900">{item.titulo}</span>
            )}
            {item.item && (
              <>
                <span className="text-gray-300" aria-hidden>·</span>
                <span className="font-medium text-gray-900 text-sm">{item.item.texto}</span>
              </>
            )}
            {item.item && p.dias >= 0 && p.dias <= JANELA_AGENDAMENTO && (
              <span className={cn(CHIP, 'bg-sky-50 text-sky-700')}
                title={`Dentro dos ${JANELA_AGENDAMENTO} dias que o planejador aceita`}>
                dá para agendar
              </span>
            )}
            {/* Na entrega, o status da tarefa só interessa enquanto a peça está com
                a criação; depois, o que a mídia precisa saber é que está pronta. */}
            {st && mostrarStatus && !(item.tipo === 'entrega' && !item.esperandoCriacao) && (
              <span className={CHIP} style={{ backgroundColor: st.bg, color: st.txt }}>{st.label}</span>
            )}
            {item.tipo === 'entrega' && item.activityId && !item.esperandoCriacao && (
              <span className={cn(CHIP, 'bg-emerald-50 text-emerald-700')}>material pronto</span>
            )}
            {item.esperandoCriacao && (
              <span className={cn(CHIP, 'bg-amber-50 text-amber-700')}>com a criação</span>
            )}
            {item.tipo !== 'rotina' && prio?.preenchido && (
              <span className={cn(CHIP, 'inline-flex items-center gap-1', prio.bgColor, prio.color)}>
                <Flag className="w-3 h-3" fill="currentColor" aria-hidden /> {prio.label}
              </span>
            )}
            {item.tipo !== 'rotina' && item.complexidade === 'complex' && compl && (
              <span className={cn(CHIP, 'bg-red-50', compl.color)}>{compl.label}</span>
            )}
            {item.checklist && (
              <span className={cn(CHIP, 'inline-flex items-center gap-1 bg-gray-100 text-gray-600 tabular-nums')}
                title="Itens do checklist feitos">
                <ListChecks className="w-3 h-3" aria-hidden /> {item.checklist.feitos}/{item.checklist.total}
              </span>
            )}
          </div>

          {/* O tipo também por escrito: a cor sozinha não chega a quem não a distingue. */}
          <p className="text-[11px] text-gray-500 mt-0.5 truncate" title={meta ? `${tipo.label} · ${meta}` : tipo.label}>
            <span className={cn('font-medium', tipo.texto)}>{tipo.label}</span>
            {meta && <> · {meta}</>}
          </p>

          {item.conflito && (
            <p className="text-[11px] text-red-700 mt-1 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden /> A criação prometeu para depois do envio.
            </p>
          )}

          {/* Rotina não tem links na prática (0,1 por item, medido) — o bloco só
              ocupava altura em 32 linhas. */}
          {!densa && <Links item={item} links={links} />}
        </div>

        <div className="shrink-0">
          {item.entregaId ? (
            <button onClick={enviar} disabled={pending} className={BTN_OK}>
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Enviei ao veículo
            </button>
          ) : item.item && item.activityId ? (
            <button onClick={feitoItem} disabled={pending} className={BTN_NEUTRO}>
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Feito
            </button>
          ) : item.activityId ? (
            <div className="flex items-center gap-1.5">
              {item.tipo === 'pedido' && (
                <button onClick={() => setDesdobrar(true)} disabled={pending} className={BTN_NEUTRO}
                  title="Desdobrar em datas: uma linha por post, cada uma com a data dela">
                  <ListChecks className="w-3.5 h-3.5" /> Datas
                </button>
              )}
              <button onClick={feito} disabled={pending} className={BTN_NEUTRO}>
                {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Feito
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {desdobrar && item.activityId && (
        <ModalDesdobrar orgSlug={orgSlug} item={item} onClose={() => setDesdobrar(false)} />
      )}

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
    </li>
  )
}

const CAMPO = 'w-full mt-0.5 bg-gray-100 border border-transparent rounded-xl px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:bg-white focus:border-orange-300 focus:outline-none transition-colors'

/**
 * Desdobrar um pedido em datas, direto da fila: cola-se a lista (uma linha por
 * post, data na frente) e cada linha vira item datado do checklist da tarefa.
 * A lista do briefing vem com o mês como título ("MARÇO") — linha sem data nasce
 * desmarcada, e data que já passou também; é só clicar para incluir.
 */
function ModalDesdobrar({ orgSlug, item, onClose }: { orgSlug: string; item: ItemFila; onClose: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [texto, setTexto] = useState('')
  const [ano, setAno] = useState(item.titulo.match(/\b(20\d{2})\b/)?.[1] ?? hojeBR().slice(0, 4))
  const [alternadas, setAlternadas] = useState<Set<string>>(new Set())
  const [ajustar, setAjustar] = useState(true)
  const hoje = hojeBR()

  const linhas = useMemo(() => {
    const anoNum = Number(ano)
    return texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
      const r = lerLinhaComData(l, anoNum >= 2000 && anoNum <= 2100 ? anoNum : undefined)
      const chave = `${r.data ?? ''}|${r.text}`
      const padrao = !!r.data && r.data >= hoje
      const incluida = alternadas.has(chave) ? !padrao : padrao
      return { ...r, chave, passou: !!r.data && r.data < hoje, incluida }
    })
  }, [texto, ano, alternadas, hoje])

  const selecionadas = linhas.filter(l => l.incluida)
  const ultima = selecionadas.map(l => l.data).filter(Boolean).sort().at(-1) ?? null
  const podeAjustar = !!ultima && (!item.data || ultima > item.data)

  function alternar(chave: string) {
    setAlternadas(prev => {
      const n = new Set(prev)
      if (n.has(chave)) n.delete(chave); else n.add(chave)
      return n
    })
  }

  function salvar() {
    if (!selecionadas.length) { toast.error('Marque pelo menos uma linha.'); return }
    start(async () => {
      const r = await desdobrarEmDatas(orgSlug, item.activityId!,
        selecionadas.map(l => ({ text: l.text, data: l.data })), ajustar && podeAjustar)
      if ('error' in r && r.error) { toast.error(r.error); return }
      const n = r.adicionados ?? 0
      toast.success(`${n} ${n === 1 ? 'item entrou' : 'itens entraram'} nas peças a entregar`
        + (r.novoPrazo ? ` · prazo da tarefa ajustado para ${fmt(r.novoPrazo)}` : '') + '.')
      onClose()
      router.refresh()
    })
  }

  return (
    <Modal open onClose={onClose} size="lg" label="Desdobrar em datas" dismissOnBackdrop={false} dismissable={!pending}>
      <ModalHeader title="Desdobrar em datas" onClose={onClose} />
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-gray-600">
          <span className="font-medium text-gray-900">{item.titulo}</span> — uma linha por post, com a data na
          frente. Cada data vira uma linha própria na fila; a tarefa continua uma só.
        </p>

        <div className="grid sm:grid-cols-[1fr_7rem] gap-3">
          <label className="block">
            <span className="text-[11px] text-gray-500">Lista (cole do briefing)</span>
            <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={7} autoFocus
              placeholder={'10/05 Dia das Mães\n12/06 Dia dos Namorados\n25/12 Natal'}
              className={cn(CAMPO, 'font-mono text-[13px] leading-relaxed resize-y')} />
          </label>
          <label className="block">
            <span className="text-[11px] text-gray-500">Ano (datas sem ano)</span>
            <input type="number" inputMode="numeric" value={ano} onChange={e => setAno(e.target.value)}
              min={2000} max={2100} className={cn(CAMPO, 'tabular-nums')} />
          </label>
        </div>

        {linhas.length > 0 && (
          <ul className="max-h-60 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100" aria-label="Linhas lidas">
            {linhas.map((l, i) => (
              <li key={`${l.chave}-${i}`}>
                <button type="button" role="checkbox" aria-checked={l.incluida} onClick={() => alternar(l.chave)}
                  className={cn('flex items-center gap-3 w-full px-3 py-2 text-left text-sm hover:bg-gray-50 transition-colors', FOCO,
                    !l.incluida && 'text-gray-400')}>
                  <span className={cn('w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors',
                    l.incluida ? 'bg-orange-600 border-orange-600' : 'border-gray-300')}>
                    {l.incluida && <Check className="w-2.5 h-2.5 text-[#fff]" strokeWidth={3} />}
                  </span>
                  <span className={cn('shrink-0 w-[6.75rem] text-center rounded-lg px-2 py-0.5 text-[11px] font-medium tabular-nums',
                    !l.data ? 'bg-gray-100 text-gray-500' : l.passou ? 'bg-amber-50 text-amber-700' : 'bg-orange-50 text-orange-700')}>
                    {!l.data ? 'sem data' : l.passou ? `${fmt(l.data)} · passou` : fmt(l.data)}
                  </span>
                  <span className="min-w-0 truncate">{l.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {podeAjustar && (
          <button type="button" role="checkbox" aria-checked={ajustar} onClick={() => setAjustar(a => !a)}
            className={cn('flex items-center gap-2.5 text-sm text-gray-700 rounded-lg px-1 -mx-1 py-1', FOCO)}>
            <span className={cn('w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors',
              ajustar ? 'bg-orange-600 border-orange-600' : 'border-gray-300')}>
              {ajustar && <Check className="w-2.5 h-2.5 text-[#fff]" strokeWidth={3} />}
            </span>
            Ajustar o prazo da tarefa para {fmt(ultima)}{item.data ? ` (hoje ${fmt(item.data)})` : ''}
          </button>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={pending}
            className={cn('px-3.5 py-2 text-sm font-medium rounded-xl text-gray-600 hover:bg-gray-100 transition-colors', FOCO)}>
            Cancelar
          </button>
          <button type="button" onClick={salvar} disabled={pending || selecionadas.length === 0}
            className={cn('inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors disabled:opacity-60', FOCO)}>
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListChecks className="w-4 h-4" />}
            Desdobrar {selecionadas.length > 0 ? selecionadas.length : ''}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Os links de trabalho da linha: só os que existem E que a pessoa quer ver. */
function Links({ item, links }: { item: ItemFila; links: LinksVisiveis }) {
  const externos = [
    links.redacao && item.redacaoUrl ? { url: item.redacaoUrl, label: 'Redação' } : null,
    links.preview && item.previewUrl ? { url: item.previewUrl, label: 'Preview' } : null,
    links.final && item.finalUrl ? { url: item.finalUrl, label: 'Final' } : null,
  ].filter(Boolean) as { url: string; label: string }[]
  const pasta = links.pasta ? (item.pastaPath ? 'caminho' : item.pastaUrl ? 'drive' : null) : null
  if (externos.length === 0 && !pasta) return null

  // Texto, não pílula: com até 4 por linha a faixa de chips competia com o
  // título. Link é destino, não ação — a ação é o botão à direita.
  const cls = cn('inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-orange-600 underline-offset-2 hover:underline transition-colors rounded', FOCO)

  return (
    <div className="flex items-center gap-3 flex-wrap mt-1">
      {externos.map(l => (
        <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" className={cls}>
          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden /> {l.label}
        </a>
      ))}
      {/* Rótulo, não o caminho inteiro: o caminho ocupava a linha toda e não é
          informação de decisão — clicar copia, e o caminho fica no tooltip. */}
      {pasta === 'caminho' && <MachinePath winPath={item.pastaPath!} compact rotulo="Pasta" />}
      {pasta === 'drive' && (
        <a href={item.pastaUrl!} target="_blank" rel="noopener noreferrer" className={cls}>
          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden /> Pasta
        </a>
      )}
    </div>
  )
}
