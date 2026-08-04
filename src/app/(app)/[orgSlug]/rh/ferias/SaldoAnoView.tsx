'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CalendarDays, Plus, X, Check, Loader2, Pencil, Trash2, ChevronDown, RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  lancarDia, excluirLancamento, salvarRecesso, ajustarRetorno,
  type SaldoAno, type LancamentoFerias,
} from '@/app/actions/rh-ferias'

/** Uma única definição de grade para o cabeçalho e as linhas ficarem alinhados. */
const COLS = 'grid grid-cols-[minmax(180px,2.2fr)_repeat(6,minmax(64px,1fr))] gap-2 items-start'

const dataBR = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}` }
const curto  = (d: string) => { const [, m, dd] = d.split('-'); return `${dd}/${m}` }
/** 15 e não 15,0; 10,5 e não 10.5. */
export const nDias = (n: number) => {
  const v = Number(n ?? 0)
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace('.', ',')
}

export function SaldoAnoView({ orgSlug, saldos, lancamentos, ano }: {
  orgSlug: string; saldos: SaldoAno[]; lancamentos: LancamentoFerias[]; ano: number
}) {
  const router = useRouter()
  const [aberta, setAberta] = useState<string | null>(null)
  const [lancando, setLancando] = useState<SaldoAno | null>(null)
  const [editandoLanc, setEditandoLanc] = useState<LancamentoFerias | null>(null)
  const [excluindo, setExcluindo] = useState<LancamentoFerias | null>(null)
  const [recesso, setRecesso] = useState(false)
  const [voltaDe, setVoltaDe] = useState<SaldoAno | null>(null)
  const [pending, start] = useTransition()

  const recessoInicio = saldos.find(s => s.recesso_inicio)?.recesso_inicio ?? null
  const porPessoa = useMemo(() => {
    const m = new Map<string, LancamentoFerias[]>()
    for (const l of lancamentos) m.set(l.colaborador_id, [...(m.get(l.colaborador_id) ?? []), l])
    return m
  }, [lancamentos])

  const totalRecesso = saldos.reduce((s, l) => s + Math.max(0, Number(l.saldo_projetado)), 0)

  function apagar() {
    if (!excluindo) return
    const alvo = excluindo
    start(async () => {
      const r = await excluirLancamento(orgSlug, alvo.id)
      if (r?.error) { toast.error(r.error); return }
      setExcluindo(null); toast.success('Desconto removido.'); router.refresh()
    })
  }

  return (
    <>
      {/* O recesso é o destino de tudo que sobra — por isso ele abre a tela. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 mb-5 flex items-center gap-4 flex-wrap">
        <CalendarDays className="w-5 h-5 text-orange-600 shrink-0" />
        {recessoInicio ? (
          <>
            <div>
              <p className="text-[11px] text-gray-400">Recesso de {ano}</p>
              <p className="text-sm font-medium text-gray-900">
                começa em <span className="tabular-nums">{dataBR(recessoInicio)}</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400">Dias a gozar no recesso</p>
              <p className="text-sm font-medium text-gray-900 tabular-nums">{nDias(totalRecesso)}</p>
            </div>
          </>
        ) : (
          <div>
            <p className="text-sm font-medium text-gray-900">Recesso de {ano} ainda não definido</p>
            <p className="text-xs text-gray-500">
              Sem o primeiro dia não dá para calcular a volta de cada um.
            </p>
          </div>
        )}
        <button onClick={() => setRecesso(true)}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition active:scale-[0.97]">
          <Pencil className="w-3.5 h-3.5" /> {recessoInicio ? 'Alterar' : 'Definir'}
        </button>
      </div>

      {saldos.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center bg-white rounded-2xl border border-gray-200">
          Nenhum CLT ativo com data de admissão em {ano}.
        </p>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
          <div className="min-w-[720px]">
            <div className={cn(COLS, 'text-xs text-gray-400 border-b border-gray-100 px-4 py-2.5')}>
              <span>Pessoa</span>
              <span className="text-right">Adquiridos</span>
              <span className="text-right">Emendas</span>
              <span className="text-right">Avulsos</span>
              <span className="text-right">Saldo hoje</span>
              <span className="text-right">No recesso</span>
              <span className="text-right">Volta</span>
            </div>
            {saldos.map(s => {
              const lista = porPessoa.get(s.colaborador_id) ?? []
              const expandida = aberta === s.colaborador_id
              return (
                <div key={s.colaborador_id}
                  className={cn('border-b border-gray-50 last:border-b-0 transition-colors', expandida && 'bg-gray-50/60')}>
                  <button onClick={() => setAberta(expandida ? null : s.colaborador_id)}
                    className={cn(COLS, 'w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50/80 transition-colors')}>
                    <span className="flex items-center gap-1.5 min-w-0">
                      <ChevronDown className={cn('w-3.5 h-3.5 text-gray-300 shrink-0 transition-transform duration-150',
                        expandida && 'rotate-180 text-gray-500')} />
                      <span className="min-w-0">
                        <span className="block text-gray-900 leading-tight truncate">{s.pessoa}</span>
                        <span className="block text-[11px] text-gray-400 tabular-nums">
                          desde {dataBR(s.data_admissao)}
                        </span>
                      </span>
                    </span>
                    <span className="text-right tabular-nums text-gray-700">
                      {nDias(s.dias_ate_hoje)}
                      {Number(s.dias_ano) !== Number(s.dias_ate_hoje) && (
                        <span className="block text-[11px] text-gray-400">{nDias(s.dias_ano)} até dez</span>
                      )}
                    </span>
                    <span className="text-right tabular-nums text-gray-500">
                      {Number(s.dias_pontes) > 0 ? `− ${nDias(s.dias_pontes)}` : '—'}
                    </span>
                    <span className="text-right tabular-nums text-gray-500">
                      {Number(s.dias_lancamentos) > 0 ? `− ${nDias(s.dias_lancamentos)}` : '—'}
                    </span>
                    <span className="text-right tabular-nums font-medium text-gray-900">{nDias(s.saldo_atual)}</span>
                    <span className="text-right tabular-nums text-gray-700">{nDias(s.saldo_projetado)}</span>
                    <span className="text-right">
                      {s.recesso_retorno ? (
                        <span className={cn('tabular-nums', s.retorno_ajustado ? 'text-orange-700 font-medium' : 'text-gray-700')}>
                          {curto(s.recesso_retorno)}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </span>
                  </button>

                  {expandida && (
                    <div className="px-4 pb-4 pt-1">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <button onClick={() => setLancando(s)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition active:scale-[0.97]">
                          <Plus className="w-3.5 h-3.5" /> Descontar dia
                        </button>
                        <button onClick={() => setVoltaDe(s)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition active:scale-[0.97]">
                          <CalendarDays className="w-3.5 h-3.5" /> Ajustar a volta
                        </button>
                        {s.retorno_ajustado && (
                          <span className="text-[11px] text-orange-700">volta definida na mão</span>
                        )}
                      </div>
                      {lista.length === 0 ? (
                        <p className="text-xs text-gray-400">Nenhum dia avulso descontado em {ano}.</p>
                      ) : (
                        <div className="space-y-1">
                          {lista.map(l => (
                            <div key={l.id} className="flex items-center gap-2 text-xs flex-wrap">
                              <span className="tabular-nums text-gray-600">
                                {dataBR(l.inicio)}{l.fim !== l.inicio && ` – ${dataBR(l.fim)}`}
                              </span>
                              <span className="text-gray-400">− {nDias(l.dias)} dia(s)</span>
                              {l.tipo === 'ferias' && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">férias</span>
                              )}
                              {l.motivo && <span className="text-gray-400 truncate">· {l.motivo}</span>}
                              <span className="ml-auto flex items-center gap-1">
                                <button onClick={() => setEditandoLanc(l)} title="Editar"
                                  className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setExcluindo(l)} title="Remover"
                                  className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3 max-w-2xl">
        2,5 dias por mês do ano civil (o mês da admissão conta com 15+ dias de vínculo). Emenda de
        feriado desconta 1 dia; dia avulso desconta o que for lançado. A volta do recesso é o
        primeiro dia dele mais o saldo, em dias corridos — meio dia não vira folga.
      </p>

      {(lancando || editandoLanc) && (
        <LancamentoModal orgSlug={orgSlug} pessoa={lancando} lancamento={editandoLanc}
          onClose={() => { setLancando(null); setEditandoLanc(null) }} />
      )}
      {recesso && (
        <RecessoModal orgSlug={orgSlug} ano={ano} inicio={recessoInicio} onClose={() => setRecesso(false)} />
      )}
      {voltaDe && (
        <VoltaModal orgSlug={orgSlug} ano={ano} linha={voltaDe} onClose={() => setVoltaDe(null)} />
      )}
      <ConfirmDialog
        open={!!excluindo}
        title="Remover desconto"
        description={excluindo
          ? `${nDias(excluindo.dias)} dia(s) de ${dataBR(excluindo.inicio)} voltam para o saldo.`
          : ''}
        confirmLabel="Remover" loading={pending}
        onConfirm={apagar} onCancel={() => setExcluindo(null)}
      />
    </>
  )
}

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

function LancamentoModal({ orgSlug, pessoa, lancamento, onClose }: {
  orgSlug: string; pessoa: SaldoAno | null; lancamento: LancamentoFerias | null; onClose: () => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [inicio, setInicio] = useState(lancamento?.inicio ?? '')
  const [fim, setFim] = useState(lancamento?.fim ?? '')
  const [dias, setDias] = useState(lancamento ? String(lancamento.dias) : '')
  const [tipo, setTipo] = useState(lancamento?.tipo ?? 'avulso')
  const [motivo, setMotivo] = useState(lancamento?.motivo ?? '')
  const [erro, setErro] = useState('')

  const colabId = lancamento?.colaborador_id ?? pessoa?.colaborador_id ?? ''
  // O intervalo é só o palpite: uma ausência pode pular o fim de semana e o RH
  // desconta menos dias do que o período tem.
  const sugerido = inicio && fim && fim >= inicio
    ? Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000) + 1
    : inicio ? 1 : 0

  function salvar() {
    setErro('')
    if (!inicio) { setErro('Informe a data.'); return }
    start(async () => {
      const r = await lancarDia(orgSlug, {
        id: lancamento?.id ?? null, colaborador_id: colabId,
        inicio, fim: fim || inicio, dias: Number(dias) || sugerido || 1,
        tipo, motivo: motivo || null,
      })
      if (r?.error) { setErro(r.error); return }
      toast.success(lancamento ? 'Desconto atualizado.' : 'Dia descontado do saldo.')
      onClose(); router.refresh()
    })
  }

  const titulo = lancamento ? 'Editar desconto' : `Descontar dia — ${pessoa?.pessoa ?? ''}`
  return (
    <Modal open onClose={onClose} size="sm" label={titulo}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900 truncate">{titulo}</h2>
        <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
      </div>
      <div className="px-6 py-5 space-y-4">
        {erro && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{erro}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>De</label>
            <input type="date" value={inicio} onChange={e => setInicio(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Até</label>
            <input type="date" value={fim} min={inicio || undefined} onChange={e => setFim(e.target.value)} className={inputCls} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Dias a descontar</label>
            <input type="number" step="0.5" min="0.5" value={dias}
              onChange={e => setDias(e.target.value)} placeholder={sugerido ? String(sugerido) : ''} className={inputCls} />
            <p className="text-[11px] text-gray-400 mt-1">Vazio usa o período ({sugerido || 1}).</p>
          </div>
          <div>
            <label className={labelCls}>Tipo</label>
            <Select value={tipo} onChange={v => setTipo(v as 'avulso' | 'ferias')} options={[
              { value: 'avulso', label: 'Dia avulso' },
              { value: 'ferias', label: 'Férias no ano' },
            ]} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Motivo</label>
          <input value={motivo} onChange={e => setMotivo(e.target.value)} className={inputCls} placeholder="Viagem, consulta…" />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button onClick={salvar} disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
          </button>
        </div>
      </div>
    </Modal>
  )
}

function RecessoModal({ orgSlug, ano, inicio: atual, onClose }: {
  orgSlug: string; ano: number; inicio: string | null; onClose: () => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [inicio, setInicio] = useState(atual ?? `${ano}-12-22`)
  const [erro, setErro] = useState('')

  function salvar() {
    setErro('')
    if (!inicio) { setErro('Informe o primeiro dia.'); return }
    start(async () => {
      const r = await salvarRecesso(orgSlug, ano, inicio)
      if (r?.error) { setErro(r.error); return }
      toast.success('Recesso salvo — as voltas foram recalculadas.')
      onClose(); router.refresh()
    })
  }

  return (
    <Modal open onClose={onClose} size="sm" label={`Recesso de ${ano}`}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Recesso de {ano}</h2>
        <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
      </div>
      <div className="px-6 py-5 space-y-4">
        {erro && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{erro}</p>}
        <div>
          <label className={labelCls}>Primeiro dia de recesso</label>
          <input type="date" value={inicio} onChange={e => setInicio(e.target.value)} className={inputCls} />
          <p className="text-[11px] text-gray-400 mt-1">
            A volta de cada um é esta data mais o saldo projetado, em dias corridos. Quem tem menos
            saldo volta antes.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button onClick={salvar} disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
          </button>
        </div>
      </div>
    </Modal>
  )
}

function VoltaModal({ orgSlug, ano, linha, onClose }: {
  orgSlug: string; ano: number; linha: SaldoAno; onClose: () => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [retorno, setRetorno] = useState(linha.recesso_retorno ?? '')
  const [erro, setErro] = useState('')

  function salvar(valor: string | null) {
    setErro('')
    start(async () => {
      const r = await ajustarRetorno(orgSlug, ano, linha.colaborador_id, valor)
      if (r?.error) { setErro(r.error); return }
      toast.success(valor ? 'Volta ajustada.' : 'Volta de volta ao cálculo automático.')
      onClose(); router.refresh()
    })
  }

  return (
    <Modal open onClose={onClose} size="sm" label={`Volta de ${linha.pessoa}`}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900 truncate">Volta de {linha.pessoa}</h2>
        <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
      </div>
      <div className="px-6 py-5 space-y-4">
        {erro && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{erro}</p>}
        <p className="text-xs text-gray-500">
          Saldo projetado <strong className="text-gray-800">{nDias(linha.saldo_projetado)} dias</strong>
          {linha.recesso_inicio && <> · recesso começa {dataBR(linha.recesso_inicio)}</>}
        </p>
        <div>
          <label className={labelCls}>Volta ao trabalho em</label>
          <input type="date" value={retorno} onChange={e => setRetorno(e.target.value)} className={inputCls} />
        </div>
        <div className="flex justify-between gap-2">
          <button onClick={() => salvar(null)} disabled={pending || !linha.retorno_ajustado}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 disabled:opacity-40 transition">
            <RotateCcw className="w-3.5 h-3.5" /> Voltar ao cálculo
          </button>
          <span className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
            <button onClick={() => salvar(retorno || null)} disabled={pending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
            </button>
          </span>
        </div>
      </div>
    </Modal>
  )
}
