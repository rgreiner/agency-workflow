/** Extensão correta a partir do mime (pra nomear o arquivo no upload). */
export function extForType(type: string): string {
  if (type === 'image/svg+xml') return 'svg'
  if (type === 'image/gif') return 'gif'
  return 'webp'
}

/**
 * Reduz/converte uma imagem no browser antes de subir — pra SEMPRE pesar menos.
 * Reencoda TODA imagem rasterizada para WebP (mais leve que PNG/JPEG) e limita a
 * dimensão a maxDim. SVG/GIF passam direto (vetor / animação — rasterizar perderia).
 * Só mantém o original no caso raro de o WebP ficar maior sem redimensionar.
 * Em qualquer falha, devolve o original.
 */
export async function downscaleImage(file: File, maxDim = 1600, quality = 0.82): Promise<File> {
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
    // Mesma dimensão e o WebP saiu maior (ex.: original já super otimizado) → fica com o menor.
    if (scale >= 1 && blob.size >= file.size) return file
    return new File([blob], 'img.webp', { type: 'image/webp' })
  } catch {
    return file
  }
}
