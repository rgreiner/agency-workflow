/**
 * Contador de não-lidas por cima do favicon, como Gmail e WhatsApp Web fazem:
 * desenha o icon.png num canvas com uma pílula vermelha no canto superior
 * direito e troca o href dos <link rel="icon">. Com zero, devolve o original.
 *
 * Só vale na aba do navegador (Chrome/Edge/Firefox). O Safari ignora troca de
 * favicon em tempo real, e o app instalado (PWA) não mostra favicon — para
 * esse o TabUnreadBadge usa o `navigator.setAppBadge`.
 */

const TAMANHO = 64 // px do canvas: a aba usa 16/32, 64 fica nítido em retina
const COR = '#ef4444' // mesmo vermelho dos badges da sidebar (red-500)
const ORIGINAL = 'hrefOriginal' // dataset onde o href de fábrica fica guardado

let base: HTMLImageElement | null = null
let carregando: Promise<HTMLImageElement | null> | null = null
let cache: { n: number; url: string } | null = null
let pedido = 0

function links(): HTMLLinkElement[] {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'))
}

function carregarBase(): Promise<HTMLImageElement | null> {
  if (base) return Promise.resolve(base)
  if (!carregando) {
    // O PNG de 512 que o Next serve com hash na query — mesma origem, então o
    // canvas não fica "tainted" e o toDataURL funciona.
    const png = links().find(l => l.type === 'image/png')
    const src = png?.dataset[ORIGINAL] ?? png?.getAttribute('href') ?? '/icon.png'
    carregando = new Promise(resolve => {
      const img = new Image()
      img.onload = () => { base = img; resolve(img) }
      img.onerror = () => resolve(null)
      img.src = src
    })
  }
  return carregando
}

function pilula(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = h / 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(x + r, y + h)
  ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2)
  ctx.closePath()
}

function desenhar(img: HTMLImageElement, n: number): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = TAMANHO
  canvas.height = TAMANHO
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, TAMANHO, TAMANHO)

  const texto = n > 99 ? '99+' : String(n)
  const alt = TAMANHO * 0.54 // bolinha ≈ metade do ícone, como no Gmail
  ctx.font = `700 ${Math.round(TAMANHO * 0.36)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  // 1 dígito = bolinha; 2+ = pílula que cresce com o texto.
  const larg = Math.max(alt, Math.ceil(ctx.measureText(texto).width) + TAMANHO * 0.2)
  const x = TAMANHO - larg // encostada no canto superior direito
  const y = 0
  ctx.fillStyle = COR
  pilula(ctx, x, y, larg, alt)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(texto, x + larg / 2, y + alt / 2 + 1)
  return canvas.toDataURL('image/png')
}

function restaurar() {
  for (const l of links()) {
    const original = l.dataset[ORIGINAL]
    if (original === undefined) continue
    l.setAttribute('href', original)
    delete l.dataset[ORIGINAL]
  }
}

function aplicarUrl(url: string) {
  for (const l of links()) {
    if (l.dataset[ORIGINAL] === undefined) l.dataset[ORIGINAL] = l.getAttribute('href') ?? ''
    if (l.getAttribute('href') !== url) l.setAttribute('href', url)
  }
}

/**
 * Idempotente: pode ser chamada a cada mudança do contador e sempre que o
 * <head> muda (o Next pode recriar os <link> ao navegar) — só escreve no DOM
 * quando o href está diferente do esperado.
 */
export function aplicarBadgeFavicon(n: number) {
  if (typeof document === 'undefined') return
  const meu = ++pedido
  if (n <= 0) { restaurar(); return }
  if (cache?.n === n) { aplicarUrl(cache.url); return }
  void carregarBase().then(img => {
    // Chegou um pedido mais novo enquanto o PNG carregava: esse aqui perdeu.
    if (!img || meu !== pedido) return
    const url = desenhar(img, n)
    if (!url) return
    cache = { n, url }
    aplicarUrl(url)
  })
}
