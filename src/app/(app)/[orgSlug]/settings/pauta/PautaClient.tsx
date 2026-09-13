'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronUp, ChevronDown, Trash2, Plus, Loader2, Lightbulb } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  salvarOpcaoPauta, excluirOpcaoPauta, reordenarOpcoesPauta,
  type CampoPauta, type PautaUsoRow,
} from '@/app/actions/org-pauta'
import type { OrgPautaOpcaoRow } from '@/lib/atividade-titulo'

const CAMPOS: { campo: CampoPauta; titulo: string; nota: string; exemplo: string }[] = [
  { campo: 'veiculo',  titulo: 'Veículo',  exemplo: 'Meta, Google, Outdoor',
    nota: 'Onde a peça vai ao ar. Opcional na tarefa — rotina administrativa não tem veículo.' },
  { campo: 'formato',  titulo: 'Formato',  exemplo: 'Carrossel, Reels, Card',
    nota: 'O que é a peça. Compartilhado com o Hub de Mídia: a mesma lista aparece na entrega.' },
  { campo: 'objetivo', titulo: 'Objetivo', exemplo: 'Conversão, Captação, Remarketing',
    nota: 'Para que a peça existe. Antes vinha disfarçado de formato.' },
]

const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 ' +
  'placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white transition'

export function PautaClient({ orgSlug, orgId, opcoes, uso }: {
  orgSlug: string
  orgId: string
  opcoes: OrgPautaOpcaoRow[]
  uso: PautaUsoRow[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [salvando, setSalvando] = useState<string | null>(null)
  const [novo, setNovo] = useState<Record<string, string>>({})
  const [aExcluir, setAExcluir] = useState<OrgPautaOpcaoRow | null>(null)

  // Uso por valor (sem caixa) — o RPC já unifica "Spotify"/"spotify".
  const usoPorValor = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of uso) if (!u.no_cadastro) m.set(u.valor.toLowerCase(), u.usos)
    return m
  }, [uso])

  const sugestoes = useMemo(() => uso.filter(u => u.no_cadastro), [uso])
  const porCampo = useMemo(() => {
    const m: Record<string, OrgPautaOpcaoRow[]> = { veiculo: [], formato: [], objetivo: [] }
    for (const o of opcoes) m[o.campo]?.push(o)
    return m
  }, [opcoes])

  function feito(r: { error?: string } | undefined, msg: string) {
    if (r?.error) { toast.error(r.error); return false }
    toast.success(msg); router.refresh(); return true
  }

  function criar(campo: CampoPauta) {
    const valor = (novo[campo] ?? '').trim()
    if (!valor) return
    start(async () => {
      if (feito(await salvarOpcaoPauta(orgSlug, orgId, null, campo, valor), `"${valor}" adicionado`)) {
        setNovo(n => ({ ...n, [campo]: '' }))
      }
    })
  }

  function renomear(o: OrgPautaOpcaoRow, valor: string) {
    const v = valor.trim()
    if (!v || v === o.valor) return
    setSalvando(o.id)
    start(async () => {
      // Renomear NÃO reescreve título já gravado — o histórico fica com o texto antigo.
      feito(await salvarOpcaoPauta(orgSlug, orgId, o.id, o.campo, v), 'Renomeado')
      setSalvando(null)
    })
  }

  function mover(campo: CampoPauta, i: number, delta: number) {
    const lista = [...porCampo[campo]]
    const j = i + delta
    if (j < 0 || j >= lista.length) return
    ;[lista[i], lista[j]] = [lista[j], lista[i]]
    start(async () => {
      feito(await reordenarOpcoesPauta(orgSlug, orgId, campo, lista.map(o => o.id)), 'Ordem salva')
    })
  }

  function promover(valor: string, campo: CampoPauta) {
    start(async () => {
      feito(await salvarOpcaoPauta(orgSlug, orgId, null, campo, valor), `"${valor}" virou opção de ${campo}`)
    })
  }

  return (
    <div className="space-y-8 max-w-3xl pb-10">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Pauta</h2>
        <p className="text-xs text-gray-500">
          As sugestões que montam o título da tarefa:{' '}
          <code className="px-1.5 py-0.5 bg-gray-100 rounded text-[11px] text-gray-700">
            AAMMDD - Veículo - Formato - Objetivo - Título da demanda
          </code>
          . A contagem ao lado de cada opção vem dos títulos já gravados — opção sem uso é
          candidata a sair. Renomear aqui não altera tarefa antiga: o título é texto congelado.
        </p>
      </div>

      {sugestoes.length > 0 && (
        <section className="border border-amber-200 bg-amber-50/60 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Lightbulb className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-gray-900">A equipe está digitando isto</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3">
            Valores que apareceram 2+ vezes nos títulos e não estão no cadastro. Escolha o campo
            para promover — ou ignore, se for nome de cliente ou assunto da demanda.
          </p>
          <div className="space-y-2">
            {sugestoes.map(sg => (
              <div key={sg.valor} className="flex items-center gap-2 flex-wrap bg-white rounded-lg px-3 py-2 border border-amber-100">
                <span className="text-sm font-medium text-gray-900">{sg.valor}</span>
                <span className="text-[11px] text-gray-500">{sg.usos}×</span>
                <span className="ml-auto flex gap-1">
                  {CAMPOS.map(c => (
                    <button key={c.campo} type="button" disabled={pending}
                      onClick={() => promover(sg.valor, c.campo)}
                      className="px-2 py-1 text-[11px] font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-orange-100 hover:text-orange-700 transition disabled:opacity-50">
                      → {c.titulo}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {CAMPOS.map(({ campo, titulo, nota, exemplo }) => {
        const lista = porCampo[campo] ?? []
        return (
          <section key={campo}>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">{titulo}</h3>
            <p className="text-xs text-gray-500 mb-3">{nota}</p>

            <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
              {lista.length === 0 && (
                <p className="px-4 py-6 text-xs text-gray-400 text-center">
                  Nenhuma opção. O campo aparece no formulário só com “Outro”.
                </p>
              )}
              {lista.map((o, i) => {
                const n = usoPorValor.get(o.valor.toLowerCase()) ?? 0
                return (
                  <div key={o.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="flex flex-col">
                      <button type="button" onClick={() => mover(campo, i, -1)} disabled={i === 0 || pending}
                        className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300" aria-label="Subir">
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => mover(campo, i, 1)} disabled={i === lista.length - 1 || pending}
                        className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300" aria-label="Descer">
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <input defaultValue={o.valor} onBlur={e => renomear(o, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                      className={inputCls} />

                    {salvando === o.id
                      ? <Loader2 className="w-4 h-4 animate-spin text-gray-400 shrink-0" />
                      : (
                        <span className={
                          'shrink-0 text-[11px] px-2 py-1 rounded-full whitespace-nowrap ' +
                          (n > 0 ? 'bg-gray-100 text-gray-600' : 'bg-gray-50 text-gray-400')
                        }>
                          {n > 0 ? `${n} uso${n > 1 ? 's' : ''}` : 'nunca usado'}
                        </span>
                      )}

                    <button type="button" onClick={() => setAExcluir(o)} disabled={pending}
                      className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition shrink-0 disabled:opacity-50"
                      aria-label={`Excluir ${o.valor}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}

              <div className="flex items-center gap-2 px-3 py-2">
                <span className="w-[18px]" />
                <input value={novo[campo] ?? ''} onChange={e => setNovo(n => ({ ...n, [campo]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); criar(campo) } }}
                  placeholder={`Adicionar… ex.: ${exemplo}`} className={inputCls} />
                <button type="button" onClick={() => criar(campo)} disabled={pending || !(novo[campo] ?? '').trim()}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition disabled:opacity-40">
                  <Plus className="w-4 h-4" /> Adicionar
                </button>
              </div>
            </div>
          </section>
        )
      })}

      <ConfirmDialog
        open={!!aExcluir}
        title={`Excluir "${aExcluir?.valor ?? ''}"?`}
        description="A opção some do formulário. As tarefas que já usaram esse texto no título continuam intactas — o título é texto gravado, não referência."
        confirmLabel="Excluir"
        onCancel={() => setAExcluir(null)}
        onConfirm={() => {
          const o = aExcluir
          setAExcluir(null)
          if (!o) return
          start(async () => { feito(await excluirOpcaoPauta(orgSlug, orgId, o.id), 'Opção excluída') })
        }}
      />
    </div>
  )
}
