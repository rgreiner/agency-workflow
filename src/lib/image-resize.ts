/**
 * Reduz uma imagem no browser antes de subir (não pesar no servidor).
 * Mantém proporção dentro de maxDim e exporta WebP. SVG/GIF passam direto
 * (canvas rasterizaria/perderia animação). Em qualquer falha, devolve o original.
 */
export async function downscaleImage(file: File, maxDim = 1600, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file
  try {
    const url = URL.createObjectURL(file)
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    URL.revokeObjectURL(url)

    const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
    if (scale >= 1 && file.size <= 1_500_000) return file // já é leve

    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/webp', quality))
    if (!blob) return file
    return new File([blob], 'img.webp', { type: 'image/webp' })
  } catch {
    return file
  }
}
