'use client'

/**
 * Recorte + compressão de imagem antes do upload, sem dependência externa:
 * arrasta para posicionar, slider de zoom, exporta WebP via canvas. Parametrizável
 * (quadro, tamanho de saída, formato redondo/retangular). Usado por AvatarCropper
 * (quadrado/circular) e ImageCropper (retangular).
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Loader2, Check, X, ZoomIn } from 'lucide-react'

interface Props {
  file: File
  onCancel: () => void
  onConfirm: (result: File) => void
  frameW: number
  frameH: number
  outW: number
  outH: number
  quality?: number
  round?: boolean
  title: string
  confirmLabel: string
  fileName?: string
}

export function Cropper({
  file, onCancel, onConfirm,
  frameW, frameH, outW, outH,
  quality = 0.85, round = false, title, confirmLabel, fileName = 'img.webp',
}: Props) {
  const [imgUrl, setImgUrl] = useState('')
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImgUrl(url)
    const image = new Image()
    image.onload = () => setImg(image)
    image.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const baseScale = img ? Math.max(frameW / img.width, frameH / img.height) : 1
  const scale = baseScale * zoom
  const w = img ? img.width * scale : 0
  const h = img ? img.height * scale : 0

  const clamp = useCallback((o: { x: number; y: number }) => {
    const maxX = Math.max(0, (w - frameW) / 2)
    const maxY = Math.max(0, (h - frameH) / 2)
    return { x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) }
  }, [w, h, frameW, frameH])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setOffset(o => clamp(o)) }, [clamp])

  function onDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    setOffset(clamp({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }))
  }
  function onUp() { drag.current = null }

  async function confirm() {
    if (!img) return
    setSaving(true)
    try {
      const ratio = outW / frameW
      const dx = (frameW - w) / 2 + offset.x
      const dy = (frameH - h) / 2 + offset.y
      const canvas = document.createElement('canvas')
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas indisponível')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, dx * ratio, dy * ratio, w * ratio, h * ratio)
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/webp', quality))
      if (!blob) throw new Error('Falha ao processar a imagem')
      onConfirm(new File([blob], fileName, { type: 'image/webp' }))
    } catch {
      setSaving(false)
    }
  }

  const radius = round ? '9999px' : '0.5rem'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 modal-backdrop p-4" onClick={onCancel}>
      <div className="modal-card bg-white rounded-2xl shadow-xl p-5 max-w-full" style={{ width: frameW + 60 }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <button aria-label="Fechar" type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600 transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div
          className="relative mx-auto overflow-hidden bg-gray-100 touch-none select-none cursor-grab active:cursor-grabbing"
          style={{ width: frameW, height: frameH, borderRadius: radius }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        >
          {imgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt="" draggable={false}
              style={{ position: 'absolute', width: w, height: h, left: (frameW - w) / 2 + offset.x, top: (frameH - h) / 2 + offset.y, maxWidth: 'none' }} />
          )}
          <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-black/10" style={{ borderRadius: radius }} />
        </div>

        <div className="flex items-center gap-2 mt-4">
          <ZoomIn className="w-4 h-4 text-gray-400 shrink-0" />
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={e => setZoom(Number(e.target.value))} className="flex-1 accent-indigo-600" aria-label="Zoom" />
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">Cancelar</button>
          <button aria-label="Salvar" type="button" onClick={confirm} disabled={saving || !img}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-[#fff] hover:bg-indigo-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
