'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronUp, ChevronDown, Trash2, Plus, Lock, Loader2 } from 'lucide-react'
import { useStatusConfig } from '@/components/ui/StatusBadge'
import { Select } from '@/components/ui/Select'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { salvarStatus, excluirStatus, reordenarStatus, contarTarefasPorStatus } from '@/app/actions/org-status'
import type { StatusConfig } from '@/types'

const GRUPOS = [
  { value: 'internal', label: 'Trabalho interno' },
  { value: 'external', label: 'Cliente / fornecedores' },
  { value: 'done',     label: 'Encerrado' },
]

/** Preto ou branco por cima da cor escolhida, o que tiver mais contraste (WCAG). */
function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#1e293b' : '#ffffff'
}

const PAPEL_NOTA: Record<string, string> = {
  inicial: 'status inicial de toda tarefa nova',
  conclusao: 'fecha a tarefa (conclusão, recorrência e arquivamento)',
  aprovacao_cliente: 'usado pelo portal do cliente',
  gate_redacao: 'dispara a revisão de Redação por IA',
  gate_design: 'dispara a revisão de Design por IA',
  gate_finalizacao: 'dispara a revisão de Finalização por IA',
}

export function StatusManager({ orgSlug, orgId }: { orgSlug: string; orgId: string }) {
  const router = useRouter()
  const doBanco = useStatusConfig()
  const [rows, setRows] = useState<StatusConfig[]>(doBanco)
  const [contagem, setContagem] = useState<Record<string, number>>({})
  const [salvando, setSalvando] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // Novo status
  const [novoAberto, setNovoAberto] = useState(false)
  const [novoLabel, setNovoLabel] = useState('')
  const [novoBg, setNovoBg] = useState('#e0e7ff')
  const [novoGrupo, setNovoGrupo] = useState('internal')

  // Exclusão
  const [excluindo, setExcluindo] = useState<StatusConfig | null>(null)
  const [destino, setDestino] = useState('')

  // Ressincroniza quando o cadastro muda (router.refresh depois de salvar).
  // Ajuste durante o render é o padrão do React para "estado derivado de prop" —
  // em useEffect vira render em cascata.
  const [snapshot, setSnapshot] = useState(doBanco)
  if (snapshot !== doBanco) { setSnapshot(doBanco); setRows(doBanco) }

  useEffect(() => { contarTarefasPorStatus(orgId).then(setContagem) }, [orgId])

  function patchLocal(valor: string, patch: Partial<StatusConfig>) {
    setRows(prev => prev.map(r => (r.value === valor ? { ...r, ...patch } : r)))
  }

  /** Grava a linha (label/cor/grupo). Chamado no blur — não a cada tecla. */
  function gravar(r: StatusConfig) {
    setSalvando(r.value)
    start(async () => {
      const res = await salvarStatus(orgSlug, orgId, r.value, {
        label: r.label, grupo: r.group, bg: r.bg, txt: r.text,
      })
      setSalvando(null)
      if (res?.error) { toast.error(res.error); router.refresh() }
      else router.refresh()
    })
  }

  function mover(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const novo = [...rows]
    ;[novo[i], novo[j]] = [novo[j], novo[i]]
    setRows(novo)
    start(async () => {
      const res = await reordenarStatus(orgSlug, orgId, novo.map(r => r.value as string))
      if (res?.error) toast.error(res.error)
      router.refresh()
    })
  }

  function criar() {
    const label = novoLabel.trim()
    if (!label) { toast.error('Dê um nome ao status'); return }
    start(async () => {
      const res = await salvarStatus(orgSlug, orgId, null, {
        label, grupo: novoGrupo, bg: novoBg, txt: contrastColor(novoBg),
      })
      if (res?.error) { toast.error(res.error); return }
      toast.success(`Status "${label}" criado`)
      setNovoAberto(false); setNovoLabel(''); setNovoBg('#e0e7ff'); setNovoGrupo('internal')
      router.refresh()
    })
  }

  function confirmarExclusao() {
    if (!excluindo) return
    const alvo = excluindo
    start(async () => {
      const res = await excluirStatus(orgSlug, orgId, alvo.value as string, destino || null)
      if (res?.error) { toast.error(res.error); return }
      toast.success(res.movidas
        ? `"${alvo.label}" excluído — ${res.movidas} tarefa(s) movida(s)`
        : `"${alvo.label}" excluído`)
      setExcluindo(null); setDestino('')
      router.refresh()
      contarTarefasPorStatus(orgId).then(setContagem)
    })
  }

  const emUso = excluindo ? (contagem[excluindo.value as string] ?? 0) : 0

  return (
    <section>
      <div className="flex items-end justify-between gap-4 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Status das atividades</h2>
          <p className="text-xs text-gray-500">
            As etapas do seu fluxo. A ordem aqui é a ordem do fluxo — ela define o que conta como
            avanço (inclusive para as revisões por IA).
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNovoAberto(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> Novo status
        </button>
      </div>

      {novoAberto && (
        <div className="mb-3 rounded-xl border border-orange-100 bg-orange-50/40 p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] font-medium text-gray-600 mb-1">Nome</label>
            <input
              autoFocus
              value={novoLabel}
              onChange={e => setNovoLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') criar() }}
              placeholder="Ex.: Aprovação interna"
              className="w-full text-sm bg-gray-100 border border-transparent rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-600 mb-1">Cor</label>
            <div className="flex items-center gap-2">
              <input type="color" value={novoBg} onChange={e => setNovoBg(e.target.value)}
                className="w-9 h-9 rounded-lg cursor-pointer border border-gray-200" />
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold"
                style={{ backgroundColor: novoBg, color: contrastColor(novoBg) }}>
                {novoLabel.trim() || 'Prévia'}
              </span>
            </div>
          </div>
          <div className="w-52">
            <label className="block text-[11px] font-medium text-gray-600 mb-1">Grupo</label>
            <Select value={novoGrupo} onChange={setNovoGrupo} options={GRUPOS} />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={criar} disabled={pending}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-orange-600 text-[#fff] rounded-xl hover:bg-orange-700 transition-colors disabled:opacity-50">
              {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Criar
            </button>
            <button type="button" onClick={() => setNovoAberto(false)}
              className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-[52px_1fr_150px_190px_36px] gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          <span>Ordem</span><span>Nome</span><span>Cor</span><span>Grupo</span><span />
        </div>

        {rows.map((s, i) => {
          const qtd = contagem[s.value as string] ?? 0
          const sistema = !!s.papel
          return (
            <div key={s.value}
              className="grid grid-cols-[52px_1fr_150px_190px_36px] gap-3 items-center px-4 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/40 transition-colors">
              {/* Ordem */}
              <div className="flex items-center">
                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0 || pending}
                  className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Subir">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => mover(i, 1)} disabled={i === rows.length - 1 || pending}
                  className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Descer">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Nome + prévia */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold shrink-0"
                  style={{ backgroundColor: s.bg, color: s.text }}>
                  {s.label}
                </span>
                <input
                  value={s.label}
                  onChange={e => patchLocal(s.value as string, { label: e.target.value })}
                  onBlur={() => { if (s.label.trim()) gravar(s) }}
                  className="flex-1 text-xs border border-transparent hover:border-gray-200 focus:border-orange-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-transparent min-w-0"
                />
                {salvando === s.value && <Loader2 className="w-3 h-3 animate-spin text-gray-300 shrink-0" />}
                {sistema && (
                  <span title={`Do sistema: ${PAPEL_NOTA[s.papel!] ?? ''}`}
                    className="flex items-center gap-1 text-[10px] text-gray-400 shrink-0">
                    <Lock className="w-3 h-3" /> sistema
                  </span>
                )}
              </div>

              {/* Cor */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="color" value={s.bg}
                  onChange={e => patchLocal(s.value as string, { bg: e.target.value, text: contrastColor(e.target.value) })}
                  onBlur={() => gravar(s)}
                  className="w-6 h-6 rounded cursor-pointer border border-gray-200" />
                <span className="text-[11px] text-gray-500 font-mono">{s.bg}</span>
              </label>

              {/* Grupo */}
              <Select
                size="sm"
                value={s.group}
                onChange={v => {
                  patchLocal(s.value as string, { group: v as StatusConfig['group'] })
                  gravar({ ...s, group: v as StatusConfig['group'] })
                }}
                options={GRUPOS}
              />

              {/* Excluir */}
              <div className="flex justify-end">
                {sistema ? (
                  <span className="w-6" />
                ) : (
                  <button type="button" onClick={() => { setExcluindo(s); setDestino('') }}
                    title={qtd ? `${qtd} tarefa(s) neste status` : 'Excluir status'}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-gray-400 mt-2">
        Status marcados como <strong>sistema</strong> podem ser renomeados e recoloridos, mas não
        excluídos — o app depende deles (tarefa nova, conclusão, portal do cliente e revisões por IA).
      </p>

      {/* Confirmação de exclusão — com destino quando há tarefas */}
      <ConfirmDialog
        open={!!excluindo}
        title={`Excluir "${excluindo?.label ?? ''}"?`}
        description={
          emUso
            ? `Há ${emUso} tarefa(s) neste status. Escolha para onde movê-las — nenhuma tarefa é apagada.`
            : 'Nenhuma tarefa usa este status no momento.'
        }
        confirmLabel={emUso && !destino ? 'Escolha o destino' : 'Excluir'}
        loading={pending}
        onConfirm={() => { if (!emUso || destino) confirmarExclusao() }}
        onCancel={() => { setExcluindo(null); setDestino('') }}
      >
        {emUso > 0 && (
          <div className="mt-3">
            <label className="block text-[11px] font-medium text-gray-600 mb-1">Mover as tarefas para</label>
            <Select
              value={destino}
              onChange={setDestino}
              placeholder="Selecionar status"
              options={rows.filter(r => r.value !== excluindo?.value).map(r => ({ value: r.value as string, label: r.label }))}
            />
          </div>
        )}
      </ConfirmDialog>
    </section>
  )
}
