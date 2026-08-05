/**
 * Service worker do Flow — mínimo de propósito.
 *
 * Só faz uma coisa: quando uma NAVEGAÇÃO falha por falta de rede, serve a
 * página /offline (cacheada no install). Nenhum outro request é interceptado —
 * nada de cachear API, página autenticada ou asset: dado velho em tela de
 * dinheiro/ponto é pior do que erro de rede.
 *
 * A existência dele também é o que destrava o resto do PWA: instalação "rica"
 * no Android e, na fase do web-push, os handlers de push entram aqui.
 */
const CACHE = 'flow-sw-v1'
const OFFLINE_URL = '/offline'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // cache: 'reload' ignora o cache HTTP — garante a versão viva da página.
      cache.add(new Request(OFFLINE_URL, { cache: 'reload' })),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL).then((r) => r ?? Response.error()),
    ),
  )
})

// ── Web-push (fase 4) ────────────────────────────────────────────────────────
// Payload JSON: { title, body, url, tag } — montado em src/lib/push.ts.
self.addEventListener('push', (event) => {
  if (!event.data) return
  let d = {}
  try { d = event.data.json() } catch { return }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Flow', {
      body: d.body || '',
      icon: '/apple-icon',
      badge: '/apple-icon',
      tag: d.tag || undefined,
      data: { url: d.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  const alvo = new URL(url, self.location.origin).href
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        // Janela já aberta: navega nela e traz pra frente (não abre outra).
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(alvo)
          return c.focus()
        }
      }
      return clients.openWindow(alvo)
    }),
  )
})
