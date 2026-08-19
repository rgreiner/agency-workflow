'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { formatBRL, parseMoney } from '@/lib/midia'
import { MESES_ABREV } from '@/lib/fin-cubo'
import type { ClienteOpt, MemberOpt } from '../../midias/simplificada/MidiaForm'

export interface VendaValues {
  workspace_id: string
  titulo: string
  /** 'YYYY-MM' — o mês a que a venda se refere (vira a competência do lançamento). */
  mes_venda: string
  vencimento: string
  /** Quanto o cliente vendeu no período (a base da comissão). */
  venda_base: string
  comissao_pct: string
  /** Comissão da agência. Calculada pela base × %, mas editável (arredondamento, acordo). */
  comissao: string
  emissao: string
  responsavel_id: string
  situacao: string
  observacao: string
}

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** % aceita vírgula OU ponto: "12,5" e "12.5" são a mesma taxa. `parseMoney`, que
 *  descarta o ponto como separador de milhar, leria "12.5" como 125. */
const parsePct = (s: string) => {
  const n = Number((s ?? '').trim().replace(',', '.'))
  return isNaN(n) ? 0 : n
}
/** 'YYYY-MM' → 'jul/26', para o resumo. */
const rotuloMesVenda = (ym: string) =>
  ym && ym.length >= 7 ? `${MESES_ABREV[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}` : '—'

function emptyValues(today: string, responsavelId: string): VendaValues {
  return {
    workspace_id: '', titulo: '', mes_venda: today.slice(0, 7), vencimento: '',
    venda_base: '', comissao_pct: '', comissao: '', emissao: today,
    responsavel_id: responsavelId, situacao: 'em_aberto', observacao: '',
  }
}

export function VendaForm({
  clientes, members, defaultResponsavelId, today, redirectTo, initial, submitLabel = 'Gravar', onSubmit,
}: {
  clientes: ClienteOpt[]; members: MemberOpt[]
  defaultResponsavelId: string; today: string; redirectTo: string
  initial?: Partial<VendaValues>; submitLabel?: string
  onSubmit: (fd: FormData) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [form, setForm] = useState<VendaValues>({ ...emptyValues(today, defaultResponsavelId), ...initial })
  const [isPending, startTransition] = useTransition()
  const [running, setRunning] = useState<'save' | 'approve' | null>(null)
  const [error, setError] = useState('')

  function set<K extends keyof VendaValues>(k: K, v: VendaValues[K]) { setForm(f => ({ ...f, [k]: v })) }

  /**
   * Base ou % mudou → recalcula a comissão. O campo continua editável de propósito:
   * arredondamento e acerto pontual acontecem, e é o valor da comissão que vira o
   * lançamento a receber — ele tem que poder ser o número combinado, não o da conta.
   */
  function recalcula(campo: 'venda_base' | 'comissao_pct', valor: string) {
    setForm(f => {
      const next = { ...f, [campo]: valor }
      const base = parseMoney(campo === 'venda_base' ? valor : f.venda_base)
      const pct = parsePct(campo === 'comissao_pct' ? valor : f.comissao_pct)
      if (base > 0 && pct > 0) next.comissao = brl(Math.round(base * pct) / 100)
      return next
    })
  }

  const comissao = parseMoney(form.comissao)
  const base = parseMoney(form.venda_base)
  const cliNome = clientes.find(c => c.id === form.workspace_id)?.name

  // situacaoAlvo: 'em_aberto' salva rascunho; 'faturar' manda pro Financeiro
  // conferir e lançar. Em edição, undefined mantém a atual.
  function handleSubmit(e: React.FormEvent, situacaoAlvo?: string) {
    e.preventDefault()
    setError('')
    if (!form.workspace_id) { setError('Selecione o cliente'); return }
    if (!form.titulo.trim()) { setError('Informe a descrição'); return }
    if (!form.mes_venda) { setError('Informe o mês da venda'); return }
    if (!form.vencimento) { setError('Informe a data de vencimento'); return }
    // Sem valor a receber o documento vira "A Faturar" e nunca gera lançamento —
    // o banco barra isso, mas aqui a mensagem chega antes e faz sentido.
    if (comissao <= 0) { setError('A comissão precisa ser maior que zero.'); return }

    const fd = new FormData()
    fd.set('tipo', 'venda')
    fd.set('workspace_id', form.workspace_id)
    fd.set('titulo', form.titulo)
    fd.set('emissao', form.emissao || today)
    fd.set('situacao', situacaoAlvo ?? form.situacao)
    fd.set('observacao', form.observacao)
    fd.set('responsavel_id', form.responsavel_id)
    // `valor` = a base (o que o cliente vendeu), igual ao pedido guarda o valor cheio.
    // O que a agência fatura sai da parcela.
    fd.set('valor', String(base))
    fd.set('bv_pct', String(parsePct(form.comissao_pct)))
    fd.set('honorarios_pct', '0')
    fd.set('redirect_to', redirectTo)
    fd.set('detalhe', JSON.stringify({
      mes_venda: form.mes_venda,
      venda_base: String(base),
      comissao_pct: String(parsePct(form.comissao_pct)),
      parcelas: [{
        vencimento: form.vencimento,
        valor: String(comissao),
        tipo: 'receber_cliente',
        // Competência = mês da VENDA, não do vencimento: venda de julho que vence
        // em agosto tem que aparecer em julho na análise por competência.
        competencia: `${form.mes_venda}-01`,
      }],
    }))

    setRunning(situacaoAlvo === 'faturar' ? 'approve' : 'save')
    startTransition(async () => {
      const res = await onSubmit(fd)
      if (res?.error) { setError(res.error); setRunning(null); return }
    })
  }

  const clienteOptions = clientes.map(c => ({ value: c.id, label: c.name }))
  const memberOptions = members.map(m => ({ value: m.id, label: m.name }))

  return (
    <div className="p-6 max-w-3xl">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">{submitLabel === 'Gravar' ? 'Adicionar' : 'Editar'} Receita de Venda</h1>
      <p className="text-sm text-gray-500 mb-5">Comissão que o cliente paga à agência sobre o que ele vendeu</p>

      <form onSubmit={e => handleSubmit(e)} className="space-y-5">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className={cardCls}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Cliente <span className="text-red-500">*</span></label>
              <Select value={form.workspace_id} onChange={v => set('workspace_id', v)} options={clienteOptions} placeholder="Selecionar cliente" />
            </div>
            <div>
              <label className={labelCls}>Descrição <span className="text-red-500">*</span></label>
              <input value={form.titulo} onChange={e => set('titulo', e.target.value)} placeholder="Comissão sobre vendas" className={inputCls} required />
            </div>
            <div>
              <label className={labelCls}>Mês da venda <span className="text-red-500">*</span></label>
              <input type="month" value={form.mes_venda} onChange={e => set('mes_venda', e.target.value)} className={inputCls} required />
              <p className="mt-1 text-[11px] text-gray-400">É a competência do lançamento — o mês a que a comissão se refere.</p>
            </div>
            <div>
              <label className={labelCls}>Data de vencimento <span className="text-red-500">*</span></label>
              <input type="date" value={form.vencimento} onChange={e => set('vencimento', e.target.value)} className={inputCls} required />
              <p className="mt-1 text-[11px] text-gray-400">Quando o dinheiro entra no caixa.</p>
            </div>
          </div>
        </div>

        <div className={cardCls}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Valores</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Venda do cliente (R$)</label>
              <input inputMode="decimal" value={form.venda_base} onChange={e => recalcula('venda_base', e.target.value)} placeholder="0,00" className={cn(inputCls, 'text-right')} />
            </div>
            <div>
              <label className={labelCls}>Comissão (%)</label>
              <input inputMode="decimal" value={form.comissao_pct} onChange={e => recalcula('comissao_pct', e.target.value)} placeholder="0,00" className={cn(inputCls, 'text-right')} />
            </div>
            <div>
              <label className={labelCls}>A receber (R$) <span className="text-red-500">*</span></label>
              <input inputMode="decimal" value={form.comissao} onChange={e => set('comissao', e.target.value)} placeholder="0,00" className={cn(inputCls, 'text-right font-medium')} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-baseline justify-end gap-x-2 gap-y-1 text-sm">
            <span className="text-gray-500">
              {base > 0 ? `${formatBRL(base)} vendidos em ${rotuloMesVenda(form.mes_venda)}${cliNome ? ` por ${cliNome}` : ''} →` : 'A receber →'}
            </span>
            <span className="font-semibold text-gray-900 text-base">{formatBRL(comissao)}</span>
          </div>
        </div>

        <div className={cardCls}>
          <label className={labelCls}>Observação</label>
          <textarea rows={3} value={form.observacao} onChange={e => set('observacao', e.target.value)} className={cn(inputCls, 'resize-none')} />
          <label className={cn(labelCls, 'mt-4')}>Responsável</label>
          <Select value={form.responsavel_id} onChange={v => set('responsavel_id', v)} options={memberOptions} placeholder="Selecionar" />
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pb-10">
          <button type="button" onClick={() => router.back()} className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition order-last sm:order-first">Cancelar</button>
          {/* Gravar = rascunho (Em Aberto). Aprovar = vai pro Financeiro conferir e lançar. */}
          <button aria-label="Gravar rascunho" type="submit" disabled={isPending}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50 transition">
            {isPending && running === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Gravar
          </button>
          <button aria-label="Aprovar" type="button" onClick={e => handleSubmit(e, 'faturar')} disabled={isPending}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {isPending && running === 'approve' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Aprovar
          </button>
        </div>
      </form>
    </div>
  )
}
