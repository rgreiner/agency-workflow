'use client'

import { useEffect } from 'react'

/** Rola o feed de atividade pro fim (mostra os últimos comentários) ao abrir e
 *  quando o total muda (novo comentário / refresh). */
export function ScrollFeedBottom({ feedId, count }: { feedId: string; count: number }) {
  useEffect(() => {
    const el = document.getElementById(feedId)
    if (el) el.scrollTop = el.scrollHeight
  }, [feedId, count])
  return null
}
