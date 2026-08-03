'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { Clock, Loader2 } from 'lucide-react'
import { baterPonto, pontoGate } from '@/app/actions/rh-ponto'

/**
 * Trava do ponto (migration 199) — só existe quando a organização liga o
 * `ponto_obrigatorio`, o que o Rafael vai fazer no dia em que o time sair do
 * Pontomais. Desligada, este componente não desenha nada.
 *
 * Diferente do PontoPrompt (card dispensável no canto), aqui é uma parede. Mas
 * com porta: o botão bate o ponto e a parede cai. Nunca há "não consigo entrar".
 *
 * Não cobre a própria tela de ponto — bloquear o lugar onde se resolve o
 * bloqueio seria uma armadilha.
 */
const POLL_MS = 60_000

export function PontoGate({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname()
  const [estado, setEstado] = useState<{ exige: boolean; colaborador_id?: string } | null>(null)
  const [pending, start] = useTransition()

  const carregar = useCallback(() => { pontoGate().then(setEstado) }, [])

  useEffect(() => {
    carregar()
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar() }, POLL_MS)
    return () => clearInterval(t)
  }, [carregar])

  // A tela de ponto e a de perfil ficam livres: é onde se bate o ponto e onde se
  // resolve um cadastro errado.
  const rotaLivre = pathname?.includes('/ponto') || pathname?.includes('/perfil')
  if (!estado?.exige || rotaLivre || !estado.colaborador_id) return null

  function bater() {
    start(async () => {
      const r = await baterPonto(orgSlug, estado!.colaborador_id!)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Ponto registrado. Bom trabalho.')
      carregar()
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white border border-gray-200 shadow-2xl p-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center mx-auto mb-4">
          <Clock className="w-6 h-6 text-orange-600" />
        </div>
        <h2 className="text-base font-semibold text-gray-900">Bata o ponto para começar</h2>
        <p className="text-sm text-gray-500 mt-1.5">
          Sua jornada de hoje ainda não tem nenhuma marcação. Registre a entrada e o Flow libera.
        </p>
        <button onClick={bater} disabled={pending}
          className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
          Bater ponto agora
        </button>
        <p className="text-[11px] text-gray-400 mt-3">
          A hora registrada é a do servidor. Se você começou antes, o RH ajusta pela justificativa.
        </p>
      </div>
    </div>
  )
}
