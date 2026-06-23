'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { ImageCropper } from './ImageCropper'
import { uploadFile } from '@/lib/storage/upload-client'

/** Imagem de referência (cropada + reduzida) de um item. value = URL pública. */
export function ItemImageField({ value, onChange }: { value?: string; onChange: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  async function handleCropped(file: File) {
    setPending(null)
    setUploading(true)
    try {
      const url = await uploadFile('orcamentos', `${crypto.randomUUID()}.webp`, file)
      onChange(url)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha no upload')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) setPending(f); e.target.value = '' }} />
      {value ? (
        <div className="relative w-28 h-20 rounded-lg overflow-hidden border border-gray-200 group shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Referência" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1">
            <button type="button" onClick={() => inputRef.current?.click()} className="text-[10px] font-medium bg-white/90 rounded px-1.5 py-0.5 text-gray-800">Trocar</button>
            <button type="button" onClick={() => onChange('')} className="text-[10px] font-medium bg-white/90 rounded px-1.5 py-0.5 text-red-600">Remover</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="w-28 h-20 rounded-lg border border-dashed border-gray-300 text-gray-400 hover:text-gray-600 hover:border-gray-400 transition flex flex-col items-center justify-center gap-1 text-xs shrink-0 disabled:opacity-50">
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><ImagePlus className="w-4 h-4" /> Imagem</>}
        </button>
      )}
      {pending && <ImageCropper file={pending} onCancel={() => setPending(null)} onConfirm={handleCropped} />}
    </div>
  )
}
