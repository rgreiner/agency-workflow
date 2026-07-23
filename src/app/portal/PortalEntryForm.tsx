'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Paperclip, X, Loader2, CheckCircle2, Send } from 'lucide-react'
import type { PortalAnexo } from '@/app/actions/portal'

interface Props {
  /** Título opcional (só na solicitação nova). Se `askTitulo`, é campo obrigatório. */
  askTitulo?: boolean
  tituloLabel?: string
  mensagemLabel: string
  mensagemPlaceholder?: string
  submitLabel: string
  sucessoTitulo: string
  sucessoTexto: string
  /** Recebe (titulo, mensagem, anexos) e faz a chamada. */
  onSubmit: (titulo: string, mensagem: string, anexos: PortalAnexo[]) => Promise<{ error?: string }>
}

export function PortalEntryForm({
  askTitulo = false, tituloLabel = 'Assunto', mensagemLabel,
  mensagemPlaceholder, submitLabel, sucessoTitulo, sucessoTexto, onSubmit,
}: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [titulo, setTitulo] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [anexos, setAnexos] = useState<PortalAnexo[]>([])
  const [uploading, setUploading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [isPending, startTransition] = useTransition()

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setErro(null)
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/portal/upload', { method: 'POST', body: fd })
        const json = await res.json()
        if (!res.ok) { setErro(json.error || 'Falha no upload.'); break }
        setAnexos((a) => [...a, { chave: json.chave, nome: json.nome }])
      }
    } catch {
      setErro('Falha no upload. Tente de novo.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function submit() {
    setErro(null)
    if (askTitulo && !titulo.trim()) { setErro('Preencha o assunto.'); return }
    if (!mensagem.trim()) { setErro('Escreva uma mensagem.'); return }
    startTransition(async () => {
      const res = await onSubmit(titulo.trim(), mensagem.trim(), anexos)
      if (res.error) { setErro(res.error); return }
      setOk(true)
    })
  }

  if (ok) {
    return (
      <div className="text-center py-6">
        <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-gray-900">{sucessoTitulo}</h2>
        <p className="text-sm text-gray-500 mt-1 mb-6 leading-relaxed">{sucessoTexto}</p>
        <button
          onClick={() => router.push('/portal/painel')}
          className="px-5 py-2.5 rounded-xl text-[#fff] text-sm font-medium bg-orange-600 hover:bg-orange-700 transition"
        >
          Voltar ao painel
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {askTitulo && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{tituloLabel}</label>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Nova arte para campanha de setembro"
            className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{mensagemLabel}</label>
        <textarea
          value={mensagem}
          onChange={(e) => setMensagem(e.target.value)}
          rows={5}
          placeholder={mensagemPlaceholder}
          className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 resize-y focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
      </div>

      <div>
        {anexos.length > 0 && (
          <ul className="space-y-1.5 mb-2">
            {anexos.map((a, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                <Paperclip className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span className="flex-1 min-w-0 truncate">{a.nome}</span>
                <button
                  onClick={() => setAnexos((arr) => arr.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-red-600 transition-colors"
                  aria-label="Remover anexo"
                >
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={fileRef} type="file" multiple className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          {uploading ? 'Enviando…' : 'Anexar arquivos'}
        </button>
      </div>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      <button
        onClick={submit}
        disabled={isPending || uploading}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[#fff] font-medium bg-orange-600 hover:bg-orange-700 transition disabled:opacity-50"
      >
        {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {submitLabel}
      </button>
    </div>
  )
}
