'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Palmtree, AlertTriangle, Plus, Check, X, Gift, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { formatBRL } from '@/lib/midia'
import {
  programarFerias, mudarStatusFerias,
  type PeriodoFerias, type LinhaDecimo, type SaldoAno, type PonteLinha, type LancamentoFerias,
} from '@/app/actions/rh-ferias'
import { SaldoAnoView } from './SaldoAnoView'
import { PontesView } from './PontesView'

export interface FeriasGozo {
  id: string; colaborador_id: string; periodo_inicio: string
  inicio: string; fim: string; dias: number; abono_dias: number
  status: 'programada' | 'gozada' | 'cancelada'; observacao: string | null
}

const dataBR = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}` }

/* Rótulos deliberadamente neutros. O ciclo aqui é estimado da data de admissão,
 * e os recibos da folha provaram que o oficial costuma ser outro: quem entra no
 * recesso antes de completar 12 meses tem o período reiniciado (art. 140) — a
 * Danielle conta 21/12→20/12 e a Sthefany 18/12→17/12, nenhuma das duas pela
 * admissão. Enquanto o Flow não tiver esse marco, ele não pode dizer "vencido"
 * nem falar em férias em dobro: estaria acusando um atraso que não existe. */
const SITUACAO: Record<PeriodoFerias['situacao'], { rotulo: string; cls: string }> = {
  vencido:        { rotulo: 'estimado · fora da janela', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  vence_em_breve: { rotulo: 'estimado · perto do limite', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  aberto:         { rotulo: 'estimado · em aberto',      cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  em_formacao:    { rotulo: 'em formação',               cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  quitado:        { rotulo: 'quitado',                   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

type Aba = 'saldo' | 'emendas' | 'clt'

export function FeriasClient({
  orgSlug, periodos, decimo, gozos, saldos, pontes, lancamentos, ano, anoAtual, erro,
}: {
  orgSlug: string; periodos: PeriodoFerias[]; decimo: LinhaDecimo[]
  gozos: FeriasGozo[]; saldos: SaldoAno[]; pontes: PonteLinha[]; lancamentos: LancamentoFerias[]
  ano: number; anoAtual: number; erro: string | null
}) {
  const [aba, setAba] = useState<Aba>('saldo')
  const [programando, setProgramando] = useState<PeriodoFerias | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  const anos = useMemo(
    () => Array.from({ length: 4 }, (_, i) => anoAtual + 1 - i),
    [anoAtual],
  )
  const nPontes = useMemo(() => new Set(pontes.map(p => p.ponte_id)).size, [pontes])

  const totalDecimo = useMemo(() => decimo.reduce((s, d) => s + Number(d.total ?? 0), 0), [decimo])
  const gozosPorPeriodo = useMemo(() => {
    const m = new Map<string, FeriasGozo[]>()
    for (const g of gozos) {
      const k = `${g.colaborador_id}|${g.periodo_inicio}`
      m.set(k, [...(m.get(k) ?? []), g])
    }
    return m
  }, [gozos])

  // Períodos ainda em formação poluem a lista de trabalho: quem precisa de ação
  // é quem já venceu ou está por vencer.
  const [verTodos, setVerTodos] = useState(false)
  const visiveis = verTodos ? periodos : periodos.filter(p => p.situacao !== 'em_formacao' && p.situacao !== 'quitado')

  function statusGozo(id: string, status: string) {
    start(async () => {
      const r = await mudarStatusFerias(orgSlug, id, status)
      if (r?.error) { toast.error(r.error); return }
      toast.success(status === 'gozada' ? 'Marcado como gozado.' : 'Atualizado.')
      router.refresh()
    })
  }

  const ABAS: { id: Aba; rotulo: string }[] = [
    { id: 'saldo',   rotulo: `Saldo do ano · ${saldos.length}` },
    { id: 'emendas', rotulo: `Emendas · ${nPontes}` },
    { id: 'clt',     rotulo: '13º e estimativa CLT' },
  ]

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
          <Palmtree className="w-5 h-5 text-orange-600" /> Férias e 13º
        </h1>
        <p className="text-gray-500 text-sm">
          O controle da casa: saldo do ano, emendas e recesso. O período aquisitivo oficial é o do
          recibo da folha, não sai daqui. Só CLT entra.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {ABAS.map(a => (
            <button key={a.id} onClick={() => setAba(a.id)}
              className={cn('px-4 py-1.5 rounded-md transition-colors',
                aba === a.id ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>
              {a.rotulo}
            </button>
          ))}
        </div>
        <div className="ml-auto w-28">
          <Select value={String(ano)}
            onChange={v => router.push(`/${orgSlug}/rh/ferias?ano=${v}`)}
            options={anos.map(a => ({ value: String(a), label: String(a) }))} />
        </div>
      </div>

      {erro && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3 mb-5">{erro}</p>}

      {aba === 'saldo' && (
        <SaldoAnoView orgSlug={orgSlug} saldos={saldos} lancamentos={lancamentos} ano={ano} />
      )}
      {aba === 'emendas' && <PontesView orgSlug={orgSlug} pontes={pontes} ano={ano} />}

      {aba === 'clt' && <>
      {/* Antes havia aqui um alerta vermelho de "férias em dobro" a partir do
        * ciclo calculado da admissão. Os recibos da folha mostraram que esse
        * ciclo não é o oficial (art. 140) e que os vencimentos acusados não
        * existiam — a Danielle estava quitada. Alerta que aponta um passivo
        * inexistente é pior que alerta nenhum: virou o aviso abaixo. */}
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 mb-5">
        <p className="text-sm font-medium text-gray-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-gray-400" />
          Os períodos abaixo são estimativa, não o oficial
        </p>
        <p className="text-xs text-gray-500 mt-1 max-w-2xl">
          São contados de 12 em 12 meses a partir da admissão. Na prática o ciclo oficial costuma
          ser outro: quem entra no recesso de fim de ano antes de completar 12 meses tem o período
          reiniciado naquela data (art. 140 da CLT) — a Danielle conta 21/12→20/12 e a Sthefany
          18/12→17/12. Quem vale para prazo, vencimento e pagamento em dobro é o{' '}
          <strong className="text-gray-700">recibo de férias da folha</strong>.
        </p>
      </div>

      {/* 13º — não é gestão de período, mas é a conta que ninguém quer descobrir em novembro. */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 mb-6">
        <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <Gift className="w-4 h-4" /> 13º de {ano}
          </h2>
          <span className="text-xs text-gray-400">
            1ª parcela até 30/11 · 2ª até 20/12
          </span>
        </div>
        <div className="flex items-end gap-6 flex-wrap">
          <div>
            <p className="text-[11px] text-gray-400">Total do ano</p>
            <p className="text-xl font-semibold text-gray-900 tabular-nums">{formatBRL(totalDecimo)}</p>
          </div>
          <div>
            <p className="text-[11px] text-gray-400">Por parcela (aprox.)</p>
            <p className="text-base font-medium text-gray-700 tabular-nums">{formatBRL(totalDecimo / 2)}</p>
          </div>
          <p className="text-[11px] text-gray-400 max-w-sm">
            Proporcional aos meses com 15+ dias de vínculo, sobre o salário atual da ficha. Não inclui
            encargos nem média de variáveis.
          </p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="py-2 font-medium">Pessoa</th>
                <th className="py-2 font-medium text-right">Meses</th>
                <th className="py-2 font-medium text-right">1ª parcela</th>
                <th className="py-2 font-medium text-right">2ª parcela</th>
                <th className="py-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {decimo.map(d => (
                <tr key={d.colaborador_id}>
                  <td className="py-2 text-gray-800">{d.pessoa}</td>
                  <td className="py-2 text-right tabular-nums text-gray-500">{d.meses}/12</td>
                  <td className="py-2 text-right tabular-nums text-gray-600">{formatBRL(Number(d.parcela1))}</td>
                  <td className="py-2 text-right tabular-nums text-gray-600">{formatBRL(Number(d.parcela2))}</td>
                  <td className="py-2 text-right tabular-nums font-medium text-gray-900">{formatBRL(Number(d.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Períodos aquisitivos */}
      <section>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-gray-700">
            Períodos aquisitivos <span className="font-normal text-gray-400">(estimados)</span>
          </h2>
          <button onClick={() => setVerTodos(v => !v)}
            className="text-xs text-gray-500 hover:text-gray-700 transition">
            {verTodos ? 'Só o que precisa de ação' : 'Ver todos'}
          </button>
        </div>

        {visiveis.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center bg-white rounded-2xl border border-gray-200">
            Nada pendente. 🎉
          </p>
        ) : (
          <div className="space-y-2">
            {visiveis.map(p => {
              const sit = SITUACAO[p.situacao]
              const lista = gozosPorPeriodo.get(`${p.colaborador_id}|${p.periodo_inicio}`) ?? []
              return (
                <div key={`${p.colaborador_id}-${p.periodo_inicio}`} className="bg-white rounded-2xl border border-gray-200 p-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{p.pessoa}</span>
                    <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full border', sit.cls)}>{sit.rotulo}</span>
                    <span className="text-xs text-gray-500 tabular-nums">
                      {dataBR(p.periodo_inicio)} – {dataBR(p.periodo_fim)}
                    </span>
                    <span className="text-xs text-gray-400">
                      concessão até <span className="tabular-nums">{dataBR(p.limite)}</span>
                      {p.dias_para_limite < 0
                        ? <span className="text-red-600 font-medium"> · {-p.dias_para_limite} dias atrás</span>
                        : <span> · faltam {p.dias_para_limite} dias</span>}
                    </span>
                    <span className="ml-auto text-sm tabular-nums text-gray-700">
                      <strong>{p.dias_saldo}</strong> de {p.dias_direito} dias
                    </span>
                    {p.dias_saldo > 0 && !p.em_formacao && (
                      <button onClick={() => setProgramando(p)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition active:scale-[0.97]">
                        <Plus className="w-3.5 h-3.5" /> Programar
                      </button>
                    )}
                  </div>

                  {lista.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                      {lista.map(g => (
                        <div key={g.id} className="flex items-center gap-2 text-xs flex-wrap">
                          <span className="tabular-nums text-gray-600">{dataBR(g.inicio)} – {dataBR(g.fim)}</span>
                          <span className="text-gray-400">{g.dias} dias{g.abono_dias > 0 && ` + ${g.abono_dias} de abono`}</span>
                          <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                            g.status === 'gozada' ? 'bg-emerald-50 text-emerald-700'
                              : g.status === 'cancelada' ? 'bg-gray-100 text-gray-500' : 'bg-blue-50 text-blue-700')}>
                            {g.status}
                          </span>
                          {g.observacao && <span className="text-gray-400 truncate">· {g.observacao}</span>}
                          {g.status === 'programada' && (
                            <span className="ml-auto flex items-center gap-1">
                              <button onClick={() => statusGozo(g.id, 'gozada')} disabled={pending}
                                title="Marcar como gozada"
                                className="p-1 rounded text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition disabled:opacity-40">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => statusGozo(g.id, 'cancelada')} disabled={pending}
                                title="Cancelar"
                                className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-40">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
      </>}

      {programando && (
        <ProgramarModal orgSlug={orgSlug} periodo={programando} onClose={() => setProgramando(null)} />
      )}
    </div>
  )
}

function ProgramarModal({ orgSlug, periodo, onClose }: {
  orgSlug: string; periodo: PeriodoFerias; onClose: () => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')
  const [abono, setAbono] = useState('0')
  const [status, setStatus] = useState('programada')
  const [obs, setObs] = useState('')
  const [erro, setErro] = useState('')

  const dias = inicio && fim && fim >= inicio
    ? Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000) + 1
    : 0

  function salvar() {
    setErro('')
    if (!inicio || !fim) { setErro('Informe início e fim.'); return }
    start(async () => {
      const r = await programarFerias(orgSlug, {
        colaborador_id: periodo.colaborador_id, periodo_inicio: periodo.periodo_inicio,
        inicio, fim, abono_dias: Number(abono) || 0, status, observacao: obs || null,
      })
      if (r?.error) { setErro(r.error); return }
      toast.success(`${r.resultado?.dias} dia(s) registrados — restam ${r.resultado?.saldo_restante}.`)
      onClose(); router.refresh()
    })
  }

  const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <Modal open onClose={onClose} size="sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Férias de {periodo.pessoa}</h2>
        <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
      </div>
      <div className="px-6 py-5 space-y-4">
        {erro && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{erro}</p>}
        <p className="text-xs text-gray-500">
          Período aquisitivo {dataBR(periodo.periodo_inicio)} – {dataBR(periodo.periodo_fim)} ·
          saldo <strong className="text-gray-800">{periodo.dias_saldo} dias</strong> ·
          conceder até <strong className="text-gray-800">{dataBR(periodo.limite)}</strong>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Início</label>
            <input type="date" value={inicio} onChange={e => setInicio(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Fim</label>
            <input type="date" value={fim} min={inicio || undefined} onChange={e => setFim(e.target.value)} className={inputCls} /></div>
        </div>
        {dias > 0 && (
          <p className="text-xs text-gray-500">{dias} dias corridos.</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Abono pecuniário</label>
            <input type="number" min={0} max={10} value={abono} onChange={e => setAbono(e.target.value)} className={inputCls} />
            <p className="text-[11px] text-gray-400 mt-1">Venda de até 1/3 (máx. 10 dias).</p>
          </div>
          <div>
            <label className={labelCls}>Situação</label>
            <Select value={status} onChange={setStatus} options={[
              { value: 'programada', label: 'Programada' },
              { value: 'gozada', label: 'Já foi gozada' },
            ]} />
            <p className="text-[11px] text-gray-400 mt-1">Use “já gozada” para registrar o passado.</p>
          </div>
        </div>
        <div>
          <label className={labelCls}>Observação</label>
          <input value={obs} onChange={e => setObs(e.target.value)} className={inputCls} placeholder="Opcional" />
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
