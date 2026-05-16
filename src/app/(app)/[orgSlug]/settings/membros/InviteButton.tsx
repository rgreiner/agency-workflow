'use client'

import { useState } from 'react'
import { getOrCreateInviteLink, deactivateInviteLink } from '@/app/actions/settings'
import { Link, Copy, Check, UserPlus, X, Loader2 } from 'lucide-react'

interface InviteButtonProps {
  orgId: string
  orgSlug: string
}

export function InviteButton({ orgId, orgSlug }: InviteButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inviteUrl = token
    ? `${window.location.origin}/convite/${token}`
    : ''

  async function handleOpen() {
    if (open) {
      setOpen(false)
      return
    }
    setLoading(true)
    setError(null)
    const result = await getOrCreateInviteLink(orgSlug, orgId)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setToken(result.token ?? null)
    setOpen(true)
  }

  async function handleCopy() {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleDeactivate() {
    setDeactivating(true)
    const result = await deactivateInviteLink(orgSlug, orgId)
    setDeactivating(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setToken(null)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        disabled={loading}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-lg transition-colors"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <UserPlus className="w-4 h-4" />
        )}
        Convidar membro
      </button>

      {error && !open && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}

      {open && token && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-xl border border-gray-200 shadow-lg p-4 z-10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Link className="w-4 h-4 text-indigo-500" />
              Link de convite
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-2 mb-2">
            <input
              readOnly
              value={inviteUrl}
              className="flex-1 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 truncate focus:outline-none"
            />
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors whitespace-nowrap"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Copiado!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copiar link
                </>
              )}
            </button>
          </div>

          <p className="text-xs text-gray-400 mb-3">
            Qualquer pessoa com este link pode entrar como membro
          </p>

          {error && (
            <p className="text-xs text-red-600 mb-2">{error}</p>
          )}

          <button
            onClick={handleDeactivate}
            disabled={deactivating}
            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-60 transition-colors"
          >
            {deactivating ? 'Desativando...' : 'Desativar link'}
          </button>
        </div>
      )}
    </div>
  )
}
