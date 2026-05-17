'use client'

import { useState } from 'react'
import { getOrCreateInviteLink, deactivateInviteLink } from '@/app/actions/settings'
import { sendInviteEmail } from '@/app/actions/email'
import { Link2, Copy, Check, UserPlus, X, Loader2, Mail, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Props {
  orgId: string
  orgSlug: string
}

type Tab = 'link' | 'email'

export function InviteButton({ orgId, orgSlug }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('link')
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inviteUrl = token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/convite/${token}`
    : ''

  async function handleOpen() {
    if (open) { setOpen(false); return }
    setLoading(true)
    setError(null)
    const result = await getOrCreateInviteLink(orgSlug, orgId)
    setLoading(false)
    if (result.error) { setError(result.error); return }
    setToken(result.token ?? null)
    setOpen(true)
  }

  async function handleCopy() {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    toast.success('Link copiado!')
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleDeactivate() {
    const result = await deactivateInviteLink(orgSlug, orgId)
    if (result.error) { toast.error(result.error); return }
    setToken(null)
    setOpen(false)
    toast.success('Link desativado.')
  }

  async function handleSendEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSending(true)
    setError(null)
    const result = await sendInviteEmail(orgSlug, orgId, email.trim())
    setSending(false)
    if (result.error) { toast.error(result.error); return }
    setSent(true)
    setEmail('')
    toast.success('Convite enviado!')
    setTimeout(() => setSent(false), 3000)
  }

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        disabled={loading}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-lg transition-colors"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
        Convidar membro
      </button>

      {error && !open && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {open && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-xl border border-gray-200 shadow-lg z-10 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700">Convidar membro</p>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-100">
            {([
              { key: 'link' as Tab, label: 'Link', icon: Link2 },
              { key: 'email' as Tab, label: 'E-mail', icon: Mail },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => { setTab(key); setError(null) }}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition border-b-2',
                  tab === key
                    ? 'text-indigo-600 border-indigo-600'
                    : 'text-gray-400 border-transparent hover:text-gray-600'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {/* Link tab */}
            {tab === 'link' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={inviteUrl}
                    className="flex-1 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 truncate focus:outline-none"
                  />
                  <button
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition whitespace-nowrap"
                  >
                    {copied ? <><Check className="w-3.5 h-3.5" />Copiado!</> : <><Copy className="w-3.5 h-3.5" />Copiar</>}
                  </button>
                </div>
                <p className="text-xs text-gray-400">
                  Qualquer pessoa com este link pode entrar como membro
                </p>
                <button
                  onClick={handleDeactivate}
                  className="text-xs text-red-500 hover:text-red-700 transition"
                >
                  Desativar link
                </button>
              </div>
            )}

            {/* Email tab */}
            {tab === 'email' && (
              <form onSubmit={handleSendEmail} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    E-mail do convidado
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="nome@empresa.com"
                    autoFocus
                    required
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 "
                  />
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                {sent && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Convite enviado!
                  </p>
                )}
                <button
                  type="submit"
                  disabled={sending || !email.trim()}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {sending ? 'Enviando...' : 'Enviar convite'}
                </button>
                <p className="text-xs text-gray-400">
                  A pessoa receberá um e-mail com o link para entrar na organização
                </p>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
