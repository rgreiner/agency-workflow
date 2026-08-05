'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { Clock, Loader2, Coffee } from 'lucide-react'
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
  const [estado, setEstado] = useState<{
    exige: boolean; colaborador_id?: string
    /** sem_ponto | dentro | intervalo | fora — ver migration 217. */
    estado?: string; falta_para_1h?: number; intervalo_min?: number
  } | null>(null)
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

  // Intervalo em curso e ainda sem 1h: avisa, não barra. Barrar aqui seria
  // parede sem porta — a pessoa não pode bater a volta sem estourar o intervalo
  // mínimo, e ficaria presa. Quem voltar antes aparece no espelho com
  // "almoço <1h", que é onde o RH revisa.
  if (estado?.estado === 'intervalo' && !rotaLivre) {
    return (
      <div className="fixed bottom-4 right-4 z-[60] max-w-xs rounded-2xl bg-white border border-amber-200 shadow-lg p-4">
        <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
          <Coffee className="w-4 h-4 text-amber-600" /> Você está no intervalo
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Faltam <b className="text-gray-700">{estado.falta_para_1h} min</b> para completar 1h.
          Voltando antes disso, o dia fica com almoço abaixo do mínimo e o RH revisa.
        </p>
        <button onClick={bater} disabled={pending}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition">
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
          Voltar do intervalo agora
        </button>
      </div>
    )
  }

  if (!estado?.exige || rotaLivre || !estado.colaborador_id) return null

  // Reabrir o ponto depois de fechado é o caso "parei e voltei para uma
  // demanda": o texto muda, porque pedir "comece o dia" a quem já trabalhou
  // desde as 8h30 soa como se o sistema tivesse esquecido dela.
  const voltando = estado.estado === 'fora'

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
        <h2 className="text-base font-semibold text-gray-900">
          {voltando ? 'Bata o ponto para voltar' : 'Bata o ponto para começar'}
        </h2>
        <p className="text-sm text-gray-500 mt-1.5">
          {voltando
            ? 'Seu ponto está fechado agora. Para retomar o trabalho, registre o retorno.'
            : 'Sua jornada de hoje ainda não tem nenhuma marcação. Registre a entrada e o Flow libera.'}
        </p>
        <button onClick={bater} disabled={pending}
          className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
          Bater ponto agora
        </button>
        <p className="text-[11px] text-gray-400 mt-3">
          A hora registrada é a do servidor. Se você começou antes, o RH ajusta pela justificativa.
        </p>
        {voltando && (
          <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-2">
            Trabalho além da jornada só entra na folha depois de <b>aprovado pelo gestor</b>.
          </p>
        )}
      </div>
    </div>
  )
}
