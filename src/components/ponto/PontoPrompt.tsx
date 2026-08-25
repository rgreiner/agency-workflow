'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Clock, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { pontoEstado, baterPonto, baterEntradaRetro } from '@/app/actions/rh-ponto'
import { ExtraContextoModal, extraNascida, type ExtraNascida } from '@/components/ponto/ExtraContextoModal'

type Estado = NonNullable<Awaited<ReturnType<typeof pontoEstado>>>

/** Quanto antes do horário da jornada o lembrete aparece. */
const ANTECEDENCIA_MIN = 10
/** "Mais tarde" silencia o lembrete por este tempo. */
const SNOOZE_MIN = 15
const POLL_MS = 5 * 60_000

const min = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

interface Prompt {
  tipo: 'entrada' | 'entrada-retro' | 'pausa' | 'retorno' | 'saida'
  titulo: string
  detalhe: string
  /** Só na entrada-retro: hora que será registrada. */
  retroHora?: string
}

/** Decide qual lembrete mostrar agora (null = nenhum). */
function decidir(e: Estado): Prompt | null {
  const agora = min(e.agora)
  const n = e.marcacoes.length
  const dentro = n % 2 === 1
  const j = e.jornada
  const janela = (alvo: string) => agora >= min(alvo) - ANTECEDENCIA_MIN

  if (n === 0) {
    // Já está trabalhando (abriu tarefa) sem nenhum ponto → entrada retroativa.
    if (e.primeiro_foco) {
      return {
        tipo: 'entrada-retro',
        titulo: 'Você já está trabalhando sem ponto',
        detalhe: `Primeira tarefa aberta às ${e.primeiro_foco}. Registrar a entrada nesse horário?`,
        retroHora: e.primeiro_foco,
      }
    }
    if (janela(j.entrada)) {
      return { tipo: 'entrada', titulo: 'Hora de bater o ponto', detalhe: `Sua entrada é ${j.entrada}.` }
    }
    return null
  }

  if (dentro) {
    // Trabalhando: avisar a saída; antes disso, a pausa do almoço (se ainda não houve).
    if (janela(j.saida)) {
      return { tipo: 'saida', titulo: 'Quase hora de encerrar', detalhe: `Sua saída é ${j.saida} — registre quando terminar.` }
    }
    if (n === 1 && janela(j.intervalo_ini) && agora < min(j.intervalo_fim)) {
      return { tipo: 'pausa', titulo: 'Saindo para o almoço?', detalhe: `Seu intervalo começa ${j.intervalo_ini}. Registre a pausa ao sair.` }
    }
    return null
  }

  // Em pausa (marcações pares > 0): avisar o retorno.
  if (janela(j.intervalo_fim) && agora < min(j.saida)) {
    return { tipo: 'retorno', titulo: 'Voltando do intervalo?', detalhe: `Seu retorno é ${j.intervalo_fim}. Registre ao voltar.` }
  }
  return null
}

const snoozeKey = (tipo: string, dia: string) => `ponto-snooze:${tipo}:${dia}`
function snoozed(tipo: string, dia: string): boolean {
  try {
    const raw = localStorage.getItem(snoozeKey(tipo, dia))
    return !!raw && Date.now() < Number(raw)
  } catch { return false }
}

/**
 * Lembrete de ponto — card fixo no canto (nunca modal bloqueante). Aparece
 * ~10 min antes de cada horário da jornada e, no caso preventivo, assim que a
 * pessoa abre tarefa sem ter ponto aberto (aí oferece registrar a entrada na
 * hora do primeiro foco — validada no servidor). Sem ficha vinculada: nada.
 */
export function PontoPrompt({ orgSlug }: { orgSlug: string }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [oculto, setOculto] = useState(false)
  const [extra, setExtra] = useState<{ nascida: ExtraNascida; colaboradorId: string } | null>(null)
  const [pending, start] = useTransition()

  const carregar = useCallback(() => {
    pontoEstado().then(e => { setEstado(e); setOculto(false) })
  }, [])

  useEffect(() => {
    carregar()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') carregar()
    }, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') carregar() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [carregar])

  // O modal de contexto da extra vive FORA do early-return: depois de bater a
  // saída o lembrete some (decidir() = null) e o modal precisa continuar aberto.
  const modalExtra = extra ? (
    <ExtraContextoModal orgSlug={orgSlug} colaboradorId={extra.colaboradorId}
      extra={extra.nascida} onClose={() => setExtra(null)} />
  ) : null

  const prompt = estado ? decidir(estado) : null
  if (!estado || !prompt || oculto || snoozed(prompt.tipo, estado.dia)) return modalExtra

  function depois() {
    try { localStorage.setItem(snoozeKey(prompt!.tipo, estado!.dia), String(Date.now() + SNOOZE_MIN * 60_000)) } catch {}
    setOculto(true)
  }

  function bater(retro: boolean) {
    const colaboradorId = estado!.colaborador_id
    start(async () => {
      const r = retro
        ? await baterEntradaRetro(orgSlug)
        : await baterPonto(orgSlug, colaboradorId)
      if (r && 'error' in r && r.error) { toast.error(r.error); return }
      const hora = retro && r && 'hora' in r ? (r as { hora?: string }).hora : null
      toast.success(hora ? `Entrada registrada às ${hora}.` : 'Ponto registrado.')
      // A batida do lembrete de saída pode fechar o dia com extra pendente —
      // é exatamente o momento de perguntar o contexto.
      if (!retro && r && 'resultado' in r) {
        const ex = extraNascida(r.resultado)
        if (ex) setExtra({ nascida: ex, colaboradorId })
      }
      carregar()
    })
  }

  return (<>
    {modalExtra}
    <div className="fixed bottom-4 left-4 md:left-auto md:right-4 md:bottom-24 z-40 max-w-sm w-[calc(100%-2rem)] md:w-80 rounded-2xl border border-orange-200 bg-white shadow-xl shadow-orange-500/10 p-4 animate-[paletteIn_0.2s_ease-out]">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
          <Clock className="w-4.5 h-4.5 text-orange-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{prompt.titulo}</p>
          <p className="text-xs text-gray-500 mt-0.5">{prompt.detalhe}</p>
        </div>
        <button onClick={depois} title="Lembrar em 15 min"
          className="p-1 -m-1 text-gray-300 hover:text-gray-500 transition-colors shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 mt-3 pl-12">
        {prompt.tipo === 'entrada-retro' ? (
          <>
            <button onClick={() => bater(true)} disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors disabled:opacity-50 active:scale-[0.97]">
              {pending && <Loader2 className="w-3 h-3 animate-spin" />}
              Entrada às {prompt.retroHora}
            </button>
            <button onClick={() => bater(false)} disabled={pending}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">
              Bater agora
            </button>
          </>
        ) : (
          <>
            <button onClick={() => bater(false)} disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors disabled:opacity-50 active:scale-[0.97]">
              {pending && <Loader2 className="w-3 h-3 animate-spin" />}
              Bater ponto
            </button>
            <button onClick={depois}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-gray-600 hover:bg-gray-100 transition-colors">
              Mais tarde
            </button>
          </>
        )}
      </div>
    </div>
  </>)
}
