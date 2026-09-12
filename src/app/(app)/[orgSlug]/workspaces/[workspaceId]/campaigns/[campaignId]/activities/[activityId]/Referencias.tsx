'use client'

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, Paperclip, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { enviarReferencia, fmtBytes, listarReferencias, type Referencia } from '@/lib/referencias-client'

/**
 * Linha "Referências" do bloco Drive: o que já está em Links/ e o botão de
 * enviar mais. Guia para a criação — a mídia manda o modelo do veículo, o
 * atendimento manda o material do cliente. A lista vem do Drive depois que a
 * página abre, para não segurar a renderização numa chamada externa.
 */
export function Referencias({ activityId, hasFolder, canEdit }: {
  activityId: string; hasFolder: boolean; canEdit: boolean
}) {
  const [lista, setLista] = useState<Referencia[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!hasFolder) return
    let vivo = true
    listarReferencias(activityId)
      .then(r => { if (vivo) setLista(r.arquivos) })
      .catch(e => { if (vivo) { setLista([]); setErro(e instanceof Error ? e.message : 'Falha ao listar') } })
    return () => { vivo = false }
  }, [activityId, hasFolder])

  async function enviar(files: FileList | null) {
    if (!files?.length) return
    const arr = Array.from(files)
    let ok = 0
    for (const [i, f] of arr.entries()) {
      setEnviando(`${i + 1}/${arr.length} · ${f.name}`)
      try { await enviarReferencia(activityId, f); ok++ }
      catch (e) { toast.error(`${f.name}: ${e instanceof Error ? e.message : 'falha no envio'}`) }
    }
    setEnviando(null)
    if (inputRef.current) inputRef.current.value = ''
    if (ok) toast.success(`${ok} ${ok === 1 ? 'arquivo enviado' : 'arquivos enviados'} para a pasta Links.`)
    try { setLista((await listarReferencias(activityId)).arquivos) } catch { /* a lista velha fica */ }
  }

  return (
    <div className="flex items-start px-4 py-3 hover:bg-gray-50/60 transition group">
      <div className="flex items-center gap-2 w-36 shrink-0 pt-0.5">
        <span className="text-gray-500"><Paperclip className="w-4 h-4" /></span>
        <span className="text-xs text-gray-500">Referências</span>
      </div>
      <div className="flex-1 min-w-0">
        {!hasFolder ? (
          <p className="text-xs text-gray-400">Gere a pasta do Drive para anexar referências.</p>
        ) : (
          <div className="flex items-start gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              {lista === null ? (
                <p className="text-xs text-gray-400 inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> lendo a pasta Links…</p>
              ) : lista.length === 0 ? (
                <p className="text-xs text-gray-400">{erro ?? 'Nenhuma referência na pasta Links.'}</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {lista.map(f => (
                    <li key={f.ref}>
                      {f.link ? (
                        <a href={f.link} target="_blank" rel="noopener noreferrer" title={`${f.name} · ${fmtBytes(f.size)}`}
                          className="inline-flex items-center gap-1 max-w-[16rem] px-2 py-0.5 rounded-lg bg-gray-50 text-[11px] font-medium text-gray-600 hover:bg-orange-50 hover:text-orange-700 transition-colors">
                          <ExternalLink className="w-3 h-3 shrink-0" /> <span className="truncate">{f.name}</span>
                          <span className="text-gray-400 shrink-0">{fmtBytes(f.size)}</span>
                        </a>
                      ) : (
                        <span title={`${f.name} · ${fmtBytes(f.size)}`}
                          className="inline-flex items-center gap-1 max-w-[16rem] px-2 py-0.5 rounded-lg bg-gray-50 text-[11px] font-medium text-gray-600">
                          <span className="truncate">{f.name}</span>
                          <span className="text-gray-400 shrink-0">{fmtBytes(f.size)}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {canEdit && (
              <label className={cn('inline-flex items-center gap-1 text-xs shrink-0 cursor-pointer transition',
                enviando ? 'text-gray-400' : 'text-gray-400 hover:text-orange-600')}
                title="Qualquer tipo, até 25 MB por arquivo. Vai para a pasta Links da tarefa.">
                {enviando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                {enviando ? `Enviando ${enviando}` : 'Enviar arquivos'}
                <input ref={inputRef} type="file" multiple className="sr-only" disabled={!!enviando}
                  onChange={e => enviar(e.target.files)} />
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
