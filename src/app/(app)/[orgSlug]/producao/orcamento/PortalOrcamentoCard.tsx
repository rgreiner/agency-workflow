'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Globe, Loader2 } from 'lucide-react'
import { publicarOrcamentoPortal } from '@/app/actions/portal'

interface Props {
  orgSlug: string
  producaoId: string
  publicadoEm: string | null
  decisao: { kind: 'aprovado' | 'ajuste'; em: string; por: string | null; ip: string | null } | null
  /** Quantos contatos do cliente têm acesso ao portal. */
  contatos: number
}

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * Orçamento no painel do cliente (mig. 342): só aparece lá depois de "mostrar".
 * O cliente aprova (a situação vira Aprovado) ou pede alteração; mostrar de novo
 * abre uma nova rodada de decisão.
 */
export function PortalOrcamentoCard({ orgSlug, producaoId, publicadoEm, decisao, contatos }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const decisaoAtual = decisao && publicadoEm && decisao.em >= publicadoEm ? decisao : null

  function publicar(sim: boolean) {
    startTransition(async () => {
      const res = await publicarOrcamentoPortal(orgSlug, producaoId, sim)
      if (res.error) { toast.error(res.error); return }
      toast.success(sim ? 'Orçamento visível no painel do cliente.' : 'Orçamento retirado do painel do cliente.')
      router.refresh()
    })
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-start gap-3">
        <Globe className="w-4 h-4 text-orange-600 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">Painel do cliente</p>
          {decisaoAtual ? (
            <p className={`text-sm mt-0.5 ${decisaoAtual.kind === 'aprovado' ? 'text-green-700' : 'text-orange-700'}`}>
              {decisaoAtual.kind === 'aprovado' ? '✓ Aprovado pelo cliente' : 'Cliente pediu alteração'}
              {decisaoAtual.por ? ` (${decisaoAtual.por})` : ''} em {quando(decisaoAtual.em)}
              {decisaoAtual.ip ? <span className="text-gray-400"> · IP {decisaoAtual.ip}</span> : null}
            </p>
          ) : publicadoEm ? (
            <p className="text-sm text-gray-500 mt-0.5">Visível para o cliente desde {quando(publicadoEm)}. Aguardando a decisão.</p>
          ) : (
            <p className="text-sm text-gray-500 mt-0.5">
              O cliente ainda não vê este orçamento.
              {contatos === 0 && ' Este cliente ainda não tem acesso ao painel: gere o link de cadastro na tela do cliente.'}
            </p>
          )}
          {decisaoAtual?.kind === 'ajuste' && (
            <p className="text-xs text-gray-500 mt-1">O pedido está em Solicitações. Ajuste e mostre de novo.</p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {(!publicadoEm || decisaoAtual?.kind === 'ajuste') && (
            <button type="button" onClick={() => publicar(true)} disabled={isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-[#fff] bg-orange-600 hover:bg-orange-700 transition-colors active:scale-[0.97] disabled:opacity-50">
              {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {publicadoEm ? 'Mostrar de novo' : 'Mostrar ao cliente'}
            </button>
          )}
          {publicadoEm && !decisaoAtual && (
            <button type="button" onClick={() => publicar(false)} disabled={isPending}
              className="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">
              Retirar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
