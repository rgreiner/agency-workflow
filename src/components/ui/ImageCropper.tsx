'use client'

/**
 * Recorte retangular (4:3) + compressão antes do upload. Sem dependência externa:
 * arrasta para posicionar, slider de zoom, exporta WebP ~800×600 (dezenas de KB)
 * via canvas — pra não pesar no servidor.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Loader2, Check, X, ZoomIn } from 'lucide-react'

const FRAME_W = 360
const FRAME_H = 270
const OUT_W = 800
const OUT_H = 600
const QUALITY = 0.8

export function ImageCropper({ file, onCancel, onConfirm }: {
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImgUrl(url)
    const image = new Image()
    image.onload = () => setImg(image)
    image.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const baseScale = img ? Math.max(FRAME_W / img.width, FRAME_H / img.height) : 1
  const scale = baseScale * zoom
  const w = img ? img.width * scale : 0
  const h = img ? img.height * scale : 0

  const clamp = useCallback((o: { x: number; y: number }) => {
    const maxX = Math.max(0, (w - FRAME_W) / 2)
    const maxY = Math.max(0, (h - FRAME_H) / 2)
    return { x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) }
  }, [w, h])

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
      const ratio = OUT_W / FRAME_W
      const dx = (FRAME_W - w) / 2 + offset.x
      const dy = (FRAME_H - h) / 2 + offset.y
      const canvas = document.createElement('canvas')
      canvas.width = OUT_W
      canvas.height = OUT_H
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas indisponível')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, dx * ratio, dy * ratio, w * ratio, h * ratio)
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/webp', QUALITY))
      if (!blob) throw new Error('Falha ao processar a imagem')
      onConfirm(new File([blob], 'ref.webp', { type: 'image/webp' }))
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 modal-backdrop p-4" onClick={onCancel}>
      <div className="modal-card bg-white rounded-2xl shadow-xl p-5 w-[420px] max-w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Ajustar imagem de referência</h3>
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600 transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div
          className="relative mx-auto overflow-hidden bg-gray-100 touch-none select-none cursor-grab active:cursor-grabbing rounded-lg"
          style={{ width: FRAME_W, height: FRAME_H }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        >
          {imgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt="" draggable={false}
              style={{ position: 'absolute', width: w, height: h, left: (FRAME_W - w) / 2 + offset.x, top: (FRAME_H - h) / 2 + offset.y, maxWidth: 'none' }} />
          )}
          <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-black/10" />
        </div>

        <div className="flex items-center gap-2 mt-4">
          <ZoomIn className="w-4 h-4 text-gray-400 shrink-0" />
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={e => setZoom(Number(e.target.value))} className="flex-1 accent-indigo-600" aria-label="Zoom" />
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">Cancelar</button>
          <button type="button" onClick={confirm} disabled={saving || !img}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-[#fff] hover:bg-indigo-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Usar imagem
          </button>
        </div>
      </div>
    </div>
  )
}
