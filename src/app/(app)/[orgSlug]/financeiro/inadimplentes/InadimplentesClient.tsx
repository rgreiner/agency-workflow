'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ChevronRight, Search, ArrowDownCircle, ArrowUpCircle, Mail, Send, CalendarClock,
  Link2, Loader2, Check, X, Settings2, BellRing, BellOff, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import {
  cobrarAgora, setPromessaPagamento, vincularClienteContato,
  setCobrancaConfig, setClienteCobrancaAuto,
} from '@/app/actions/cobranca'

export interface AbertoItem {
  id: string
  /** null = linha do extrato importado ainda não promovida — não dá pra cobrar. */
  lancamentoId: string | null
  tipo: 'entrada' | 'saida'
  contato: string
  /**
   * Cliente do Flow ligado a ESTA GRAFIA de contato, por alias explícito
   * (cliente_aliases). Só isto agrupa e só isto habilita cobrança — o cliente do
   * documento de origem NÃO entra aqui: ele é centro de custo, não devedor.
   */
  clienteId: string | null
  /** Cliente do job (centro de custo), quando difere de quem paga. Só contexto. */
  centroCusto: string | null
  descricao: string | null
  categoria: string | null
  vencimento: string | null
  /** O que FALTA (valor cheio − baixa parcial) — é o que se cobra. */
  valor: number
  valorCheio: number
  parcial: boolean
  promessaData: string | null
  promessaObs: string | null
  ultimoAviso: { data: string; canal: string; bucket: string } | null
}
export interface ClienteInfo { id: string; nome: string; financeEmail: string | null; cobrancaAuto: boolean }
export interface ReguaInfo { ativa: boolean; degraus: number[]; temPaymentInfo: boolean; clientesLigados: number }

const diasAtraso = (venc: string | null, today: string) => {
  if (!venc || venc >= today) return 0
  const a = Date.UTC(+venc.slice(0, 4), +venc.slice(5, 7) - 1, +venc.slice(8, 10))
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}
const rotuloDegrau = (d: number) => (d < 0 ? `D${d}` : d === 0 ? 'D0' : `D+${d}`)
const dataCurta = (iso: string) => formatDateBR(iso.slice(0, 10))

interface Grupo {
  chave: string
  contato: string
  cliente: ClienteInfo | null
  itens: AbertoItem[]
  subtotal: number
  maxAtraso: number
  ultimoAviso: AbertoItem['ultimoAviso']
}

export function InadimplentesClient({ orgSlug, itens, today, clientes, regua }: {
  orgSlug: string; itens: AbertoItem[]; today: string; clientes: ClienteInfo[]; regua: ReguaInfo
}) {
  const [tipo, setTipo] = useState<'entrada' | 'saida'>('entrada')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [configOpen, setConfigOpen] = useState(false)
  const [cobrando, setCobrando] = useState<Grupo | null>(null)
  const [promessaDe, setPromessaDe] = useState<AbertoItem | null>(null)
  const [vinculando, setVinculando] = useState<Grupo | null>(null)

  const clientePorId = useMemo(() => new Map(clientes.map(c => [c.id, c])), [clientes])

  // Só o que está VENCIDO (atrasado) — é o que caracteriza inadimplência.
  const atrasados = useMemo(() => itens.filter(i => diasAtraso(i.vencimento, today) > 0), [itens, today])

  const totais = useMemo(() => {
    let receber = 0, pagar = 0
    for (const i of atrasados) { if (i.tipo === 'entrada') receber += i.valor; else pagar += i.valor }
    return { receber, pagar }
  }, [atrasados])

  const grupos = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtrados = atrasados.filter(i => {
      if (i.tipo !== tipo) return false
      if (q && !`${i.contato} ${i.descricao ?? ''} ${i.categoria ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
    // Agrupa por QUEM PAGA. Antes agrupava pelo cliente do documento de origem, e aí
    // uma comissão de produção devida pela Positiva aparecia como se fosse dívida da
    // Comil — a Comil é o centro de custo do job, não a devedora. O único caminho que
    // troca o nome do grupo é o alias explícito (contato "Opera Ltda" → cliente
    // "Opera"), que é a pessoa dizendo que as duas grafias são o mesmo pagador.
    const map = new Map<string, Grupo>()
    for (const i of filtrados) {
      const cliente = i.clienteId ? clientePorId.get(i.clienteId) ?? null : null
      const chave = cliente ? `ws:${cliente.id}` : `nome:${i.contato}`
      const g = map.get(chave) ?? {
        chave, contato: cliente?.nome ?? i.contato, cliente,
        itens: [], subtotal: 0, maxAtraso: 0, ultimoAviso: null,
      }
      g.itens.push(i)
      g.subtotal += i.valor
      g.maxAtraso = Math.max(g.maxAtraso, diasAtraso(i.vencimento, today))
      if (i.ultimoAviso && (!g.ultimoAviso || i.ultimoAviso.data > g.ultimoAviso.data)) g.ultimoAviso = i.ultimoAviso
      map.set(chave, g)
    }
    const arr = [...map.values()]
    arr.forEach(g => g.itens.sort((a, b) => ((a.vencimento ?? '9999') < (b.vencimento ?? '9999') ? -1 : 1)))
    arr.sort((a, b) => b.subtotal - a.subtotal)
    return arr
  }, [atrasados, tipo, query, today, clientePorId])

  const total = useMemo(() => grupos.reduce((s, g) => s + g.subtotal, 0), [grupos])
  const nItens = useMemo(() => grupos.reduce((s, g) => s + g.itens.length, 0), [grupos])

  function toggle(k: string) {
    setOpen(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }

  const isReceber = tipo === 'entrada'

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900">Inadimplentes</h1>
        <p className="text-gray-500 text-sm mt-0.5">Títulos vencidos (atrasados), por cliente / fornecedor — independe do mês</p>
      </div>

      <ReguaBanner regua={regua} onConfig={() => setConfigOpen(true)} />

      {/* Cards de total (só vencidos) */}
      <div className="grid grid-cols-2 gap-3 mb-5 max-w-xl">
        <button type="button" onClick={() => setTipo('entrada')}
          className={cn('text-left rounded-xl border bg-white px-4 py-3 transition-colors',
            isReceber ? 'border-orange-300 ring-2 ring-orange-200' : 'border-gray-200 hover:border-gray-300')}>
          <p className="text-[11px] font-medium text-gray-400 mb-1">A receber atrasado</p>
          <p className="text-base font-semibold text-emerald-600">{formatBRL(totais.receber)}</p>
        </button>
        <button type="button" onClick={() => setTipo('saida')}
          className={cn('text-left rounded-xl border bg-white px-4 py-3 transition-colors',
            !isReceber ? 'border-orange-300 ring-2 ring-orange-200' : 'border-gray-200 hover:border-gray-300')}>
          <p className="text-[11px] font-medium text-gray-400 mb-1">A pagar atrasado</p>
          <p className="text-base font-semibold text-red-600">{formatBRL(totais.pagar)}</p>
        </button>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-xl p-0.5">
          {([['entrada', 'A receber (clientes)'], ['saida', 'A pagar (fornecedores)']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setTipo(v)} aria-pressed={tipo === v}
              className={cn('px-3 py-1.5 text-sm font-medium rounded-[10px] transition-colors',
                tipo === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por contato, descrição ou categoria"
            className="w-full pl-9 pr-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
        </div>
      </div>

      {/* Barra de total do recorte */}
      <div className="flex items-center justify-between gap-3 mb-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <span className="text-sm text-gray-500">
          {grupos.length} {isReceber ? 'cliente(s)' : 'fornecedor(es)'} · {nItens} título(s) vencido(s)
        </span>
        <span className={cn('text-base font-semibold tabular-nums', isReceber ? 'text-emerald-600' : 'text-red-600')}>{formatBRL(total)}</span>
      </div>

      {/* Grupos */}
      <div className="space-y-2">
        {grupos.map(g => (
          <GrupoCard key={g.chave} orgSlug={orgSlug} g={g} today={today} isReceber={isReceber}
            aberto={open.has(g.chave)} onToggle={() => toggle(g.chave)}
            onCobrar={() => setCobrando(g)} onVincular={() => setVinculando(g)}
            onPromessa={setPromessaDe} />
        ))}
        {grupos.length === 0 && (
          <p className="text-sm text-gray-400 px-4 py-12 text-center bg-white rounded-xl border border-gray-200">
            Nada atrasado {isReceber ? 'a receber' : 'a pagar'}. 🎉
          </p>
        )}
      </div>

      {configOpen && <ConfigReguaModal orgSlug={orgSlug} regua={regua} onClose={() => setConfigOpen(false)} />}
      {cobrando && <CobrarModal orgSlug={orgSlug} g={cobrando} today={today} onClose={() => setCobrando(null)} />}
      {promessaDe && <PromessaModal orgSlug={orgSlug} item={promessaDe} onClose={() => setPromessaDe(null)} />}
      {vinculando && <VincularModal orgSlug={orgSlug} g={vinculando} clientes={clientes} onClose={() => setVinculando(null)} />}
    </div>
  )
}

/* ── Régua ────────────────────────────────────────────────────────────────── */

function ReguaBanner({ regua, onConfig }: { regua: ReguaInfo; onConfig: () => void }) {
  // Sem dados de pagamento o e-mail sai sem dizer COMO pagar — a régua se recusa
  // a disparar nessa condição (migration 189), então o aviso vem primeiro.
  const bloqueada = regua.ativa && !regua.temPaymentInfo
  const ligada = regua.ativa && regua.temPaymentInfo && regua.clientesLigados > 0

  return (
    <div className={cn('rounded-xl border px-4 py-3 mb-5 flex items-start gap-3 flex-wrap',
      bloqueada ? 'bg-amber-50 border-amber-200' : ligada ? 'bg-emerald-50/60 border-emerald-200' : 'bg-white border-gray-200')}>
      <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
        bloqueada ? 'bg-amber-100 text-amber-700' : ligada ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400')}>
        {bloqueada ? <AlertTriangle className="w-4 h-4" /> : ligada ? <BellRing className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">
          {bloqueada ? 'Régua ligada, mas travada' : ligada ? 'Régua de cobrança ativa' : 'Régua de cobrança desligada'}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {bloqueada
            ? 'Falta cadastrar os dados de pagamento em Configurações → Documentos. Sem eles nenhum e-mail é disparado.'
            : regua.ativa
              ? <>Avisa em {regua.degraus.map(rotuloDegrau).join(' · ')} — <strong className="text-gray-700">{regua.clientesLigados}</strong> cliente(s) com cobrança automática.</>
              : <>Nenhum e-mail é disparado. Ao ligar, avisa em {regua.degraus.map(rotuloDegrau).join(' · ')} para os clientes com cobrança automática.</>}
        </p>
      </div>
      <button onClick={onConfig}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors active:scale-[0.97] shrink-0">
        <Settings2 className="w-3.5 h-3.5" /> Configurar
      </button>
    </div>
  )
}

function ConfigReguaModal({ orgSlug, regua, onClose }: { orgSlug: string; regua: ReguaInfo; onClose: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [ativa, setAtiva] = useState(regua.ativa)
  const [degraus, setDegraus] = useState(regua.degraus.join(', '))

  function salvar() {
    const nums = degraus.split(/[,\s]+/).map(s => s.trim()).filter(Boolean).map(Number)
    if (nums.some(n => !Number.isFinite(n))) { toast.error('Use só números separados por vírgula (ex.: -3, 0, 3, 7).'); return }
    if (!nums.length) { toast.error('A régua precisa de ao menos um degrau.'); return }
    startTransition(async () => {
      const r = await setCobrancaConfig(orgSlug, ativa, [...new Set(nums)].sort((a, b) => a - b))
      if (r?.error) { toast.error(r.error); return }
      toast.success(ativa ? 'Régua ligada.' : 'Régua desligada.')
      onClose()
      router.refresh()
    })
  }

  return (
    <Modal open onClose={onClose} size="md">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Régua de cobrança</h2>
        <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
      </div>
      <div className="px-6 py-5 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={ativa} onChange={e => setAtiva(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-orange-600" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-gray-900">Disparar e-mails automaticamente</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Chave-geral. Cada cliente ainda precisa da própria cobrança automática ligada, e sem e-mail financeiro cadastrado ninguém é cobrado.
            </span>
          </span>
        </label>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Degraus (dias em relação ao vencimento)</label>
          <input value={degraus} onChange={e => setDegraus(e.target.value)}
            className="w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <p className="text-[11px] text-gray-400 mt-1.5">
            Negativo = antes do vencimento. Cada título recebe no máximo um e-mail por degrau, e sempre o degrau mais alto já alcançado — título que entra com 90 dias de atraso recebe um aviso, não a escada inteira.
          </p>
        </div>

        {!regua.temPaymentInfo && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            Os dados de pagamento (PIX/banco) ainda não foram cadastrados em Configurações → Documentos. Enquanto estiverem vazios, a régua não dispara.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button onClick={salvar} disabled={isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Grupo (cliente / fornecedor) ─────────────────────────────────────────── */

function GrupoCard({ orgSlug, g, today, isReceber, aberto, onToggle, onCobrar, onVincular, onPromessa }: {
  orgSlug: string; g: Grupo; today: string; isReceber: boolean; aberto: boolean
  onToggle: () => void; onCobrar: () => void; onVincular: () => void; onPromessa: (i: AbertoItem) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const cobravel = isReceber && !!g.cliente && g.itens.some(i => i.lancamentoId)
  const semEmail = !!g.cliente && !(g.cliente.financeEmail ?? '').trim()

  function toggleAuto() {
    if (!g.cliente) return
    startTransition(async () => {
      const r = await setClienteCobrancaAuto(orgSlug, g.cliente!.id, !g.cliente!.cobrancaAuto)
      if (r?.error) { toast.error(r.error); return }
      toast.success(g.cliente!.cobrancaAuto ? `Cobrança automática desligada para ${g.cliente!.nome}.` : `${g.cliente!.nome} entra na régua de cobrança.`)
      router.refresh()
    })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="w-full flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={onToggle} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          <ChevronRight className={cn('w-4 h-4 text-gray-400 transition-transform shrink-0', aberto && 'rotate-90')} />
          {isReceber ? <ArrowDownCircle className="w-4 h-4 text-emerald-500 shrink-0" /> : <ArrowUpCircle className="w-4 h-4 text-red-400 shrink-0" />}
          <span className="text-sm font-medium text-gray-900 truncate">{g.contato}</span>
          <span className="text-xs text-gray-400 shrink-0">{g.itens.length} título(s)</span>
          <span className="inline-flex items-center text-[10px] font-medium text-red-700 bg-red-50 rounded-full px-1.5 py-0.5 shrink-0">
            até {g.maxAtraso} dia{g.maxAtraso > 1 ? 's' : ''} de atraso
          </span>
          {g.ultimoAviso && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5 shrink-0"
              title={`Último aviso: ${g.ultimoAviso.canal === 'manual' ? 'manual' : g.ultimoAviso.canal === 'baseline' ? 'não cobrado pela régua (vencido antes dela entrar no ar)' : `régua ${g.ultimoAviso.bucket}`}`}>
              <Mail className="w-3 h-3" />
              {g.ultimoAviso.canal === 'baseline' ? 'sem aviso' : `avisado ${dataCurta(g.ultimoAviso.data)}`}
            </span>
          )}
        </button>
        <span className={cn('text-sm font-semibold tabular-nums shrink-0', isReceber ? 'text-emerald-600' : 'text-red-600')}>{formatBRL(g.subtotal)}</span>
        {isReceber && (
          g.cliente ? (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={toggleAuto} disabled={isPending || semEmail}
                title={semEmail ? 'Cliente sem e-mail financeiro cadastrado' : g.cliente.cobrancaAuto ? 'Cobrança automática ligada — clique para desligar' : 'Ligar cobrança automática para este cliente'}
                className={cn('p-1.5 rounded-lg transition-colors active:scale-[0.95] disabled:opacity-40',
                  g.cliente.cobrancaAuto ? 'text-emerald-600 hover:bg-emerald-50' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100')}>
                {g.cliente.cobrancaAuto ? <BellRing className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              </button>
              <button onClick={onCobrar} disabled={!cobravel || semEmail}
                title={semEmail ? 'Cliente sem e-mail financeiro cadastrado' : 'Enviar um e-mail com todos os títulos vencidos'}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-40 transition-colors active:scale-[0.97]">
                <Send className="w-3.5 h-3.5" /> Cobrar agora
              </button>
            </div>
          ) : (
            <button onClick={onVincular}
              title="Este contato não está ligado a nenhum cliente do Flow — sem o vínculo não dá pra cobrar"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors active:scale-[0.97] shrink-0">
              <Link2 className="w-3.5 h-3.5" /> Vincular cliente
            </button>
          )
        )}
      </div>

      {aberto && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {g.itens.map(i => {
            const atraso = diasAtraso(i.vencimento, today)
            const promessaVale = !!i.promessaData && i.promessaData >= today
            return (
              <div key={i.id} className="flex items-center gap-3 px-4 py-2.5 pl-11">
                <div className="w-24 shrink-0">
                  <div className="text-sm tabular-nums text-red-600 font-medium">{formatDateBR(i.vencimento)}</div>
                  <div className="text-[10px] text-red-500">{atraso} dia{atraso > 1 ? 's' : ''} atrás</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-800 truncate">{i.descricao || i.categoria || '—'}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {i.descricao && i.categoria && <span className="text-[11px] text-gray-400 truncate">{i.categoria}</span>}
                    {i.parcial && (
                      <span className="inline-flex items-center text-[10px] font-medium text-blue-700 bg-blue-50 rounded-full px-1.5 py-0.5"
                        title={`Valor cheio ${formatBRL(i.valorCheio)} — já baixado ${formatBRL(i.valorCheio - i.valor)}`}>
                        parcial · falta {formatBRL(i.valor)}
                      </span>
                    )}
                    {promessaVale && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-700 bg-violet-50 rounded-full px-1.5 py-0.5"
                        title={i.promessaObs ?? undefined}>
                        <CalendarClock className="w-3 h-3" /> promete {formatDateBR(i.promessaData)}
                      </span>
                    )}
                    {i.centroCusto && (
                      <span className="inline-flex items-center text-[10px] font-medium text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5"
                        title="Cliente do job (centro de custo) — quem deve é o contato do título">
                        {i.centroCusto}
                      </span>
                    )}
                    {!i.lancamentoId && (
                      <span className="inline-flex items-center text-[10px] font-medium text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5"
                        title="Linha do extrato da Conta Azul ainda não promovida a lançamento — promova em Lançamentos para poder cobrar">
                        só no extrato
                      </span>
                    )}
                  </div>
                </div>
                {i.lancamentoId && isReceber && (
                  <button onClick={() => onPromessa(i)} title="Registrar promessa de pagamento"
                    className="p-1.5 rounded-lg text-gray-300 hover:text-violet-600 hover:bg-violet-50 transition-colors active:scale-[0.95] shrink-0">
                    <CalendarClock className="w-4 h-4" />
                  </button>
                )}
                <span className="text-sm font-medium tabular-nums text-gray-900 shrink-0">{formatBRL(i.valor)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Cobrar agora ─────────────────────────────────────────────────────────── */

function CobrarModal({ orgSlug, g, today, onClose }: { orgSlug: string; g: Grupo; today: string; onClose: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const cobraveis = g.itens.filter(i => i.lancamentoId)
  const [sel, setSel] = useState<Set<string>>(() => new Set(cobraveis.map(i => i.lancamentoId!)))
  const total = cobraveis.filter(i => sel.has(i.lancamentoId!)).reduce((s, i) => s + i.valor, 0)

  function enviar() {
    if (!sel.size) { toast.error('Selecione ao menos um título.'); return }
    startTransition(async () => {
      const r = await cobrarAgora(orgSlug, g.cliente!.id, [...sel])
      if (r?.error) { toast.error(r.error); return }
      if (r?.aviso) toast.warning(r.aviso)
      else toast.success(`Cobrança enviada para ${r?.email}.`)
      onClose()
      router.refresh()
    })
  }

  return (
    <Modal open onClose={onClose} size="md">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Cobrar {g.contato}</h2>
        <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
      </div>
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-gray-600">
          Um e-mail com os títulos marcados vai para <strong className="text-gray-900">{g.cliente?.financeEmail}</strong>.
          O tom acompanha o atraso mais antigo, e o envio fica registrado no histórico.
        </p>

        <div className="rounded-xl border border-gray-200 divide-y divide-gray-50 max-h-64 overflow-y-auto">
          {cobraveis.map(i => {
            const on = sel.has(i.lancamentoId!)
            return (
              <label key={i.id} className={cn('flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors', on ? 'bg-orange-50/60' : 'hover:bg-gray-50')}>
                <input type="checkbox" checked={on} className="w-4 h-4 accent-orange-600"
                  onChange={() => setSel(prev => {
                    const n = new Set(prev)
                    if (n.has(i.lancamentoId!)) n.delete(i.lancamentoId!); else n.add(i.lancamentoId!)
                    return n
                  })} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-gray-800 truncate">{i.descricao || i.categoria || 'Cobrança'}</span>
                  <span className="block text-[11px] text-gray-400">
                    venc. {formatDateBR(i.vencimento)} · {diasAtraso(i.vencimento, today)} dias
                  </span>
                </span>
                <span className="text-sm font-medium tabular-nums text-gray-900 shrink-0">{formatBRL(i.valor)}</span>
              </label>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-2.5">
          <span className="text-sm text-gray-500">{sel.size} título(s)</span>
          <span className="text-base font-semibold text-gray-900 tabular-nums">{formatBRL(total)}</span>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button onClick={enviar} disabled={isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar cobrança
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Promessa de pagamento ────────────────────────────────────────────────── */

function PromessaModal({ orgSlug, item, onClose }: { orgSlug: string; item: AbertoItem; onClose: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [data, setData] = useState(item.promessaData ?? '')
  const [obs, setObs] = useState(item.promessaObs ?? '')

  function salvar(limpar = false) {
    startTransition(async () => {
      const r = await setPromessaPagamento(orgSlug, item.lancamentoId!, limpar ? null : data || null, limpar ? null : obs)
      if (r?.error) { toast.error(r.error); return }
      toast.success(limpar ? 'Promessa removida.' : 'Promessa registrada — a régua se cala até essa data.')
      onClose()
      router.refresh()
    })
  }

  return (
    <Modal open onClose={onClose} size="sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Promessa de pagamento</h2>
        <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
      </div>
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-gray-600 truncate">{item.descricao || item.categoria || 'Título'} · <span className="tabular-nums">{formatBRL(item.valor)}</span></p>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Data prometida</label>
          <input type="date" value={data} onChange={e => setData(e.target.value)}
            className="w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <p className="text-[11px] text-gray-400 mt-1.5">Até essa data a régua não manda e-mail para este título. Depois dela, volta a cobrar.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Observação</label>
          <input value={obs} onChange={e => setObs(e.target.value)} placeholder="Ex.: falado com o Gabriel, paga junto com a próxima parcela"
            className="w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div className="flex justify-between gap-2">
          {item.promessaData
            ? <button onClick={() => salvar(true)} disabled={isPending} className="px-3 py-2 text-sm text-gray-500 hover:text-red-600 transition">Remover</button>
            : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
            <button onClick={() => salvar()} disabled={isPending || !data}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/* ── Vincular contato → cliente ───────────────────────────────────────────── */

function VincularModal({ orgSlug, g, clientes, onClose }: {
  orgSlug: string; g: Grupo; clientes: ClienteInfo[]; onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [wsId, setWsId] = useState('')

  function salvar() {
    if (!wsId) { toast.error('Escolha o cliente.'); return }
    startTransition(async () => {
      const r = await vincularClienteContato(orgSlug, g.contato, wsId)
      if (r?.error) { toast.error(r.error); return }
      toast.success(`${r?.vinculados ?? 0} lançamento(s) vinculado(s) — o próximo import já nasce ligado.`)
      onClose()
      router.refresh()
    })
  }

  return (
    <Modal open onClose={onClose} size="sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Vincular a um cliente</h2>
        <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
      </div>
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-gray-600">
          O extrato traz <strong className="text-gray-900">{g.contato}</strong>. Ligando essa grafia a um cliente, todos os
          lançamentos com esse nome passam a ser cobráveis — e o próximo import já nasce vinculado.
        </p>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Cliente</label>
          <Select value={wsId} onChange={setWsId} placeholder="Escolha o cliente"
            options={clientes.map(c => ({ value: c.id, label: c.nome }))} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button onClick={salvar} disabled={isPending || !wsId}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Vincular
          </button>
        </div>
      </div>
    </Modal>
  )
}
