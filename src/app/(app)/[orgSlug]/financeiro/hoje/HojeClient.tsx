'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowDownCircle, ArrowUpCircle, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, FileText,
  Landmark, Loader2, Pencil, Plus, RotateCcw, SlidersHorizontal, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { DocChip } from '@/components/ui/DocChip'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import { liquidarLancamento, reabrirLancamento, setLancamentoPagarCom } from '@/app/actions/financeiro'
import { formatarLinha, textoParaCopiar, tipoPagarCom } from '@/lib/boleto/linha-digitavel'
import { BaixaModal, type Lancamento, type ContaRef } from '../lancamentos/LancamentosClient'

export interface ItemHoje extends Lancamento {
  /** O que falta (baixa parcial deixa o título em aberto com parte realizada). */
  falta: number
  pagar_com: string | null
  /** Pix do último pagamento ao mesmo contato ou do cadastro — só quando não há código. */
  sugestao: string | null
  boleto_url: string | null
}

const FORMA_LABEL: Record<string, string> = {
  pix: 'Pix', boleto: 'Boleto', cartao: 'Cartão', debito_conta: 'Débito automático', transferencia: 'Transferência',
}
const TIPO_LABEL = { boleto: 'Boleto', pix_copia_cola: 'Pix copia e cola', pix_chave: 'Chave Pix' } as const

function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function diaPorExtenso(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${iso}T12:00:00Z`))
}

function copiar(texto: string, aviso = 'Copiado') {
  navigator.clipboard?.writeText(texto)
    .then(() => toast.success(aviso))
    .catch(() => toast.error('Não foi possível copiar'))
}

/** Valor como o app do banco pede: "1234,56", sem R$ nem milhar. */
const valorParaCopiar = (v: number) => v.toFixed(2).replace('.', ',')

export function HojeClient({ orgSlug, dia, hoje, saldo, contas, contaPadrao, abertos, feitos }: {
  orgSlug: string
  dia: string
  hoje: string
  saldo: number
  contas: ContaRef[]
  contaPadrao: string
  abertos: ItemHoje[]
  feitos: ItemHoje[]
}) {
  const router = useRouter()
  const [ajustar, setAjustar] = useState<ItemHoje | null>(null)
  const ehHoje = dia === hoje

  const pagar = abertos.filter(l => l.tipo === 'saida')
  const receberDia = abertos.filter(l => l.tipo === 'entrada' && l.vencimento === dia)
  const receberAtrasado = abertos.filter(l => l.tipo === 'entrada' && (l.vencimento ?? '') < dia)
  const pagos = feitos.filter(l => l.tipo === 'saida')
  const recebidos = feitos.filter(l => l.tipo === 'entrada')

  const soma = (ls: ItemHoje[]) => ls.reduce((s, l) => s + l.falta, 0)
  const totPagar = soma(pagar)
  const totReceber = soma(receberDia)
  // Saldo de hoje já tem o que foi baixado; o fim do dia soma só o que ainda falta.
  const fimDoDia = saldo - totPagar + totReceber

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <AutoRefresh intervalMs={60000} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{ehHoje ? 'Hoje' : formatDateBR(dia)}</h1>
          <p className="text-gray-500 text-sm mt-0.5 first-letter:uppercase">{diaPorExtenso(dia)} — o que pagar e o que entra</p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/${orgSlug}/financeiro/hoje?dia=${addDias(dia, -1)}`} aria-label="Dia anterior"
            className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 transition-colors active:scale-[0.97]">
            <ChevronLeft className="w-4 h-4" />
          </Link>
          {!ehHoje && (
            <Link href={`/${orgSlug}/financeiro/hoje`}
              className="px-3 py-1.5 rounded-xl text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors active:scale-[0.97]">
              Voltar para hoje
            </Link>
          )}
          <Link href={`/${orgSlug}/financeiro/hoje?dia=${addDias(dia, 1)}`} aria-label="Próximo dia"
            className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 transition-colors active:scale-[0.97]">
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi rotulo="Saldo em conta" valor={saldo} icon={<Landmark className="w-3.5 h-3.5" />} />
        <Kpi rotulo={`A pagar · ${pagar.length}`} valor={totPagar} tom="red" icon={<ArrowUpCircle className="w-3.5 h-3.5" />} />
        <Kpi rotulo={`A receber · ${receberDia.length}`} valor={totReceber} tom="emerald" icon={<ArrowDownCircle className="w-3.5 h-3.5" />} />
        <Kpi rotulo="Fica no fim do dia" valor={fimDoDia} destaque />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Secao titulo="Pagar" tom="red" total={totPagar} n={pagar.length}
          vazio={ehHoje ? 'Nada para pagar hoje.' : 'Nada para pagar neste dia.'}>
          {pagar.map(l => (
            <LinhaPagar key={l.id} orgSlug={orgSlug} l={l} dia={dia} hoje={hoje} contaPadrao={contaPadrao}
              onAjustar={() => setAjustar(l)} />
          ))}
          <Feitos orgSlug={orgSlug} titulo="Pago" itens={pagos} />
        </Secao>

        <Secao titulo="Receber" tom="emerald" total={totReceber} n={receberDia.length}
          vazio={ehHoje ? 'Nada vence hoje.' : 'Nada vence neste dia.'}>
          {receberDia.map(l => (
            <LinhaReceber key={l.id} orgSlug={orgSlug} l={l} dia={dia} hoje={hoje} contaPadrao={contaPadrao}
              onAjustar={() => setAjustar(l)} />
          ))}
          <Feitos orgSlug={orgSlug} titulo="Recebido" itens={recebidos} />
          {receberAtrasado.length > 0 && (
            <Recolhivel titulo={`Atrasados · ${receberAtrasado.length}`} valor={soma(receberAtrasado)} tom="red"
              extra={<Link href={`/${orgSlug}/financeiro/inadimplentes`} className="text-xs text-orange-600 hover:underline underline-offset-2">Inadimplentes →</Link>}>
              {receberAtrasado.map(l => (
                <LinhaReceber key={l.id} orgSlug={orgSlug} l={l} dia={dia} hoje={hoje} contaPadrao={contaPadrao}
                  onAjustar={() => setAjustar(l)} />
              ))}
            </Recolhivel>
          )}
        </Secao>
      </div>

      {ajustar && (
        <BaixaModal orgSlug={orgSlug} lancamento={ajustar} contas={contas}
          onClose={() => { setAjustar(null); router.refresh() }} />
      )}
    </div>
  )
}

function Kpi({ rotulo, valor, tom, icon, destaque }: {
  rotulo: string; valor: number; tom?: 'red' | 'emerald'; icon?: React.ReactNode; destaque?: boolean
}) {
  return (
    <div className={cn('rounded-2xl border p-4', destaque ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200')}>
      <p className={cn('text-[11px] inline-flex items-center gap-1.5',
        tom === 'red' ? 'text-red-600' : tom === 'emerald' ? 'text-emerald-600' : 'text-gray-500')}>
        {icon}{rotulo}
      </p>
      <p className={cn('text-lg font-semibold tabular-nums mt-1', valor < 0 ? 'text-red-600' : 'text-gray-900')}>
        {formatBRL(valor)}
      </p>
    </div>
  )
}

function Secao({ titulo, tom, total, n, vazio, children }: {
  titulo: string; tom: 'red' | 'emerald'; total: number; n: number; vazio: string; children: React.ReactNode
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl">
      <header className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h2 className={cn('text-sm font-semibold inline-flex items-center gap-2', tom === 'red' ? 'text-red-600' : 'text-emerald-600')}>
          {tom === 'red' ? <ArrowUpCircle className="w-4 h-4" /> : <ArrowDownCircle className="w-4 h-4" />}
          {titulo}
          <span className="text-gray-400 font-normal">{n}</span>
        </h2>
        <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatBRL(total)}</span>
      </header>
      {n === 0 && <p className="px-5 py-6 text-sm text-gray-400">{vazio}</p>}
      <ul className="divide-y divide-gray-100">{children}</ul>
    </section>
  )
}

function Recolhivel({ titulo, valor, tom, extra, children, inicial = false }: {
  titulo: string; valor: number; tom?: 'red'; extra?: React.ReactNode; children: React.ReactNode; inicial?: boolean
}) {
  const [aberto, setAberto] = useState(inicial)
  return (
    <li className="bg-gray-50/60">
      <div className="flex items-center justify-between gap-2 px-5 py-2.5">
        <button type="button" onClick={() => setAberto(a => !a)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors">
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', !aberto && '-rotate-90')} />
          {titulo}
          <span className={cn('tabular-nums', tom === 'red' ? 'text-red-600' : 'text-gray-500')}>{formatBRL(valor)}</span>
        </button>
        {extra}
      </div>
      {aberto && <ul className="divide-y divide-gray-100 border-t border-gray-100 bg-white">{children}</ul>}
    </li>
  )
}

function Feitos({ orgSlug, titulo, itens }: { orgSlug: string; titulo: string; itens: ItemHoje[] }) {
  const router = useRouter()
  const [pendente, start] = useTransition()
  if (!itens.length) return null
  const total = itens.reduce((s, l) => s + Number(l.valor_realizado ?? l.valor ?? 0), 0)

  function desfazer(l: ItemHoje) {
    start(async () => {
      const res = await reabrirLancamento(orgSlug, l.id)
      if (res?.error) { toast.error(res.error); return }
      toast.success('Voltou para em aberto')
      router.refresh()
    })
  }

  return (
    <Recolhivel titulo={`${titulo} · ${itens.length}`} valor={total}>
      {itens.map(l => (
        <li key={l.id} className="flex items-center gap-3 px-5 py-2.5">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-700 truncate">{l.contato_nome || l.descricao || '—'}</p>
            {l.contato_nome && l.descricao && <p className="text-xs text-gray-400 truncate">{l.descricao}</p>}
          </div>
          <span className="text-sm tabular-nums text-gray-600">{formatBRL(Number(l.valor_realizado ?? l.valor ?? 0))}</span>
          <button type="button" onClick={() => desfazer(l)} disabled={pendente} title="Desfazer a baixa"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </li>
      ))}
    </Recolhivel>
  )
}

/** Baixa em um clique (conta do lançamento ou a favorita, data de hoje, valor cheio)
 *  com Desfazer no toast. Juros, multa ou outra conta: "Ajustar" abre o modal da baixa. */
function useBaixa(orgSlug: string, l: ItemHoje, hoje: string, contaPadrao: string, onAjustar: () => void) {
  const router = useRouter()
  const [pendente, start] = useTransition()
  const saida = l.tipo === 'saida'

  function baixar() {
    const conta = l.conta_id || contaPadrao
    if (!conta) { onAjustar(); return }
    start(async () => {
      const res = await liquidarLancamento(orgSlug, l.id, {
        data_liquidacao: hoje, conta_id: conta, forma_pagamento: l.forma_pagamento,
      })
      if (res?.error) { toast.error(res.error); return }
      router.refresh()
      toast.success(`${saida ? 'Pago' : 'Recebido'}: ${l.contato_nome || l.descricao || ''} · ${formatBRL(l.falta)}`, {
        action: {
          label: 'Desfazer',
          onClick: async () => {
            const r = await reabrirLancamento(orgSlug, l.id)
            if (r?.error) toast.error(r.error)
            router.refresh()
          },
        },
      })
    })
  }
  return { baixar, pendente }
}

function Acoes({ l, rotulo, pendente, baixar, onAjustar }: {
  l: ItemHoje; rotulo: string; pendente: boolean; baixar: () => void; onAjustar: () => void
}) {
  return (
    <div className="text-right shrink-0">
      <button type="button" onClick={() => copiar(valorParaCopiar(l.falta), `Valor copiado: ${valorParaCopiar(l.falta)}`)}
        title="Copiar o valor"
        className="text-sm font-semibold text-gray-900 tabular-nums hover:text-orange-600 transition-colors">
        {formatBRL(l.falta)}
      </button>
      <div className="mt-1.5 flex items-center justify-end gap-1">
        <button type="button" onClick={onAjustar} title="Juros, multa, outra conta"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={baixar} disabled={pendente}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-600 text-[#fff] hover:bg-emerald-700 transition-colors active:scale-[0.97] disabled:opacity-50">
          {pendente ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {rotulo}
        </button>
      </div>
    </div>
  )
}

function Atraso({ l, dia }: { l: ItemHoje; dia: string }) {
  if (!l.vencimento || l.vencimento >= dia) return null
  return <span className="shrink-0 text-[11px] text-red-600 bg-red-50 rounded-full px-1.5 py-0.5">venceu {formatDateBR(l.vencimento).slice(0, 5)}</span>
}

function Subtitulo({ l }: { l: ItemHoje }) {
  const parcela = l.parcela_total && l.parcela_total > 1 ? ` · ${l.parcela_num}/${l.parcela_total}` : ''
  const texto = [l.descricao, l.categoria].filter(Boolean).join(' · ')
  if (!texto && !parcela) return null
  return <p className="text-xs text-gray-500 truncate">{texto}{parcela}</p>
}

function LinhaPagar({ orgSlug, l, dia, hoje, contaPadrao, onAjustar }: {
  orgSlug: string; l: ItemHoje; dia: string; hoje: string; contaPadrao: string; onAjustar: () => void
}) {
  const { baixar, pendente } = useBaixa(orgSlug, l, hoje, contaPadrao, onAjustar)
  return (
    <li className="flex gap-3 px-5 py-3">
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{l.contato_nome || l.descricao || '—'}</p>
            <Atraso l={l} dia={dia} />
          </div>
          <Subtitulo l={l} />
        </div>
        <ComoPagar orgSlug={orgSlug} l={l} />
      </div>
      <Acoes l={l} rotulo="Pago" pendente={pendente} baixar={baixar} onAjustar={onAjustar} />
    </li>
  )
}

function LinhaReceber({ orgSlug, l, dia, hoje, contaPadrao, onAjustar }: {
  orgSlug: string; l: ItemHoje; dia: string; hoje: string; contaPadrao: string; onAjustar: () => void
}) {
  const { baixar, pendente } = useBaixa(orgSlug, l, hoje, contaPadrao, onAjustar)
  const forma = l.forma_pagamento ? (FORMA_LABEL[l.forma_pagamento] ?? l.forma_pagamento) : null
  return (
    <li className="flex gap-3 px-5 py-3">
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{l.contato_nome || l.descricao || '—'}</p>
            <Atraso l={l} dia={dia} />
          </div>
          <Subtitulo l={l} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <DocChip orgSlug={orgSlug} doc={{ id: l.origem_id ?? null, serie: l.doc_serie ?? null, numero: l.doc_numero ?? null, origem: l.doc_origem ?? null, producaoTipo: l.doc_producao_tipo }} />
          {forma && <Etiqueta>{forma}</Etiqueta>}
          <Etiqueta tom={l.nf_emitida ? 'ok' : 'falta'}>{l.nf_emitida ? 'NF emitida' : 'Sem NF'}</Etiqueta>
          {l.boleto_gerado && <Etiqueta tom="ok">Boleto enviado</Etiqueta>}
        </div>
      </div>
      <Acoes l={l} rotulo="Recebido" pendente={pendente} baixar={baixar} onAjustar={onAjustar} />
    </li>
  )
}

function Etiqueta({ children, tom }: { children: React.ReactNode; tom?: 'ok' | 'falta' }) {
  return (
    <span className={cn('text-[11px] rounded-full px-2 py-0.5',
      tom === 'ok' ? 'bg-emerald-50 text-emerald-700' : tom === 'falta' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600')}>
      {children}
    </span>
  )
}

/**
 * O código para pagar, pronto para copiar: linha digitável (lida do PDF do boleto),
 * Pix copia-e-cola ou chave. Sem código: sugere o Pix do último pagamento ao mesmo
 * contato, ou deixa colar. O que for colado fica no lançamento (mig. 395).
 */
function ComoPagar({ orgSlug, l }: { orgSlug: string; l: ItemHoje }) {
  const router = useRouter()
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(l.pagar_com ?? '')
  const [pendente, start] = useTransition()
  const forma = l.forma_pagamento ? (FORMA_LABEL[l.forma_pagamento] ?? l.forma_pagamento) : null

  function salvar(valor: string, copiarDepois = false) {
    start(async () => {
      const res = await setLancamentoPagarCom(orgSlug, l.id, valor)
      if (res?.error) { toast.error(res.error); return }
      setEditando(false)
      if (copiarDepois && valor) copiar(textoParaCopiar(valor))
      router.refresh()
    })
  }

  const pdf = l.boleto_url && (
    <a href={l.boleto_url} target="_blank" rel="noopener noreferrer" title="Abrir o boleto"
      className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-orange-600 transition-colors">
      <FileText className="w-3.5 h-3.5" />PDF
    </a>
  )

  if (editando) {
    return (
      <form onSubmit={e => { e.preventDefault(); salvar(texto.trim()) }} className="flex items-center gap-1.5">
        <input autoFocus value={texto} onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') setEditando(false) }}
          placeholder="Linha digitável, Pix copia e cola ou chave Pix"
          className="flex-1 min-w-0 bg-gray-100 border border-transparent rounded-xl px-3 py-1.5 text-xs font-mono focus:outline-none focus:bg-white focus:border-orange-300 transition-colors" />
        <button type="submit" disabled={pendente} title="Salvar"
          className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50">
          {pendente ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </button>
        <button type="button" onClick={() => { setEditando(false); setTexto(l.pagar_com ?? '') }} title="Cancelar"
          className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </form>
    )
  }

  if (l.pagar_com) {
    const tipo = tipoPagarCom(l.pagar_com)
    const exibido = tipo === 'boleto' ? formatarLinha(l.pagar_com) : l.pagar_com
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <button type="button" onClick={() => copiar(textoParaCopiar(l.pagar_com!), `${TIPO_LABEL[tipo]} copiado`)}
          title={`Copiar ${TIPO_LABEL[tipo].toLowerCase()}`}
          className="group flex items-center gap-2 min-w-0 max-w-full bg-gray-100 hover:bg-orange-50 rounded-xl pl-2 pr-2.5 py-1 transition-colors active:scale-[0.97]">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-500 group-hover:text-orange-700">{TIPO_LABEL[tipo]}</span>
          <span className="truncate text-xs font-mono text-gray-700">{exibido}</span>
          <Copy className="w-3.5 h-3.5 shrink-0 text-gray-400 group-hover:text-orange-600" />
        </button>
        <button type="button" onClick={() => setEditando(true)} title="Trocar o código"
          className="p-1 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0">
          <Pencil className="w-3 h-3" />
        </button>
        {pdf}
      </div>
    )
  }

  if (forma && (l.forma_pagamento === 'cartao' || l.forma_pagamento === 'debito_conta')) {
    return <div className="flex items-center gap-2"><Etiqueta>{forma}</Etiqueta>{pdf}</div>
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {l.sugestao && (
        <button type="button" onClick={() => salvar(l.sugestao!, true)} disabled={pendente}
          title="Usar o Pix do último pagamento a este contato (copia e grava neste lançamento)"
          className="flex items-center gap-1.5 min-w-0 max-w-full border border-dashed border-gray-300 hover:border-orange-300 hover:bg-orange-50 rounded-xl px-2.5 py-1 transition-colors active:scale-[0.97] disabled:opacity-50">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Último Pix</span>
          <span className="truncate text-xs font-mono text-gray-600">{l.sugestao}</span>
          <Copy className="w-3.5 h-3.5 shrink-0 text-gray-400" />
        </button>
      )}
      <button type="button" onClick={() => setEditando(true)}
        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-orange-600 rounded-lg px-1.5 py-1 hover:bg-gray-100 transition-colors">
        <Plus className="w-3.5 h-3.5" />{l.sugestao ? 'Outro código' : `Colar ${l.forma_pagamento === 'boleto' ? 'código de barras' : l.forma_pagamento === 'pix' ? 'Pix' : 'Pix ou código'}`}
      </button>
      {forma && l.forma_pagamento !== 'pix' && l.forma_pagamento !== 'boleto' && <Etiqueta>{forma}</Etiqueta>}
      {pdf}
    </div>
  )
}
