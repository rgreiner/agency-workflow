'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, X, Check, Loader2, Pencil, Trash2, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { salvarPonte, excluirPonte, marcarAdesao, type PonteLinha } from '@/app/actions/rh-ferias'
import { nDias } from './SaldoAnoView'

const dataBR = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}` }

interface Ponte {
  id: string; nome: string; inicio: string; fim: string; custo_dias: number
  observacao: string | null; pessoas: { id: string; nome: string; aderiu: boolean }[]
}

export function PontesView({ orgSlug, pontes, ano }: {
  orgSlug: string; pontes: PonteLinha[]; ano: number
}) {
  const router = useRouter()
  const [editando, setEditando] = useState<Ponte | null>(null)
  const [criando, setCriando] = useState(false)
  const [excluindo, setExcluindo] = useState<Ponte | null>(null)
  const [pending, start] = useTransition()

  // A RPC devolve o produto (emenda × pessoa); aqui vira um card por emenda.
  const lista = useMemo(() => {
    const m = new Map<string, Ponte>()
    for (const p of pontes) {
      const atual = m.get(p.ponte_id) ?? {
        id: p.ponte_id, nome: p.nome, inicio: p.inicio, fim: p.fim,
        custo_dias: Number(p.custo_dias), observacao: p.observacao, pessoas: [],
      }
      atual.pessoas.push({ id: p.colaborador_id, nome: p.pessoa, aderiu: p.aderiu })
      m.set(p.ponte_id, atual)
    }
    return [...m.values()]
  }, [pontes])

  function alternar(ponteId: string, colaboradorId: string, aderiu: boolean) {
    start(async () => {
      const r = await marcarAdesao(orgSlug, ponteId, colaboradorId, aderiu)
      if (r?.error) { toast.error(r.error); return }
      router.refresh()
    })
  }

  function apagar() {
    if (!excluindo) return
    const alvo = excluindo
    start(async () => {
      const r = await excluirPonte(orgSlug, alvo.id)
      if (r?.error) { toast.error(r.error); return }
      setExcluindo(null); toast.success('Emenda excluída — os dias voltaram ao saldo.'); router.refresh()
    })
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <p className="text-xs text-gray-500 max-w-xl">
          Todo mundo que já estava na casa entra na emenda descontando{' '}
          <strong className="text-gray-700">1 dia</strong> do saldo, por mais dias que ela tenha.
          Desmarque quem trabalhou.
        </p>
        <button onClick={() => setCriando(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition active:scale-[0.97]">
          <Plus className="w-3.5 h-3.5" /> Nova emenda
        </button>
      </div>

      {lista.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center bg-white rounded-2xl border border-gray-200">
          Nenhuma emenda de feriado cadastrada em {ano}.
        </p>
      ) : (
        <div className="space-y-3">
          {lista.map(p => {
            const aderiram = p.pessoas.filter(x => x.aderiu).length
            return (
              <div key={p.id} className="bg-white rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <Link2 className="w-4 h-4 text-orange-600 shrink-0" />
                  <span className="text-sm font-medium text-gray-900">{p.nome}</span>
                  <span className="text-xs text-gray-500 tabular-nums">
                    {dataBR(p.inicio)}{p.fim !== p.inicio && ` – ${dataBR(p.fim)}`}
                  </span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-gray-200 text-gray-500">
                    custa {nDias(p.custo_dias)} dia
                  </span>
                  <span className="text-xs text-gray-400">{aderiram} de {p.pessoas.length} emendaram</span>
                  {p.observacao && <span className="text-xs text-gray-400 truncate">· {p.observacao}</span>}
                  <span className="ml-auto flex items-center gap-1">
                    <button onClick={() => setEditando(p)} title="Editar"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setExcluindo(p)} title="Excluir"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-1.5">
                  {p.pessoas.map(x => (
                    <button key={x.id} disabled={pending}
                      onClick={() => alternar(p.id, x.id, !x.aderiu)}
                      title={x.aderiu ? 'Emendou — clique para tirar' : 'Trabalhou — clique para incluir'}
                      className={cn('inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-xs border transition-colors active:scale-[0.97] disabled:opacity-50',
                        x.aderiu
                          ? 'bg-orange-50 border-orange-200 text-orange-800 hover:bg-orange-100'
                          : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100 line-through')}>
                      {x.aderiu ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                      {x.nome}
                    </button>
                  ))}
                  {p.pessoas.length === 0 && (
                    <span className="text-xs text-gray-400">
                      Ninguém da equipe atual já estava na casa nesta data.
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(criando || editando) && (
        <PonteModal orgSlug={orgSlug} ano={ano} ponte={editando}
          onClose={() => { setCriando(false); setEditando(null) }} />
      )}
      <ConfirmDialog
        open={!!excluindo}
        title="Excluir emenda"
        description={excluindo
          ? `“${excluindo.nome}” sai do controle e ${nDias(excluindo.custo_dias)} dia volta ao saldo de quem emendou.`
          : ''}
        loading={pending} onConfirm={apagar} onCancel={() => setExcluindo(null)}
      />
    </>
  )
}

function PonteModal({ orgSlug, ano, ponte, onClose }: {
  orgSlug: string; ano: number; ponte: Ponte | null; onClose: () => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [nome, setNome] = useState(ponte?.nome ?? '')
  const [inicio, setInicio] = useState(ponte?.inicio ?? '')
  const [fim, setFim] = useState(ponte?.fim ?? '')
  const [custo, setCusto] = useState(String(ponte?.custo_dias ?? 1))
  const [obs, setObs] = useState(ponte?.observacao ?? '')
  const [erro, setErro] = useState('')

  function salvar() {
    setErro('')
    if (!nome.trim()) { setErro('Informe o nome do feriado.'); return }
    if (!inicio) { setErro('Informe a data.'); return }
    start(async () => {
      const r = await salvarPonte(orgSlug, {
        id: ponte?.id ?? null, nome: nome.trim(), inicio, fim: fim || inicio,
        custo_dias: Number(custo) || 1, observacao: obs || null,
      })
      if (r?.error) { setErro(r.error); return }
      toast.success(ponte ? 'Emenda atualizada.' : 'Emenda criada — a equipe já entrou.')
      onClose(); router.refresh()
    })
  }

  const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
  const titulo = ponte ? 'Editar emenda' : `Nova emenda de ${ano}`

  return (
    <Modal open onClose={onClose} size="sm" label={titulo}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
        <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
      </div>
      <div className="px-6 py-5 space-y-4">
        {erro && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{erro}</p>}
        <div>
          <label className={labelCls}>Feriado</label>
          <input value={nome} onChange={e => setNome(e.target.value)} className={inputCls} placeholder="Carnaval, Tiradentes…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>De</label>
            <input type="date" value={inicio} onChange={e => setInicio(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Até</label>
            <input type="date" value={fim} min={inicio || undefined} onChange={e => setFim(e.target.value)} className={inputCls} /></div>
        </div>
        <div>
          <label className={labelCls}>Quanto desconta do saldo</label>
          <input type="number" step="0.5" min="0" value={custo} onChange={e => setCusto(e.target.value)} className={inputCls} />
          <p className="text-[11px] text-gray-400 mt-1">
            A política da casa é 1 dia, por mais longa que seja a ponte.
          </p>
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
