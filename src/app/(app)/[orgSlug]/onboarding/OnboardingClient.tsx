'use client'

/**
 * Trilha de primeiros passos. Decisão do Rafael (01/08/2026): ORIENTA, NÃO
 * BLOQUEIA — nada aqui impede a pessoa de trabalhar; a trilha acompanha e some
 * do caminho quando termina. O conteúdo é CADASTRO da org (Configurações →
 * Onboarding), porque "cada empresa tem suas lógicas e regras".
 */
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Compass, Check, ArrowRight, Settings2, PartyPopper } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { marcarEtapa, type EtapaTrilha } from '@/app/actions/onboarding'

export function OnboardingClient({ orgSlug, trilha, isAdmin }: {
  orgSlug: string; trilha: EtapaTrilha[]; isAdmin: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  // Otimista: marcar tem que responder na hora, não depois do round-trip.
  const [local, setLocal] = useState<Record<string, boolean>>({})
  const feito = (e: EtapaTrilha) => local[e.id] ?? e.concluido

  const total = trilha.length
  const prontos = trilha.filter(feito).length
  const pct = total ? Math.round((prontos / total) * 100) : 0

  function alternar(e: EtapaTrilha) {
    const novo = !feito(e)
    setLocal(p => ({ ...p, [e.id]: novo }))
    start(async () => {
      const r = await marcarEtapa(orgSlug, e.id, novo)
      if (r?.error) {
        setLocal(p => ({ ...p, [e.id]: !novo }))
        toast.error(r.error)
      } else router.refresh()
    })
  }

  if (total === 0) {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
          <Compass className="w-5 h-5 text-orange-600" /> Primeiros passos
        </h1>
        <p className="text-sm text-gray-500">
          Nenhuma etapa cadastrada ainda.
          {isAdmin && <> Monte a trilha da sua agência em <Link href={`/${orgSlug}/settings/onboarding`} className="text-orange-600 hover:text-orange-700">Configurações → Onboarding</Link>.</>}
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Compass className="w-5 h-5 text-orange-600" /> Primeiros passos
        </h1>
        {isAdmin && (
          <Link href={`/${orgSlug}/settings/onboarding`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
            <Settings2 className="w-3.5 h-3.5" /> Editar trilha
          </Link>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Um guia para você entender como trabalhamos. Vá no seu ritmo — nada aqui trava sua primeira tarefa.
      </p>

      {/* Progresso */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 mb-5">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-gray-600">{prontos} de {total} concluídos</span>
          <span className="tabular-nums font-medium text-gray-900">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full bg-orange-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        {prontos === total && (
          <p className="mt-3 text-sm text-emerald-700 inline-flex items-center gap-1.5">
            <PartyPopper className="w-4 h-4" /> Trilha concluída. Bom trabalho!
          </p>
        )}
      </div>

      <div className="space-y-2">
        {trilha.map((e, i) => {
          const ok = feito(e)
          return (
            <div key={e.id}
              className={cn('rounded-2xl border p-4 transition-colors',
                ok ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-white')}>
              <div className="flex items-start gap-3">
                <button onClick={() => alternar(e)} disabled={pending}
                  title={ok ? 'Marcar como não concluído' : 'Marcar como concluído'}
                  className={cn('mt-0.5 w-6 h-6 shrink-0 rounded-full border flex items-center justify-center transition-colors active:scale-[0.94] disabled:opacity-50',
                    ok ? 'bg-emerald-600 border-emerald-600 text-[#fff]' : 'border-gray-300 text-transparent hover:border-orange-400')}>
                  <Check className="w-3.5 h-3.5" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-medium', ok ? 'text-gray-500 line-through decoration-emerald-300' : 'text-gray-900')}>
                    <span className="text-gray-400 tabular-nums mr-1.5">{i + 1}.</span>{e.titulo}
                  </p>
                  {e.descricao && <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{e.descricao}</p>}
                  {e.link && (
                    <Link href={e.link.startsWith('/') ? e.link : `/${orgSlug}/${e.link}`}
                      className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-orange-600 hover:text-orange-700">
                      {e.link_label || 'Abrir'} <ArrowRight className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
