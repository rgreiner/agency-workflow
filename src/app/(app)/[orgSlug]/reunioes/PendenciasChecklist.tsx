'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Square, CheckSquare, Copy, Building2, UserRound, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ajustarPasso } from '@/app/actions/reunioes'
import { dataBR, type Pendencia } from '@/lib/reunioes'

/**
 * Check-list do que ficou em aberto nas atas — a pauta da próxima conversa.
 * Marcar = passo feito (com desfazer). "Copiar pauta" põe a lista em texto pra
 * colar no Granola, no WhatsApp ou no convite da reunião.
 */
export function PendenciasChecklist({ orgSlug, cliente, itens, podeEditar, mostrarOrigem = true }: {
  orgSlug: string
  cliente: string
  itens: Pendencia[]
  podeEditar: boolean
  /** Mostra de qual reunião veio cada item (dentro da ata nova, sempre útil). */
  mostrarOrigem?: boolean
}) {
  const router = useRouter()
  const [ocultos, setOcultos] = useState<Set<string>>(new Set())
  const [, start] = useTransition()
  const visiveis = itens.filter(p => !ocultos.has(p.passoId))

  function marcar(p: Pendencia) {
    setOcultos(s => new Set(s).add(p.passoId))
    start(async () => {
      const res = await ajustarPasso(orgSlug, p.workspaceId, p.reuniaoId, p.passoId, { feito: true })
      if (!res.ok) {
        setOcultos(s => { const n = new Set(s); n.delete(p.passoId); return n })
        toast.error(res.error)
        return
      }
      toast.success('Resolvido.', {
        action: {
          label: 'Desfazer',
          onClick: () => start(async () => {
            const r = await ajustarPasso(orgSlug, p.workspaceId, p.reuniaoId, p.passoId, { feito: false })
            if (!r.ok) { toast.error(r.error); return }
            setOcultos(s => { const n = new Set(s); n.delete(p.passoId); return n })
            router.refresh()
          }),
        },
      })
      router.refresh()
    })
  }

  async function copiar() {
    const linha = (p: Pendencia) => `- ${p.texto}${p.andamento ? ` (${p.andamento.rotulo})` : ''} · reunião de ${dataBR(p.realizadaEm).slice(0, 5)}`
    const ag = visiveis.filter(p => p.responsavel === 'agencia')
    const cl = visiveis.filter(p => p.responsavel === 'cliente')
    const partes = [`Pendências — ${cliente}`]
    if (ag.length) partes.push('', 'Com a agência', ...ag.map(linha))
    if (cl.length) partes.push('', `Com ${cliente}`, ...cl.map(linha))
    try {
      await navigator.clipboard.writeText(partes.join('\n'))
      toast.success('Pauta copiada.')
    } catch {
      toast.error('Não consegui copiar. Selecione o texto à mão.')
    }
  }

  if (!visiveis.length) {
    return <p className="text-sm text-gray-500 px-1 py-2">Nada em aberto. Tudo o que foi combinado tem desfecho.</p>
  }

  const grupos = [
    { chave: 'agencia' as const, titulo: 'Com a agência', icone: Building2 },
    { chave: 'cliente' as const, titulo: `Com ${cliente}`, icone: UserRound },
  ]

  return (
    <div>
      <div className="flex items-center justify-end mb-1">
        <button type="button" onClick={copiar}
          title="Copiar a lista em texto para usar na próxima reunião"
          className="press inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">
          <Copy className="w-3.5 h-3.5" /> Copiar pauta
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {grupos.map(g => {
          const lista = visiveis.filter(p => p.responsavel === g.chave)
          if (!lista.length) return null
          const Icone = g.icone
          return (
            <div key={g.chave}>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 mb-1.5">
                <Icone className="w-3.5 h-3.5" /> {g.titulo} <span className="font-normal text-gray-400">{lista.length}</span>
              </p>
              <ul className="space-y-0.5">
                {lista.map(p => (
                  <li key={p.passoId} className="flex items-start gap-2 px-1 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                    <button type="button" onClick={() => marcar(p)} disabled={!podeEditar}
                      title={podeEditar ? 'Marcar como resolvido' : 'Só o Atendimento marca'}
                      className="group/ck mt-0.5 shrink-0 text-gray-400 hover:text-orange-600 transition-colors disabled:hover:text-gray-400">
                      <Square className="w-4 h-4 group-hover/ck:hidden" />
                      <CheckSquare className="w-4 h-4 hidden group-hover/ck:block" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-800 leading-snug">{p.texto}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5 flex flex-wrap items-center gap-x-2">
                        {mostrarOrigem && (
                          <Link href={`/${orgSlug}/workspaces/${p.workspaceId}/reunioes/${p.reuniaoId}`}
                            className="hover:text-gray-600 transition-colors truncate max-w-[16rem]" title={p.reuniaoTitulo}>
                            {dataBR(p.realizadaEm).slice(0, 5)} · {p.reuniaoTitulo}
                          </Link>
                        )}
                        {p.andamento && (
                          p.andamento.href ? (
                            <Link href={p.andamento.href}
                              className={cn('inline-flex items-center gap-0.5 font-medium transition-colors',
                                p.andamento.tipo === 'tarefa' ? 'text-green-600 hover:text-green-700'
                                  : p.andamento.tipo === 'orcamento' ? 'text-blue-500 hover:text-blue-600'
                                  : 'text-orange-600 hover:text-orange-700')}>
                              {p.andamento.tipo === 'tarefa' ? 'Tarefa' : p.andamento.tipo === 'orcamento' ? 'Orçamento' : ''} {p.andamento.rotulo}
                              <ExternalLink className="w-2.5 h-2.5" />
                            </Link>
                          ) : <span>{p.andamento.rotulo}</span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
