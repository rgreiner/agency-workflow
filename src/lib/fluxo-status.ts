'use client'

import { useEffect, useState } from 'react'
import { transicoesSugeridas, type TransicaoSugerida } from '@/app/actions/fluxo-status'

export type { TransicaoSugerida }

/**
 * Fluxo medido da org, buscado uma vez por sessão de navegação.
 *
 * Cache no módulo e não no provider de settings: isto só interessa a quem troca
 * status, e carregar em toda página seria uma consulta a mais em telas que nunca
 * vão usar. A matriz muda devagar — um recarregamento de página já a atualiza.
 */
const cache = new Map<string, Promise<TransicaoSugerida[]>>()

export function useFluxoStatus(orgId: string | undefined): TransicaoSugerida[] {
  const [linhas, setLinhas] = useState<TransicaoSugerida[]>([])

  useEffect(() => {
    if (!orgId) return
    let vivo = true
    if (!cache.has(orgId)) cache.set(orgId, transicoesSugeridas(orgId))
    cache.get(orgId)!.then(r => { if (vivo) setLinhas(r) })
    return () => { vivo = false }
  }, [orgId])

  return linhas
}

/**
 * Os destinos sugeridos a partir de um status, já cortados.
 *
 * Devolve no máximo dois, e só o primeiro quando o segundo é fraco: em
 * "validação do atendimento" existem 17 destinos e o segundo tem 14% — dar a
 * ele o mesmo peso visual de um destino de 76% seria mentir sobre a régua da
 * casa. O corte de 15% é o ponto onde a opção deixa de ser rotina e vira
 * exceção, que a lista completa já atende.
 */
export function destinosSugeridos(
  fluxo: TransicaoSugerida[], statusAtual: string, excluir: (valor: string) => boolean = () => false,
): TransicaoSugerida[] {
  const doStatus = fluxo
    .filter(t => t.de === statusAtual && !excluir(t.para))
    .sort((a, b) => a.pos - b.pos)
  if (doStatus.length === 0) return []
  const [primeiro, segundo] = doStatus
  return segundo && segundo.pct >= 15 ? [primeiro, segundo] : [primeiro]
}
