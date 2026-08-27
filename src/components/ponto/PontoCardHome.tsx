'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Clock, LogIn, Coffee, Undo2, Loader2, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { baterPonto } from '@/app/actions/rh-ponto'
import { anunciarPonto } from '@/components/ponto/ponto-sync'
import { ExtraContextoModal, extraNascida, type ExtraNascida } from '@/components/ponto/ExtraContextoModal'

const hm = (t: string) => t.slice(0, 5)

/**
 * Card do ponto na home — o caso móvel nº 1: abrir o app e bater em um toque.
 * A page só o renderiza para quem é colaborador com ponto (rh_ponto_estado
 * devolveu algo). Mesma régua da tela /ponto: N marcações livres, ímpar =
 * trabalhando; o detalhe (justificar, espelho) continua morando lá.
 */
export function PontoCardHome({ orgSlug, colaboradorId, marcacoes }: {
  orgSlug: string; colaboradorId: string; marcacoes: string[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [extra, setExtra] = useState<ExtraNascida | null>(null)

  const dentro = marcacoes.length % 2 === 1
  const ultima = marcacoes.length ? hm(marcacoes[marcacoes.length - 1]) : null
  const proxima = marcacoes.length === 0
    ? { label: 'Registrar entrada', icon: LogIn }
    : dentro ? { label: 'Registrar saída', icon: Coffee } : { label: 'Registrar retorno', icon: Undo2 }

  function bater() {
    start(async () => {
      const r = await baterPonto(orgSlug, colaboradorId)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Ponto registrado!')
      // Fechou o dia com extra pendente e sem contexto → pergunta na hora.
      const ex = extraNascida(r.resultado)
      if (ex) setExtra(ex)
      anunciarPonto()
      router.refresh()
    })
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Clock className="w-4 h-4 text-orange-600" /> Meu ponto
        </h2>
        <Link href={`/${orgSlug}/ponto`}
          className="inline-flex items-center gap-0.5 text-xs text-gray-500 hover:text-gray-700 transition-colors">
          Ver tudo <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          {marcacoes.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhuma marcação hoje.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {marcacoes.map((h, i) => (
                <span key={i} className="rounded-lg border border-orange-200 bg-orange-50/50 px-2 py-1 text-xs tabular-nums text-gray-900">
                  <span className="text-gray-400 mr-1">{i === 0 ? 'Entrada' : i % 2 === 1 ? 'Saída' : 'Retorno'}</span>
                  {hm(h)}
                </span>
              ))}
            </div>
          )}
          {ultima && (
            <p className="text-xs text-gray-500 mt-1.5">
              {dentro
                ? <>Trabalhando desde <b className="text-gray-700">{ultima}</b>.</>
                : <>Fora desde <b className="text-gray-700">{ultima}</b>.</>}
            </p>
          )}
        </div>
        <button onClick={bater} disabled={pending}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 active:scale-[0.97] disabled:opacity-50 transition-colors shrink-0">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <proxima.icon className="w-4 h-4" />}
          {proxima.label}
        </button>
      </div>
      {extra && <ExtraContextoModal orgSlug={orgSlug} colaboradorId={colaboradorId}
        extra={extra} onClose={() => setExtra(null)} />}
    </div>
  )
}
