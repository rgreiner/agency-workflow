'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, ExternalLink, Flag, Link2, ListChecks, Loader2,
  PartyPopper, Repeat, Send, Truck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PRIORITY_CONFIG, COMPLEXITY_CONFIG, type ActivityPriority, type ActivityComplexity } from '@/types'
import { MachinePath } from '@/components/ui/MachinePath'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { lerLinhaComData } from '@/lib/checklist-datas'
import { concluirTarefaMidia, desdobrarEmDatas, marcarItemChecklist, mudarSituacaoEntrega } from '@/app/actions/midia-hub'

/** Onde a linha mora: trabalhos solicitados (cima), peças a entregar (esquerda), rotinas (direita). */
export type Regiao = 'solicitado' | 'peca' | 'rotina'

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
  weekly: 'semanal', biweekly: 'quinzenal', monthly: 'mensal',
  bimonthly: 'bimestral', quarterly: 'trimestral', semiannual: 'semestral', annual: 'anual',
}

/** Quantos dias antes o planejador de posts aceita agendar (Meta: 28) — só para o chip. */
const JANELA_AGENDAMENTO = 28

// ── Preferências locais (por navegador), lidas sem setState em effect ────────
// Versionar a chave quando o default mudar.

type ChaveLink = 'redacao' | 'preview' | 'final' | 'pasta'
type LinksVisiveis = Record<ChaveLink, boolean>
const LINKS: { chave: ChaveLink; label: string }[] = [
  { chave: 'redacao', label: 'Redação' },
  { chave: 'preview', label: 'Preview' },
  { chave: 'final',   label: 'Final' },
  { chave: 'pasta',   label: 'Pasta do Drive' },
]
const LINKS_PADRAO: LinksVisiveis = { redacao: true, preview: true, final: true, pasta: true }

function criarPref<T>(chave: string, padrao: T, ler: (bruto: string) => T) {
  const ouvintes = new Set<() => void>()
  // useSyncExternalStore exige snapshot estável enquanto nada mudou: o cache
  // devolve o mesmo objeto para o mesmo texto gravado.
  let cache: { bruto: string | null; valor: T } | null = null
  const get = (): T => {
    let bruto: string | null = null
    try { bruto = localStorage.getItem(chave) } catch { /* sem storage */ }
    if (cache && cache.bruto === bruto) return cache.valor
    let valor = padrao
    if (bruto != null) { try { valor = ler(bruto) } catch { valor = padrao } }
    cache = { bruto, valor }
    return valor
  }
  const set = (valor: T) => {
    try { localStorage.setItem(chave, JSON.stringify(valor)) } catch { /* sem storage */ }
    ouvintes.forEach(f => f())
  }
  const assinar = (cb: () => void) => { ouvintes.add(cb); return () => { ouvintes.delete(cb) } }
  return { get, set, assinar, padrao }
}

const prefEu = criarPref<boolean>('flow:midia:trabalhar:eu:v1', false,
  b => b === '1' || b === 'true')
const prefLinks = criarPref<LinksVisiveis>('flow:midia:trabalhar:links:v1', LINKS_PADRAO,
  b => ({ ...LINKS_PADRAO, ...(JSON.parse(b) as Partial<LinksVisiveis>) }))

// ── Datas ────────────────────────────────────────────────────────────────────

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
  neutro: 'text-gray-600 bg-gray-100',
}

const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300'
const BTN = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors active:scale-[0.97] disabled:opacity-60 disabled:active:scale-100 ' + FOCO
const BTN_NEUTRO = BTN + ' bg-gray-100 text-gray-700 hover:bg-gray-200'
const BTN_OK = BTN + ' bg-emerald-600 text-[#fff] hover:bg-emerald-700'
const CHIP = 'text-[11px] font-medium px-2 py-0.5 rounded-full'

/**
 * A fila da mídia em três regiões (decisão do Rafael, 04/09): **Trabalhos
 * solicitados** em cima, ocupando a largura — é onde o pedido grande precisa de
 * espaço; **Peças a entregar** à esquerda (entrega ao veículo e post datado);
 * **Rotinas** à direita, em linhas compactas. Dentro de cada região a ordem é a
 * data. Todo item mostra os links de trabalho (Redação, Preview, Final, pasta);
 * cada pessoa esconde os que não usa. O painel (Visão geral) continua existindo
 * para o retrato da operação; aqui não entra KPI nem radar.
 *
 * Uma linha por trabalho: entrega vinculada a uma tarefa que já está na fila
 * aparece só como entrega — o prazo do veículo é o que manda.
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

  // "Eu" = o que está comigo. Entrega sem tarefa não tem dono: é de quem opera,
  // então continua aparecendo.
  const lista = useMemo(() => itens
    .filter(i => !feitos.has(i.chave))
    .filter(i => !soEu || i.assigneeIds.includes(meuId) || (i.tipo === 'entrega' && !i.activityId)),
  [itens, feitos, soEu, meuId])
  const atrasados = lista.filter(i => prazo(i.data).dias < 0).length
  const hoje = lista.filter(i => prazo(i.data).dias === 0).length

  const solicitados = lista.filter(i => i.regiao === 'solicitado')
  const pecas = lista.filter(i => i.regiao === 'peca')
  const rotinas = lista.filter(i => i.regiao === 'rotina')

  const concluir = (chave: string) => setFeitos(prev => new Set([...prev, chave]))
  const comum = { orgSlug, cfg, links, onFeito: concluir }

  return (
    <div className="p-6">
      <Cabecalho orgSlug={orgSlug} atrasados={atrasados} hoje={hoje} total={lista.length}
        soEu={soEu} onEu={() => prefEu.set(!soEu)}
        links={links} onLinks={prefLinks.set} />

      {lista.length === 0 ? (
        <div className="text-center py-20 bg-white border border-gray-200 rounded-2xl mt-6">
          <PartyPopper className="w-8 h-8 text-emerald-600 mx-auto" />
          <p className="text-sm text-gray-600 mt-3">
            {soEu ? 'Nada com você. Desligue o "Eu" para ver a fila inteira.' : 'Fila limpa. Nada esperando por você.'}
          </p>
        </div>
      ) : (
        <>
          <Regiao className="mt-6" titulo="Trabalhos solicitados" contagem={solicitados.length}
            vazio="Nenhum trabalho solicitado em aberto.">
            {solicitados.map(i => <Linha key={i.chave} item={i} variante="card" {...comum} />)}
          </Regiao>

          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-6">
            <Regiao className="lg:col-span-7" titulo="Peças a entregar" contagem={pecas.length}
              vazio="Nenhuma peça a entregar.">
              {pecas.map(i => <Linha key={i.chave} item={i} variante="linha" {...comum} />)}
            </Regiao>
            <Regiao className="lg:col-span-5" titulo="Rotinas" contagem={rotinas.length}
              vazio="Nenhuma rotina em aberto.">
              {rotinas.map(i => <Linha key={i.chave} item={i} variante="compacta" {...comum} />)}
            </Regiao>
          </div>
        </>
      )}
    </div>
  )
}

function Regiao({ titulo, contagem, vazio, className, children }: {
  titulo: string; contagem: number; vazio: string; className?: string; children: React.ReactNode
}) {
  return (
    <section className={cn('min-w-0', className)} aria-label={titulo}>
      <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
        {titulo} <span className="text-gray-500 font-normal">· {contagem}</span>
      </h2>
      {contagem === 0 ? (
        <p className="text-sm text-gray-400 text-center border border-dashed border-gray-200 rounded-xl px-4 py-6">{vazio}</p>
      ) : (
        <ul className="space-y-1.5">{children}</ul>
      )}
    </section>
  )
}

function Cabecalho({ orgSlug, atrasados, hoje, total, soEu, onEu, links, onLinks }: {
  orgSlug: string; atrasados: number; hoje: number; total: number
  soEu: boolean; onEu: () => void
  links: LinksVisiveis; onLinks: (v: LinksVisiveis) => void
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

function Linha({ orgSlug, item, cfg, links, variante, onFeito }: {
  orgSlug: string
  item: ItemFila
  cfg: Map<string, StatusCfg>
  links: LinksVisiveis
  variante: 'card' | 'linha' | 'compacta'
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
  const compacta = variante === 'compacta'

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
  const meta = [
    item.cliente,
    item.veiculo,
    item.veiculoContato,
    item.frequencia ? (FREQ[item.frequencia] ?? item.frequencia) : null,
    origem || null,
  ].filter(Boolean).join(' · ')

  const Icone = item.tipo === 'entrega' ? Truck : item.item ? ListChecks : item.tipo === 'rotina' ? Repeat : null

  return (
    <li className={cn('bg-white border rounded-xl',
      variante === 'card' ? 'rounded-2xl p-4' : compacta ? 'px-3 py-2.5' : 'px-4 py-3',
      item.conflito ? 'border-red-200' : 'border-gray-200')}>
      <div className="flex items-start gap-3">
        <span className={cn('shrink-0 inline-flex items-center justify-center rounded-lg text-[11px] font-medium tabular-nums px-2 py-1',
          compacta ? 'w-[6rem]' : 'w-[6.75rem]', TOM[p.tom])}>
          {p.texto}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
            {Icone && <Icone className="w-3.5 h-3.5 text-gray-400 shrink-0" aria-hidden />}
            {linkTarefa ? (
              <Link href={linkTarefa}
                className={cn('font-medium text-gray-900 hover:text-orange-600 transition-colors rounded', FOCO,
                  variante === 'card' ? 'text-base' : 'text-sm')}>
                {item.titulo}
              </Link>
            ) : (
              <span className={cn('font-medium text-gray-900', variante === 'card' ? 'text-base' : 'text-sm')}>
                {item.titulo}
              </span>
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
            {st && !compacta && !(item.tipo === 'entrega' && !item.esperandoCriacao) && (
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

          <p className="text-[11px] text-gray-500 mt-0.5 truncate" title={meta}>{meta}</p>

          {item.conflito && (
            <p className="text-[11px] text-red-700 mt-1 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden /> A criação prometeu para depois do envio.
            </p>
          )}

          <Links item={item} links={links} compacta={compacta} />
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
function Links({ item, links, compacta }: { item: ItemFila; links: LinksVisiveis; compacta: boolean }) {
  const externos = [
    links.redacao && item.redacaoUrl ? { url: item.redacaoUrl, label: 'Redação' } : null,
    links.preview && item.previewUrl ? { url: item.previewUrl, label: 'Preview' } : null,
    links.final && item.finalUrl ? { url: item.finalUrl, label: 'Final' } : null,
  ].filter(Boolean) as { url: string; label: string }[]
  const pasta = links.pasta ? (item.pastaPath ? 'caminho' : item.pastaUrl ? 'drive' : null) : null
  if (externos.length === 0 && !pasta) return null

  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', compacta ? 'mt-1.5' : 'mt-2')}>
      {externos.map(l => (
        <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer"
          className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-50 text-[11px] font-medium text-gray-600 hover:bg-orange-50 hover:text-orange-700 transition-colors', FOCO)}>
          <ExternalLink className="w-3 h-3" aria-hidden /> {l.label}
        </a>
      ))}
      {pasta === 'caminho' && (
        <div className="min-w-0 max-w-full"><MachinePath winPath={item.pastaPath!} compact /></div>
      )}
      {pasta === 'drive' && (
        <a href={item.pastaUrl!} target="_blank" rel="noopener noreferrer"
          className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-50 text-[11px] font-medium text-gray-600 hover:bg-orange-50 hover:text-orange-700 transition-colors', FOCO)}>
          <ExternalLink className="w-3 h-3" aria-hidden /> Pasta
        </a>
      )}
    </div>
  )
}
