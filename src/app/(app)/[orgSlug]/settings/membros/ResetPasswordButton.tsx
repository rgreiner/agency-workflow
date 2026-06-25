'use client'

import { useState, useTransition } from 'react'
import { KeyRound, Loader2, Copy, Check, X } from 'lucide-react'
import { adminGenerateResetLink, adminSetPassword } from '@/app/actions/auth'
import { toast } from 'sonner'

/**
 * Reset de senha pelo admin (tela de Membros): gera um link de redefinição p/
 * copiar (independe de e-mail) OU define uma senha na hora. Abre em modal p/ não
 * ser cortado pelo overflow da tabela.
 */
export function ResetPasswordButton({ orgId, userId, name }: { orgId: string; userId: string; name: string }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [link, setLink] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [copied, setCopied] = useState(false)

  function close() { setOpen(false); setLink(null); setPw(''); setCopied(false) }

  function genLink() {
    start(async () => {
      const r = await adminGenerateResetLink(orgId, userId)
      if (r.error) toast.error(r.error)
      else if (r.url) setLink(r.url)
    })
  }
  function copy() {
    if (!link) return
    navigator.clipboard.writeText(link).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500) },
      () => toast.error('Não consegui copiar'),
    )
  }
  function setPassword() {
    if (pw.length < 8) { toast.error('Mínimo 8 caracteres.'); return }
    start(async () => {
      const r = await adminSetPassword(orgId, userId, pw)
      if (r.error) toast.error(r.error)
      else { toast.success(`Senha de ${name} redefinida.`); close() }
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Redefinir senha"
        className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
      >
        <KeyRound className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4" onClick={close}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-900">Redefinir senha</h3>
              <button onClick={close} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-gray-500 mb-4 truncate">{name}</p>

            {/* Opção 1: gerar link */}
            {!link ? (
              <button
                onClick={genLink}
                disabled={pending}
                className="w-full flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2.5 rounded-xl bg-indigo-600 text-[#fff] hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                Gerar link de redefinição
              </button>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[11px] text-gray-500">Mande este link pra pessoa (expira em 1h, uso único):</p>
                <div className="flex items-center gap-1.5">
                  <input readOnly value={link} className="flex-1 min-w-0 text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 text-gray-600" />
                  <button onClick={copy} className="p-2 rounded-lg bg-gray-900 text-[#fff] hover:bg-gray-800 shrink-0" title="Copiar">
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 my-4">
              <div className="h-px bg-gray-100 flex-1" /><span className="text-[10px] text-gray-400 uppercase tracking-wider">ou</span><div className="h-px bg-gray-100 flex-1" />
            </div>

            {/* Opção 2: definir senha agora */}
            <p className="text-[11px] text-gray-500 mb-1.5">Definir uma senha agora (avise a pessoa):</p>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={pw}
                onChange={e => setPw(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setPassword() }}
                placeholder="Nova senha (mín. 8)"
                className="flex-1 min-w-0 text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={setPassword}
                disabled={pending || pw.length < 8}
                className="px-3 py-2 rounded-lg bg-indigo-600 text-[#fff] text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shrink-0"
              >
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Definir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
