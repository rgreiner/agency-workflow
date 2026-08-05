'use client'

import { useEffect } from 'react'

/**
 * Registra o service worker (/sw.js). updateViaCache 'none' faz o navegador
 * revalidar o arquivo a cada visita — atualização de SW nunca fica presa em
 * cache HTTP. Falha em silêncio: navegador sem suporte segue como site normal.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => {})
  }, [])
  return null
}
