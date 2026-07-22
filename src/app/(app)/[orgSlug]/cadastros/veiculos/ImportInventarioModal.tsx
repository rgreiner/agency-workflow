'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X, Loader2, Check, UploadCloud, MapPin, ImageOff } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { salvarInventario, type InventarioPonto } from '@/app/actions/inventario'

interface Preview {
  tipo: string
  total: number
  comCoord: number
  comFoto: number
  pontos: InventarioPonto[]
}

/** Import do inventário de um veículo: sobe o PDF (+ KML opcional), mostra a prévia
 *  do que foi reconhecido e confirma. O parsing roda no servidor (poppler). */
export function ImportInventarioModal({ orgSlug, veiculoId, veiculoNome, onClose }: {
  orgSlug: string; veiculoId: string; veiculoNome: string; onClose: () => void
}) {
  const router = useRouter()
  const [pdf, setPdf] = useState<File | null>(null)
  const [kml, setKml] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [saving, startSave] = useTransition()
  const pdfRef = useRef<HTMLInputElement>(null)

  async function processar() {
    if (!pdf) { setError('Escolha o PDF do inventário'); return }
    setError(''); setProcessing(true)
    try {
      const fd = new FormData()
      fd.set('veiculo_id', veiculoId)
      fd.set('pdf', pdf)
      if (kml) fd.set('kml', kml)
      const res = await fetch('/api/inventario/import', { method: 'POST', body: fd })
      const body = await res.json()
      if (!res.ok) { setError(body.error || 'Falha ao processar'); return }
      setPreview(body as Preview)
    } catch {
      setError('Falha de rede ao enviar o PDF')
    } finally { setProcessing(false) }
  }

  function confirmar() {
    if (!preview) return
    startSave(async () => {
      const res = await salvarInventario(orgSlug, veiculoId, 'logycware', preview.pontos)
      if (res?.error) { toast.error(res.error); return }
      toast.success(`${res.result?.processados ?? preview.total} pontos importados para ${veiculoNome}`)
      onClose(); router.refresh()
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-3xl max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Importar inventário — {veiculoNome}</h2>
          <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
        </div>

        {!preview ? (
          <div className="px-6 py-5 space-y-4">
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <p className="text-sm text-gray-500">Suba o <strong>PDF de pontos</strong> do fornecedor (formato Rede Outdoor/logycware). O <strong>KML</strong> do Google MyMaps é opcional e completa as coordenadas que faltarem.</p>

            <FileDrop label="PDF de pontos" accept="application/pdf" file={pdf} onFile={setPdf} inputRef={pdfRef} />
            <FileDrop label="KML do MyMaps (opcional)" accept=".kml,application/vnd.google-earth.kml+xml,text/xml" file={kml} onFile={setKml} />

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
              <button onClick={processar} disabled={processing || !pdf}
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
                {processing ? <><Loader2 className="w-4 h-4 animate-spin" /> Processando…</> : <><UploadCloud className="w-4 h-4" /> Processar</>}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-4 text-sm">
              <span className="font-medium text-gray-900">{preview.total} pontos</span>
              <span className="text-gray-500">{preview.tipo}</span>
              <span className="text-gray-400">·</span>
              <span className="text-gray-500"><MapPin className="w-3.5 h-3.5 inline -mt-0.5" /> {preview.comCoord} c/ coordenada</span>
              <span className="text-gray-500">{preview.comFoto} c/ foto</span>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-2">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-xs text-gray-400 text-left border-b border-gray-100">
                    <th className="py-2 w-12">Foto</th><th className="py-2 w-24">Código</th>
                    <th className="py-2">Endereço</th><th className="py-2 w-14 text-center">Coord</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {preview.pontos.map((p, i) => (
                    <tr key={p.codigo + i}>
                      <td className="py-1.5">
                        {p.foto_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={p.foto_url} alt="" loading="lazy" className="w-10 h-7 object-cover rounded border border-gray-200" />
                          : <span className="w-10 h-7 rounded bg-gray-100 inline-flex items-center justify-center"><ImageOff className="w-3.5 h-3.5 text-gray-300" /></span>}
                      </td>
                      <td className="py-1.5 font-medium text-gray-800 tabular-nums">{p.codigo}</td>
                      <td className="py-1.5 text-gray-600 truncate max-w-md" title={p.endereco_full ?? ''}>{p.endereco_full || '—'}</td>
                      <td className="py-1.5 text-center">{p.lat != null ? <Check className="w-4 h-4 text-emerald-500 inline" /> : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
              <button onClick={() => setPreview(null)} className="text-sm text-gray-500 hover:text-gray-700 transition">← Trocar arquivo</button>
              <button onClick={confirmar} disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Confirmar import
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FileDrop({ label, accept, file, onFile, inputRef }: {
  label: string; accept: string; file: File | null; onFile: (f: File | null) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  const [over, setOver] = useState(false)
  return (
    <label
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f) }}
      className={cn('flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed cursor-pointer transition-colors',
        over ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100')}>
      <UploadCloud className="w-5 h-5 text-gray-400 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-600">{label}</p>
        <p className="text-sm text-gray-800 truncate">{file ? file.name : 'Clique ou arraste o arquivo'}</p>
      </div>
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={e => onFile(e.target.files?.[0] ?? null)} />
    </label>
  )
}
