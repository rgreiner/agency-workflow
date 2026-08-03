'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, X, Check, Loader2, Pencil, Landmark, Power, Layers, Eye, EyeOff, Star, CreditCard } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { Select } from '@/components/ui/Select'
import { createConta, updateConta, setContaFavorita, pagarFaturaCartao } from '@/app/actions/financeiro'
import { Modal } from '@/components/ui/Modal'

export interface FaturaAberta { vence: string; total: number; compras: number }

export interface Conta {
  id: string
  nome: string
  tipo: string | null
  saldo_inicial: number | string
  saldo_atual: number | string
  cor: string | null
  ativo: boolean
  ordem: number
  favorita?: boolean
  /** Cartão de crédito (migration 191) — ciclo de fatura e faturas em aberto. */
  fechamentoDia?: number | null
  vencimentoDia?: number | null
  limite?: number | null
  faturas?: FaturaAberta[]
}

const TIPO_OPTIONS = [
  { value: 'banco', label: 'Conta corrente' },
  { value: 'caixa', label: 'Caixa' },
  { value: 'cartao', label: 'Cartão de crédito' },
  { value: 'aplicacao', label: 'Aplicação' },
  { value: 'imobiliario', label: 'Investimento imobiliário' },
  { value: 'outro', label: 'Outro' },
]
const TIPO_LABEL: Record<string, string> = Object.fromEntries(TIPO_OPTIONS.map(o => [o.value, o.label]))
// Tag por tipo — cor só pra diferenciar a natureza da conta, não é status.
const TIPO_TAG: Record<string, string> = {
  banco: 'bg-blue-50 text-blue-700',
  caixa: 'bg-amber-50 text-amber-700',
  cartao: 'bg-violet-50 text-violet-700',
  aplicacao: 'bg-emerald-50 text-emerald-700',
  imobiliario: 'bg-teal-50 text-teal-700',
  outro: 'bg-gray-100 text-gray-600',
}

const COR_PRESETS = ['#f97316', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#eab308', '#14b8a6', '#6b7280']

const inputCls =
  'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

export function ContasClient({ orgSlug, contas }: { orgSlug: string; contas: Conta[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Conta | null>(null)
  const [creating, setCreating] = useState(false)
  const [pagando, setPagando] = useState<Conta | null>(null)
  const [isPending, startTransition] = useTransition()

  // Preferências de view por usuário, persistidas por org (mesmo padrão do Fluxo de
  // caixa). Hidrata no efeito pra não divergir do HTML do servidor.
  const PREFS_KEY = `contas-view:v1:${orgSlug}`
  const [agrupar, setAgrupar] = useState(false)
  const [ocultarInativas, setOcultarInativas] = useState(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY)
      if (!raw) return
      const p = JSON.parse(raw)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAgrupar(!!p.agrupar)
      setOcultarInativas(!!p.ocultarInativas)
    } catch { /* prefs corrompidas: segue no default */ }
  }, [PREFS_KEY])
  function salvarPrefs(next: { agrupar: boolean; ocultarInativas: boolean }) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)) } catch { /* ignora */ }
  }
  function toggleAgrupar() {
    setAgrupar(v => { salvarPrefs({ agrupar: !v, ocultarInativas }); return !v })
  }
  function toggleOcultarInativas() {
    setOcultarInativas(v => { salvarPrefs({ agrupar, ocultarInativas: !v }); return !v })
  }

  const inativas = contas.filter(c => !c.ativo).length
  const visiveis = useMemo(
    () => (ocultarInativas ? contas.filter(c => c.ativo) : contas),
    [contas, ocultarInativas],
  )

  // Agrupado: uma seção por tipo, na ordem de TIPO_OPTIONS (tipo desconhecido no fim).
  const grupos = useMemo(() => {
    if (!agrupar) return null
    const ordem = TIPO_OPTIONS.map(o => o.value)
    const porTipo = new Map<string, Conta[]>()
    for (const c of visiveis) {
      const t = c.tipo && ordem.includes(c.tipo) ? c.tipo : 'outro'
      const arr = porTipo.get(t) ?? []
      arr.push(c)
      porTipo.set(t, arr)
    }
    return ordem
      .filter(t => porTipo.has(t))
      .map(t => ({ tipo: t, label: TIPO_LABEL[t] ?? t, itens: porTipo.get(t)! }))
  }, [agrupar, visiveis])

  function toggleAtivo(c: Conta) {
    startTransition(async () => {
      await updateConta(orgSlug, c.id, { ativo: !c.ativo })
      router.refresh()
    })
  }

  function toggleFavorita(c: Conta) {
    startTransition(async () => {
      const res = await setContaFavorita(orgSlug, c.id)
      if (res?.error) { toast.error(res.error); return }
      toast.success(c.favorita ? 'Conta favorita removida' : `${c.nome} é a conta padrão do faturamento`)
      router.refresh()
    })
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Contas financeiras</h1>
          <p className="text-gray-500 text-sm mt-0.5">Bancos e caixa — usadas na baixa e na posição das contas</p>
        </div>
        <button onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition shrink-0">
          <Plus className="w-4 h-4" /> Adicionar conta
        </button>
      </div>

      {/* Preferências de view — ficam salvas por usuário/org */}
      {contas.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button onClick={toggleAgrupar}
            className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors active:scale-[0.97]',
              agrupar ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>
            <Layers className="w-3.5 h-3.5" /> Agrupar por tipo
          </button>
          {inativas > 0 && (
            <button onClick={toggleOcultarInativas}
              className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors active:scale-[0.97]',
                ocultarInativas ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50')}>
              {ocultarInativas ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              Ocultar inativas
              <span className="text-[10px] text-gray-400">({inativas})</span>
            </button>
          )}
        </div>
      )}

      {contas.length > 0 ? (
        grupos ? (
          <div className="space-y-6">
            {grupos.map(g => (
              <section key={g.tipo}>
                <div className="flex items-center gap-2 mb-2.5">
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{g.label}</h2>
                  <span className="text-[10px] text-gray-400">{g.itens.length}</span>
                  {/* No cartão o saldo é sempre ~0 até a fatura ser paga — o
                      número que resume o grupo é a fatura em aberto. */}
                  <span className="ml-auto text-xs text-gray-500 tabular-nums">
                    {g.tipo === 'cartao'
                      ? `${formatBRL(g.itens.reduce((s, c) => s + (c.faturas ?? []).reduce((a, f) => a + f.total, 0), 0))} em faturas`
                      : formatBRL(g.itens.reduce((s, c) => s + Number(c.saldo_atual ?? 0), 0))}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {g.itens.map(c => (
                    <ContaCard key={c.id} conta={c} orgSlug={orgSlug} isPending={isPending}
                      onEditar={() => setEditing(c)} onToggleAtivo={() => toggleAtivo(c)}
                      onToggleFavorita={() => toggleFavorita(c)} onPagarFatura={() => setPagando(c)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {visiveis.map(c => (
              <ContaCard key={c.id} conta={c} orgSlug={orgSlug} isPending={isPending}
                onEditar={() => setEditing(c)} onToggleAtivo={() => toggleAtivo(c)}
                onToggleFavorita={() => toggleFavorita(c)} onPagarFatura={() => setPagando(c)} />
            ))}
          </div>
        )
      ) : (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <Landmark className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Nenhuma conta ainda</h3>
          <p className="text-gray-500 text-sm mt-1">Cadastre suas contas bancárias e o caixa.</p>
        </div>
      )}

      {(creating || editing) && (
        <ContaModal orgSlug={orgSlug} conta={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      )}
      {pagando && (
        <FaturaModal orgSlug={orgSlug} cartao={pagando}
          contasPagamento={contas.filter(x => x.ativo && x.tipo !== 'cartao')}
          onClose={() => setPagando(null)} />
      )}
    </div>
  )
}

function ContaCard({ conta: c, orgSlug, isPending, onEditar, onToggleAtivo, onToggleFavorita, onPagarFatura }: {
  conta: Conta; orgSlug: string; isPending: boolean
  onEditar: () => void; onToggleAtivo: () => void; onToggleFavorita: () => void; onPagarFatura: () => void
}) {
  const saldo = Number(c.saldo_atual ?? 0)
  const ehCartao = c.tipo === 'cartao'
  const faturasAbertas = c.faturas ?? []
  const proxima = faturasAbertas[0] ?? null
  const faturaTotal = faturasAbertas.reduce((s, f) => s + f.total, 0)
  return (
    <div className={cn('group/conta bg-white rounded-2xl border p-4 flex flex-col gap-3 transition hover:shadow-sm',
      c.favorita ? 'border-orange-200 ring-1 ring-orange-100' : 'border-gray-200 hover:border-gray-300',
      !c.ativo && 'opacity-60')}>
      {/* identidade + tipo */}
      <div className="flex items-start justify-between gap-2">
        <Link href={`/${orgSlug}/financeiro/contas/${c.id}`} className="min-w-0 flex items-start gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: c.cor ?? '#cbd5e1' }} />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-gray-900 truncate group-hover/conta:text-orange-600 transition-colors">{c.nome}</span>
            <span className={cn('inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full mt-1',
              TIPO_TAG[c.tipo ?? 'outro'] ?? TIPO_TAG.outro)}>
              {c.tipo ? TIPO_LABEL[c.tipo] ?? c.tipo : 'Sem tipo'}
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-1.5 shrink-0">
          {!c.ativo && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inativa</span>
          )}
          {/* Estrela: a favorita é a conta a receber padrão do Faturamento. */}
          <button onClick={onToggleFavorita} disabled={isPending}
            title={c.favorita ? 'Conta padrão do faturamento — clique para remover' : 'Definir como conta padrão do faturamento'}
            aria-pressed={c.favorita}
            className={cn('p-1 rounded-lg transition-colors active:scale-[0.9] disabled:opacity-50',
              c.favorita ? 'text-orange-500 hover:text-orange-600' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100')}>
            <Star className={cn('w-4 h-4', c.favorita && 'fill-current')} />
          </button>
        </div>
      </div>

      {/* saldo — o dado principal do bloco. No cartão o número que importa não é
          o saldo (que fica zerado até a fatura ser paga), é a fatura aberta. */}
      {ehCartao ? (
        <Link href={`/${orgSlug}/financeiro/contas/${c.id}`} className="block">
          <span className="block text-[11px] text-gray-400">
            {proxima ? `Fatura de ${formatDateBR(proxima.vence)}` : 'Fatura aberta'}
          </span>
          <span className={cn('block text-xl font-semibold tabular-nums', faturaTotal > 0 ? 'text-violet-700' : 'text-gray-400')}>
            {formatBRL(faturaTotal)}
          </span>
          <span className="block text-[11px] text-gray-400 mt-0.5">
            {proxima ? `${proxima.compras} compra(s)` : 'sem compras em aberto'}
            {c.limite ? ` · limite ${formatBRL(c.limite)}` : ''}
          </span>
        </Link>
      ) : (
        <Link href={`/${orgSlug}/financeiro/contas/${c.id}`} className="block">
          <span className="block text-[11px] text-gray-400">Saldo atual</span>
          <span className={cn('block text-xl font-semibold tabular-nums', saldo < 0 ? 'text-red-600' : 'text-gray-900')}>
            {formatBRL(saldo)}
          </span>
        </Link>
      )}

      {/* ações */}
      <div className="flex items-center gap-1.5 pt-1 border-t border-gray-100 -mb-1">
        {ehCartao && faturaTotal > 0 ? (
          <button onClick={onPagarFatura}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-violet-700 hover:bg-violet-50 transition-colors active:scale-[0.97]">
            <CreditCard className="w-3.5 h-3.5" /> Pagar fatura
          </button>
        ) : (
          <Link href={`/${orgSlug}/financeiro/contas/${c.id}`}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:text-orange-600 hover:bg-orange-50 transition-colors active:scale-[0.97]">
            <Landmark className="w-3.5 h-3.5" /> Extrato
          </Link>
        )}
        <button onClick={onEditar}
          className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors active:scale-[0.97]">
          <Pencil className="w-3.5 h-3.5" /> Editar
        </button>
        <button onClick={onToggleAtivo} disabled={isPending} title={c.ativo ? 'Inativar' : 'Ativar'}
          className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50 active:scale-[0.97]">
          <Power className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

function ContaModal({ orgSlug, conta, onClose }: { orgSlug: string; conta: Conta | null; onClose: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    nome: conta?.nome ?? '',
    tipo: conta?.tipo ?? 'banco',
    saldo_inicial: conta?.saldo_inicial != null ? String(conta.saldo_inicial).replace('.', ',') : '0',
    cor: conta?.cor ?? COR_PRESETS[0],
    fechamento_dia: conta?.fechamentoDia != null ? String(conta.fechamentoDia) : '',
    vencimento_dia: conta?.vencimentoDia != null ? String(conta.vencimentoDia) : '',
    limite: conta?.limite != null ? String(conta.limite).replace('.', ',') : '',
  })
  const ehCartao = form.tipo === 'cartao'

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.nome.trim()) { setError('Nome obrigatório'); return }
    const dia = (s: string) => { const n = Number(s); return Number.isInteger(n) && n >= 1 && n <= 28 ? n : null }
    if (ehCartao && (!dia(form.fechamento_dia) || !dia(form.vencimento_dia))) {
      // 28 é o teto de propósito: dia 29–31 não existe em todo mês e a fatura
      // passaria a "pular" fevereiro.
      setError('No cartão, informe o dia de fechamento e o de vencimento (1 a 28).')
      return
    }
    const data = {
      nome: form.nome.trim(),
      tipo: form.tipo,
      saldo_inicial: form.saldo_inicial.replace(/\./g, '').replace(',', '.'),
      cor: form.cor,
      ativo: conta?.ativo ?? true,
      fechamento_dia: ehCartao ? String(dia(form.fechamento_dia)) : '',
      vencimento_dia: ehCartao ? String(dia(form.vencimento_dia)) : '',
      limite: ehCartao ? form.limite.replace(/\./g, '').replace(',', '.') : '',
    }
    startTransition(async () => {
      const res = conta
        ? await updateConta(orgSlug, conta.id, data)
        : await createConta(orgSlug, data)
      if (res?.error) { setError(res.error); return }
      onClose()
      router.refresh()
    })
  }

  return (
    <Modal open onClose={onClose} size="md">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">{conta ? 'Editar conta' : 'Nova conta'}</h2>
        <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
      </div>

      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div>
          <label className={labelCls}>Nome <span className="text-red-500">*</span></label>
          <input type="text" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
            placeholder="Ex.: BTG Pactual, Caixinha" className={inputCls} required />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Tipo</label>
            <Select value={form.tipo} onChange={v => setForm(f => ({ ...f, tipo: v }))} options={TIPO_OPTIONS} />
          </div>
          <div>
            <label className={labelCls}>{ehCartao ? 'Limite (R$)' : 'Saldo inicial (R$)'}</label>
            {ehCartao ? (
              <input type="text" inputMode="decimal" value={form.limite} placeholder="opcional"
                onChange={e => setForm(f => ({ ...f, limite: e.target.value }))} className={inputCls} />
            ) : (
              <input type="text" inputMode="decimal" value={form.saldo_inicial}
                onChange={e => setForm(f => ({ ...f, saldo_inicial: e.target.value }))} className={inputCls} />
            )}
          </div>
        </div>

        {ehCartao && (
          <div className="rounded-xl bg-violet-50/60 border border-violet-100 p-3 space-y-3">
            <p className="text-xs text-violet-900">
              As compras entram como despesas na conta do cartão; pagar a fatura vira uma transferência do banco pro cartão — o dinheiro sai uma vez só.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Fecha no dia</label>
                <input type="number" min={1} max={28} value={form.fechamento_dia}
                  onChange={e => setForm(f => ({ ...f, fechamento_dia: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Vence no dia</label>
                <input type="number" min={1} max={28} value={form.vencimento_dia}
                  onChange={e => setForm(f => ({ ...f, vencimento_dia: e.target.value }))} className={inputCls} />
              </div>
            </div>
          </div>
        )}

        <div>
          <label className={labelCls}>Cor</label>
          <div className="flex items-center gap-2 flex-wrap">
            {COR_PRESETS.map(c => (
              <button key={c} type="button" onClick={() => setForm(f => ({ ...f, cor: c }))}
                className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                style={{ backgroundColor: c, borderColor: form.cor === c ? c : 'transparent', outline: form.cor === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />
            ))}
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
              <input type="color" value={form.cor} onChange={e => setForm(f => ({ ...f, cor: e.target.value }))}
                className="w-7 h-7 rounded cursor-pointer border border-gray-200" />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button type="submit" disabled={isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Pagar a fatura: escolhe o ciclo, a conta de onde o dinheiro sai e a data.
 * O servidor liquida as compras e cria a transferência banco → cartão — é assim
 * que N compras viram UMA saída de caixa sem contar a despesa duas vezes.
 */
function FaturaModal({ orgSlug, cartao, contasPagamento, onClose }: {
  orgSlug: string; cartao: Conta; contasPagamento: Conta[]; onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const faturas = cartao.faturas ?? []
  const [vence, setVence] = useState(faturas[0]?.vence ?? '')
  const [contaId, setContaId] = useState(contasPagamento.find(c => c.favorita)?.id ?? contasPagamento[0]?.id ?? '')
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))

  const fatura = faturas.find(f => f.vence === vence) ?? null

  function pagar() {
    setError('')
    if (!vence) { setError('Escolha a fatura.'); return }
    if (!contaId) { setError('Escolha a conta de onde o dinheiro sai.'); return }
    startTransition(async () => {
      const res = await pagarFaturaCartao(orgSlug, cartao.id, vence, contaId, data)
      if (res?.error) { setError(res.error); return }
      toast.success(`Fatura paga — ${res?.result?.compras} compra(s), ${formatBRL(Number(res?.result?.total ?? 0))}.`)
      onClose()
      router.refresh()
    })
  }

  return (
    <Modal open onClose={onClose} size="md">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Pagar fatura · {cartao.nome}</h2>
        <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
      </div>
      <div className="px-6 py-5 space-y-4">
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div>
          <label className={labelCls}>Fatura</label>
          <Select value={vence} onChange={setVence} placeholder="Escolha a fatura"
            options={faturas.map(f => ({
              value: f.vence,
              label: `Vence ${formatDateBR(f.vence)} · ${f.compras} compra(s) · ${formatBRL(f.total)}`,
            }))} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Pagar com</label>
            <Select value={contaId} onChange={setContaId} placeholder="Conta"
              options={contasPagamento.map(c => ({ value: c.id, label: c.nome }))} />
          </div>
          <div>
            <label className={labelCls}>Data do pagamento</label>
            <input type="date" value={data} onChange={e => setData(e.target.value)} className={inputCls} />
          </div>
        </div>

        {fatura && (
          <div className="flex items-center justify-between rounded-xl bg-violet-50/60 border border-violet-100 px-4 py-3">
            <span className="text-sm text-violet-900">{fatura.compras} compra(s) serão baixadas</span>
            <span className="text-base font-semibold text-violet-800 tabular-nums">{formatBRL(fatura.total)}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button type="button" onClick={pagar} disabled={isPending || !fatura}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            Pagar fatura
          </button>
        </div>
      </div>
    </Modal>
  )
}
