'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2, Plus, Sparkles, Trash2, AlertTriangle, ShoppingBasket, Building2, User } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/midia'
import { detalharCompra, detalharPendentes, lerItensDoLancamento, salvarItens, type ItemCompra } from '@/app/actions/compras'

/**
 * Itens da compra dentro do lançamento (mig. 307).
 *
 * A IA lê o cupom que já está anexado e devolve as linhas; tudo é editável,
 * porque cupom amassado e foto torta erram e corrigir tem de ser trivial.
 *
 * A regra que sustenta a camada: a soma dos itens DA EMPRESA tem de fechar com o
 * valor do lançamento. Quando não fecha, a tela DIZ — nunca corrige o total, que
 * é a verdade contábil e já está conciliada com o banco.
 *
 * Item pessoal (regra do Rafael, 29/09): quem vai ao mercado leva as próprias
 * coisas na mesma nota e a empresa reembolsa só a parte dela — o cupom de 21/09
 * soma R$ 201,01 num lançamento de R$ 93,48. Desmarcar o item tira ele da conta
 * E da análise de consumo, mas ele continua na lista para conferir com o papel.
 */
export function ItensCompra({ orgSlug, lancamentoId, valorLancamento, temAnexo }: {
  orgSlug: string
  lancamentoId: string
  valorLancamento: number
  temAnexo: boolean
}) {
  const [itens, setItens] = useState<ItemCompra[] | null>(null)
  const [lendo, setLendo] = useState(false)
  const [salvando, startSalvar] = useTransition()

  useEffect(() => {
    let vivo = true
    lerItensDoLancamento(orgSlug, lancamentoId).then(r => {
      if (vivo) setItens('itens' in r && r.itens ? r.itens : [])
    })
    return () => { vivo = false }
  }, [orgSlug, lancamentoId])

  const lista = itens ?? []
  const val = (i: ItemCompra) => (Number.isFinite(i.valor_total) ? i.valor_total : 0)
  const daEmpresa = lista.filter(i => i.empresa !== false)
  const soma = daEmpresa.reduce((s, i) => s + val(i), 0)
  const somaPessoal = lista.filter(i => i.empresa === false).reduce((s, i) => s + val(i), 0)
  const diferenca = Math.round((valorLancamento - soma) * 100) / 100
  const fecha = Math.abs(diferenca) < 0.01

  async function detalhar() {
    setLendo(true)
    try {
      const r = await detalharCompra(orgSlug, lancamentoId)
      if ('error' in r && r.error) { toast.error(r.error, { duration: 7000 }); return }
      const novo = await lerItensDoLancamento(orgSlug, lancamentoId)
      if ('itens' in novo && novo.itens) setItens(novo.itens)
      toast.success(`${'itens' in r ? r.itens : 0} itens lidos do documento. Confira antes de fechar.`)
    } finally {
      setLendo(false)
    }
  }

  function persistir(next: ItemCompra[]) {
    setItens(next)
    startSalvar(async () => {
      const r = await salvarItens(orgSlug, lancamentoId, next)
      if (r?.error) toast.error(r.error)
    })
  }
  const patch = (i: number, p: Partial<ItemCompra>) =>
    persistir(lista.map((x, j) => (j === i ? { ...x, ...p } : x)))

  return (
    <div className="border-t border-gray-100 pt-4">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-gray-600 inline-flex items-center gap-1.5">
          <ShoppingBasket className="w-3.5 h-3.5" /> Itens da compra
          {lista.length > 0 && <span className="font-normal text-gray-400">({lista.length})</span>}
        </label>
        <div className="flex items-center gap-1.5">
          {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
          <button type="button" onClick={detalhar} disabled={lendo || !temAnexo}
            title={temAnexo ? 'Ler os itens do documento anexado' : 'Anexe o cupom ou a nota primeiro'}
            className="press inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors">
            {lendo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {lendo ? 'Lendo…' : 'Detalhar com IA'}
          </button>
          <button type="button"
            onClick={() => persistir([...lista, { descricao: '', produto: null, quantidade: null, unidade: null, valor_unitario: null, valor_total: 0, origem: 'manual' }])}
            className="press inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Item
          </button>
        </div>
      </div>

      {itens === null ? (
        <p className="text-xs text-gray-400 py-1">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">
          {temAnexo
            ? 'Sem itens. "Detalhar com IA" lê o cupom anexado e lista o que foi comprado.'
            : 'Sem itens. Anexe o cupom da compra para a IA conseguir ler.'}
        </p>
      ) : (
        <>
          <ul className="space-y-1">
            {lista.map((it, i) => (
              <li key={it.id ?? i} className={cn('flex items-center gap-1.5', it.empresa === false && 'opacity-55')}>
                <input value={it.descricao} onChange={e => patch(i, { descricao: e.target.value })}
                  placeholder="como está no cupom" aria-label="Descrição no cupom"
                  className="flex-1 min-w-0 h-8 px-2 text-xs bg-gray-100 border border-transparent rounded-lg focus:bg-white focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none" />
                {/* O nome limpo é o que agrupa a série do ano — "Café", não "CAFE MELITTA TRAD 500G". */}
                <input value={it.produto ?? ''} onChange={e => patch(i, { produto: e.target.value || null })}
                  placeholder="produto" aria-label="Produto (nome para agrupar)"
                  className={cn('w-28 h-8 px-2 text-xs rounded-lg border outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400',
                    it.produto ? 'bg-gray-100 border-transparent focus:bg-white' : 'bg-amber-50 border-amber-200')} />
                <input value={it.quantidade ?? ''} onChange={e => patch(i, { quantidade: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })}
                  placeholder="qtd" inputMode="decimal" aria-label="Quantidade"
                  className="w-14 h-8 px-2 text-xs bg-gray-100 border border-transparent rounded-lg focus:bg-white focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none" />
                <input value={it.valor_total ?? ''} onChange={e => patch(i, { valor_total: Number(e.target.value.replace(',', '.')) || 0 })}
                  placeholder="0,00" inputMode="decimal" aria-label="Valor do item"
                  className="w-20 h-8 px-2 text-xs text-right bg-gray-100 border border-transparent rounded-lg focus:bg-white focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none tabular-nums" />
                {/* Empresa × pessoal: o cupom vem misturado, e quem separa é gente. */}
                <button type="button" onClick={() => patch(i, { empresa: it.empresa === false })}
                  aria-pressed={it.empresa !== false}
                  title={it.empresa === false ? 'Compra pessoal — fora da conta da empresa' : 'É da empresa (clique se for compra pessoal)'}
                  className={cn('press p-1.5 rounded-lg transition-colors',
                    it.empresa === false ? 'text-amber-600 bg-amber-50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100')}>
                  {it.empresa === false ? <User className="w-3.5 h-3.5" /> : <Building2 className="w-3.5 h-3.5" />}
                </button>
                <button type="button" onClick={() => persistir(lista.filter((_, j) => j !== i))}
                  aria-label={`Remover ${it.descricao || 'item'}`}
                  className="press p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <div className={cn('mt-2 flex items-center justify-between rounded-lg px-3 py-2 text-xs',
            fecha ? 'bg-gray-50 text-gray-600' : 'bg-amber-50 text-amber-800')}>
            <span className="inline-flex items-center gap-1.5 min-w-0">
              {!fecha && <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />}
              <span className="truncate">
                {fecha
                  ? somaPessoal > 0
                    ? `Fecha com o lançamento — ${formatBRL(somaPessoal)} em itens pessoais ficaram de fora.`
                    : 'Os itens fecham com o lançamento.'
                  : diferenca < 0
                    // Sobra quase sempre É compra pessoal na mesma nota: o caminho
                    // é marcar os itens, não "corrigir" o valor do lançamento.
                    ? `${formatBRL(Math.abs(diferenca))} a mais que o total — marque os itens pessoais no ícone da linha.`
                    : `Faltam ${formatBRL(diferenca)} para chegar ao total do lançamento.`}
              </span>
            </span>
            <span className="tabular-nums shrink-0">
              {formatBRL(soma)} <span className="text-gray-400">de {formatBRL(valorLancamento)}</span>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Lê em lote os cupons já anexados que ainda não têm itens. Processa poucos por
 * vez de propósito: é uma chamada de IA por documento e a pessoa fica esperando
 * — melhor clicar de novo do que a tela travar com 40.
 */
export function DetalharLote({ orgSlug }: { orgSlug: string }) {
  const [rodando, setRodando] = useState(false)

  async function rodar() {
    setRodando(true)
    try {
      const r = await detalharPendentes(orgSlug, 10)
      if ('error' in r && r.error) { toast.error(r.error); return }
      const { processados = 0, ok = 0, falhas = [] } = r as { processados?: number; ok?: number; falhas?: string[] }
      if (processados === 0) { toast.success('Nenhuma compra pendente: todas as que têm cupom já estão detalhadas.'); return }
      toast.success(`${ok} de ${processados} compras detalhadas.${falhas.length ? ` Falhou: ${falhas[0]}` : ''}`,
        { duration: falhas.length ? 8000 : 4000 })
    } finally {
      setRodando(false)
    }
  }

  return (
    <button type="button" onClick={rodar} disabled={rodando}
      title="Ler os itens dos cupons já anexados que ainda não foram detalhados (10 por vez)"
      className="press inline-flex items-center gap-1.5 px-2.5 py-2 text-sm rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 transition-colors">
      {rodando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
      {rodando ? 'Lendo cupons…' : 'Detalhar compras'}
    </button>
  )
}
