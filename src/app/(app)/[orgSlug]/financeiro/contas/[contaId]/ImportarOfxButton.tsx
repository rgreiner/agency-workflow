'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { parseOfx, decodeOfxBytes } from '@/lib/ofx'
import { importarOfx, registrarArquivoOfx } from '@/app/actions/btg'
import { uploadFile } from '@/lib/storage/upload-client'

export function ImportarOfxButton({ orgSlug, contaId }: { orgSlug: string; contaId: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite reimportar o mesmo arquivo
    if (!file) return
    setBusy(true)
    try {
      const text = decodeOfxBytes(await file.arrayBuffer())
      const parsed = parseOfx(text)
      if (parsed.txns.length === 0) {
        toast.error('Nenhuma transação encontrada no OFX. Confira o arquivo.')
        return
      }
      // Guarda o arquivo ORIGINAL antes de importar: é o documento que a
      // contabilidade aceita no fechamento mensal. Se o upload falhar, seguimos —
      // perder o anexo é chato, perder o extrato seria pior.
      let caminho: string | null = null
      try {
        const url = await uploadFile('ofx', `${crypto.randomUUID()}.ofx`, file)
        caminho = 'ofx/' + url.split('/uploads/ofx/')[1]
      } catch { caminho = null }

      startTransition(async () => {
        const res = await importarOfx(orgSlug, contaId, parsed.txns, parsed.saldo, parsed.saldoData)
        if (res?.error) { toast.error(res.error); return }
        if (caminho) {
          const datas = parsed.txns.map(t => t.data).filter(Boolean).sort()
          await registrarArquivoOfx(orgSlug, contaId, {
            nome: file.name, caminho, bytes: file.size,
            periodoIni: datas[0] ?? null, periodoFim: datas[datas.length - 1] ?? null,
          })
        }
        const r = res?.result
        toast.success(
          `OFX importado: ${r?.inserted ?? 0} novo(s)` +
          (r?.skipped ? `, ${r.skipped} já existia(m)` : '') +
          (parsed.saldo != null ? ` · saldo do banco: ${parsed.saldo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : '') + '.',
        )
        router.refresh()
      })
    } catch {
      toast.error('Não foi possível ler o arquivo OFX.')
    } finally {
      setBusy(false)
    }
  }

  const loading = busy || isPending
  return (
    <>
      <input ref={inputRef} type="file" accept=".ofx,.OFX,text/plain" className="hidden" onChange={onFile} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition disabled:opacity-60"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        Importar OFX
      </button>
    </>
  )
}
