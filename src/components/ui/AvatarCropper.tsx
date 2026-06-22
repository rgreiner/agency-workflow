'use client'

/**
 * Recorte (quadrado/circular) + compressão de avatar antes do upload. Sem
 * dependência externa: arrasta para posicionar, slider para zoom, e exporta um
 * WebP 512×512 (~dezenas de KB) via canvas. Respeita a orientação EXIF porque
 * usa o <img> já decodificado pelo browser.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Loader2, Check, X, ZoomIn } from 'lucide-react'

const FRAME = 280   // tamanho do recorte na tela (px)
const OUT = 512     // tamanho exportado (px)
const QUALITY = 0.85

export function AvatarCropper({ file, onCancel, onConfirm }: {
  file: File
  onCancel: () => void
  onConfirm: (result: File) => void
}) {
  const [imgUrl, setImgUrl] = useState('')
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setImgUrl(url)
    const image = new Image()
    image.onload = () => setImg(image)
    image.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const baseScale = img ? Math.max(FRAME / img.width, FRAME / img.height) : 1
  const scale = baseScale * zoom
  const w = img ? img.width * scale : 0
  const h = img ? img.height * scale : 0

  // Mantém a imagem sempre cobrindo o recorte (sem "buracos").
  const clamp = useCallback((o: { x: number; y: number }) => {
    const maxX = Math.max(0, (w - FRAME) / 2)
    const maxY = Math.max(0, (h - FRAME) / 2)
    return { x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) }
  }, [w, h])

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
      const ratio = OUT / FRAME
      const dx = (FRAME - w) / 2 + offset.x
      const dy = (FRAME - h) / 2 + offset.y
      const canvas = document.createElement('canvas')
      canvas.width = OUT
      canvas.height = OUT
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas indisponível')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, dx * ratio, dy * ratio, w * ratio, h * ratio)
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/webp', QUALITY))
      if (!blob) throw new Error('Falha ao processar a imagem')
      onConfirm(new File([blob], 'avatar.webp', { type: 'image/webp' }))
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 modal-backdrop p-4" onClick={onCancel}>
      <div className="modal-card bg-white rounded-2xl shadow-xl p-5 w-[340px] max-w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Ajustar foto</h3>
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          className="relative mx-auto overflow-hidden bg-gray-100 touch-none select-none cursor-grab active:cursor-grabbing rounded-full"
          style={{ width: FRAME, height: FRAME }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {imgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgUrl}
              alt=""
              draggable={false}
              style={{ position: 'absolute', width: w, height: h, left: (FRAME - w) / 2 + offset.x, top: (FRAME - h) / 2 + offset.y, maxWidth: 'none' }}
            />
          )}
          <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-black/10" />
        </div>

        <div className="flex items-center gap-2 mt-4">
          <ZoomIn className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            type="range" min={1} max={3} step={0.01} value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="flex-1 accent-indigo-600"
            aria-label="Zoom"
          />
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={saving || !img}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Usar foto
          </button>
        </div>
      </div>
    </div>
  )
}
