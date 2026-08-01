'use client'

/**
 * Cadastro da trilha de onboarding. É CADASTRO (não lista fixa no código) por
 * decisão do Rafael: "cada empresa tem suas lógicas e regras, precisamos
 * respeitar elas". Etapa sem cargo = todo mundo vê.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2, Trash2, ChevronUp, ChevronDown, Compass, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { MultiSelect } from '@/components/ui/Select'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { salvarEtapa, excluirEtapa, type EtapaConfig } from '@/app/actions/onboarding'

const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

type Rascunho = {
  id: string | null; titulo: string; descricao: string; link: string; link_label: string
  position_ids: string[]; ativo: boolean
}
const vazio = (): Rascunho => ({ id: null, titulo: '', descricao: '', link: '', link_label: '', position_ids: [], ativo: true })

export function OnboardingConfigClient({ orgSlug, etapas, cargos }: {
  orgSlug: string; etapas: EtapaConfig[]; cargos: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [rascunho, setRascunho] = useState<Rascunho | null>(null)
  const [excluir, setExcluir] = useState<EtapaConfig | null>(null)

  function salvar() {
    if (!rascunho) return
    if (!rascunho.titulo.trim()) { toast.error('Informe o título da etapa.'); return }
    start(async () => {
      const r = await salvarEtapa(orgSlug, rascunho.id, {
        titulo: rascunho.titulo.trim(),
        descricao: rascunho.descricao.trim() || null,
        link: rascunho.link.trim() || null,
        link_label: rascunho.link_label.trim() || null,
        position_ids: rascunho.position_ids,
        ativo: rascunho.ativo,
      })
      if (r?.error) toast.error(r.error)
      else { toast.success('Etapa salva.'); setRascunho(null); router.refresh() }
    })
  }

  /** Troca a ordem com o vizinho (a trilha é lida de cima pra baixo). */
  function mover(e: EtapaConfig, delta: number) {
    const i = etapas.findIndex(x => x.id === e.id)
    const alvo = etapas[i + delta]
    if (!alvo) return
    start(async () => {
      const a = await salvarEtapa(orgSlug, e.id, { titulo: e.titulo, descricao: e.descricao, link: e.link, link_label: e.link_label, position_ids: e.position_ids, ativo: e.ativo, ordem: alvo.ordem })
      const b = await salvarEtapa(orgSlug, alvo.id, { titulo: alvo.titulo, descricao: alvo.descricao, link: alvo.link, link_label: alvo.link_label, position_ids: alvo.position_ids, ativo: alvo.ativo, ordem: e.ordem })
      if (a?.error || b?.error) toast.error(a?.error || b?.error || 'Falha ao reordenar')
      else router.refresh()
    })
  }

  function remover() {
    if (!excluir) return
    const alvo = excluir
    setExcluir(null)
    start(async () => {
      const r = await excluirEtapa(orgSlug, alvo.id)
      if (r?.error) toast.error(r.error)
      else { toast.success('Etapa excluída.'); router.refresh() }
    })
  }

  const nomeCargo = (id: string) => cargos.find(c => c.id === id)?.name ?? '—'

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <Compass className="w-4 h-4 text-orange-600" /> Trilha de primeiros passos
          </h2>
          <p className="text-xs text-gray-500 mt-0.5 max-w-xl">
            O que quem chega precisa entender antes da primeira tarefa. Ela <strong>orienta, não bloqueia</strong>:
            a pessoa vê em “Primeiros passos” e marca no ritmo dela. Etapa sem cargo aparece para todos.
          </p>
        </div>
        <button onClick={() => setRascunho(vazio())} disabled={pending}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-colors shrink-0">
          <Plus className="w-4 h-4" /> Nova etapa
        </button>
      </div>

      {etapas.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center rounded-2xl border border-dashed border-gray-200">
          Nenhuma etapa ainda. Comece pelo que você explica toda vez que alguém entra.
        </p>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
          {etapas.map((e, i) => (
            <div key={e.id} className={cn('px-4 py-3 flex items-start gap-3', !e.ativo && 'opacity-50')}>
              <div className="flex flex-col gap-0.5 pt-0.5">
                <button onClick={() => mover(e, -1)} disabled={pending || i === 0} title="Subir"
                  className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-30 transition-colors"><ChevronUp className="w-3.5 h-3.5" /></button>
                <button onClick={() => mover(e, 1)} disabled={pending || i === etapas.length - 1} title="Descer"
                  className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-30 transition-colors"><ChevronDown className="w-3.5 h-3.5" /></button>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  <span className="text-gray-400 tabular-nums mr-1.5">{i + 1}.</span>{e.titulo}
                  {!e.ativo && <span className="ml-2 text-[10px] font-medium text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">inativa</span>}
                </p>
                {e.descricao && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 whitespace-pre-line">{e.descricao}</p>}
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {e.link && <span className="text-[10px] text-orange-700 bg-orange-50 rounded px-1.5 py-0.5">{e.link_label || 'link'} → {e.link}</span>}
                  {e.position_ids.length === 0
                    ? <span className="text-[10px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">todos os cargos</span>
                    : e.position_ids.map(id => <span key={id} className="text-[10px] text-gray-600 bg-gray-100 rounded px-1.5 py-0.5">{nomeCargo(id)}</span>)}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setRascunho({
                  id: e.id, titulo: e.titulo, descricao: e.descricao ?? '', link: e.link ?? '',
                  link_label: e.link_label ?? '', position_ids: e.position_ids, ativo: e.ativo,
                })} disabled={pending} title="Editar"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => setExcluir(e)} disabled={pending} title="Excluir"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {rascunho && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="modal-card w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">{rascunho.id ? 'Editar etapa' : 'Nova etapa'}</h3>
              <button onClick={() => setRascunho(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className={labelCls}>Título</label>
                <input value={rascunho.titulo} onChange={e => setRascunho({ ...rascunho, titulo: e.target.value })}
                  className={inputCls} placeholder="Ex.: Como funciona a nossa pauta" />
              </div>
              <div>
                <label className={labelCls}>Explicação</label>
                <textarea value={rascunho.descricao} onChange={e => setRascunho({ ...rascunho, descricao: e.target.value })}
                  rows={4} className={inputCls} placeholder="O que a pessoa precisa entender aqui." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Link no Flow <span className="font-normal text-gray-400">(opcional)</span></label>
                  <input value={rascunho.link} onChange={e => setRascunho({ ...rascunho, link: e.target.value })}
                    className={inputCls} placeholder="/ponto" />
                </div>
                <div>
                  <label className={labelCls}>Texto do link</label>
                  <input value={rascunho.link_label} onChange={e => setRascunho({ ...rascunho, link_label: e.target.value })}
                    className={inputCls} placeholder="Abrir meu ponto" />
                </div>
              </div>
              <div>
                <label className={labelCls}>Cargos <span className="font-normal text-gray-400">(vazio = todos)</span></label>
                <MultiSelect values={rascunho.position_ids} onChange={v => setRascunho({ ...rascunho, position_ids: v })}
                  allLabel="Todos os cargos" options={cargos.map(c => ({ value: c.id, label: c.name }))} />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={rascunho.ativo} onChange={e => setRascunho({ ...rascunho, ativo: e.target.checked })}
                  className="rounded text-orange-600 focus:ring-orange-500" />
                Ativa (aparece na trilha de quem chega)
              </label>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setRascunho(null)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
              <button onClick={salvar} disabled={pending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-colors">
                {pending && <Loader2 className="w-4 h-4 animate-spin" />} Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!excluir} loading={pending}
        title="Excluir etapa"
        description={`"${excluir?.titulo}" sai da trilha de todo mundo, junto com o progresso já marcado nela. Para tirar da trilha sem perder o histórico, desmarque "Ativa".`}
        confirmLabel="Excluir"
        onConfirm={remover} onCancel={() => setExcluir(null)}
      />
    </div>
  )
}
