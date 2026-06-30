'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, ChevronDown, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolveSystemError } from '@/app/actions/system-errors'

export interface SystemError {
  id: string
  context: string
  message: string
  detail: string | null
  activity_id: string | null
  resolved: boolean
  created_at: string
}

function timeAgo(iso: string) {
  const dt = new Date(iso)
  const s = Math.floor((Date.now() - dt.getTime()) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.floor(s / 60)} min`
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`
  if (s < 604800) return `há ${Math.floor(s / 86400)} d`
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function ErrosClient({ orgSlug, erros }: { orgSlug: string; erros: SystemError[] }) {
  const [mostrarResolvidos, setMostrarResolvidos] = useState(false)
  const naoResolvidos = erros.filter(e => !e.resolved).length
  const lista = mostrarResolvidos ? erros : erros.filter(e => !e.resolved)

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Erros do sistema</h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Falhas capturadas em 2º plano (ex.: revisão por IA). Os usuários não veem o detalhe técnico.
          </p>
        </div>
        {erros.some(e => e.resolved) && (
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer shrink-0">
            <input type="checkbox" checked={mostrarResolvidos} onChange={e => setMostrarResolvidos(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
            Mostrar resolvidos
          </label>
        )}
      </div>

      {lista.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
          <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">{naoResolvidos === 0 ? 'Nenhum erro pendente' : 'Tudo resolvido'}</h3>
          <p className="text-gray-500 text-sm mt-1">O sistema não registrou falhas em aberto.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {lista.map(e => <ErroRow key={e.id} orgSlug={orgSlug} erro={e} />)}
        </ul>
      )}
    </div>
  )
}

function ErroRow({ orgSlug, erro }: { orgSlug: string; erro: SystemError }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  function toggleResolved() {
    start(async () => {
      const res = await resolveSystemError(orgSlug, erro.id, !erro.resolved)
      if (!res?.error) router.refresh()
    })
  }

  return (
    <li className={cn('bg-white border rounded-xl overflow-hidden', erro.resolved ? 'border-gray-100 opacity-60' : 'border-gray-200')}>
      <div className="flex items-start gap-3 px-4 py-3">
        <AlertTriangle className={cn('w-4 h-4 mt-0.5 shrink-0', erro.resolved ? 'text-gray-300' : 'text-amber-500')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-[11px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{erro.context}</code>
            <span className="text-[11px] text-gray-400">{timeAgo(erro.created_at)}</span>
            {erro.resolved && <span className="text-[11px] text-emerald-600 inline-flex items-center gap-1"><Check className="w-3 h-3" /> resolvido</span>}
          </div>
          <p className="text-sm text-gray-800 mt-1 break-words">{erro.message}</p>

          <div className="flex items-center gap-3 mt-1.5">
            {erro.detail && (
              <button onClick={() => setOpen(o => !o)} className="text-xs text-gray-400 hover:text-gray-600 inline-flex items-center gap-1 transition">
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} /> Detalhe técnico
              </button>
            )}
            {erro.activity_id && (
              <a href={`/${orgSlug}/views/lista?activity=${erro.activity_id}`} className="text-xs text-orange-600 hover:text-orange-700 transition">Abrir tarefa</a>
            )}
          </div>

          {open && erro.detail && (
            <pre className="mt-2 text-[11px] leading-relaxed text-gray-600 bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words max-h-72 overflow-y-auto">{erro.detail}</pre>
          )}
        </div>

        <button onClick={toggleResolved} disabled={pending} title={erro.resolved ? 'Reabrir' : 'Marcar como resolvido'}
          className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition disabled:opacity-50">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : erro.resolved ? <RotateCcw className="w-4 h-4" /> : <Check className="w-4 h-4" />}
        </button>
      </div>
    </li>
  )
}
