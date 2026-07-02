'use client'

/**
 * Messenger interno (chat 1:1). Dock global no canto inferior direito: janelas de
 * conversa (abrir/minimizar/fechar) + painel de contatos (aberto pela sidebar via
 * evento 'flow:chat-toggle'). Sem Realtime — usa polling via SERVER ACTIONS (pausa
 * com a aba oculta):
 *   · heartbeat de presença 25s   · contatos/não-lidas 12s   · conversas abertas 4s
 * As janelas abertas persistem no reload (localStorage) até fechar no X.
 * Emite 'flow:chat-unread' (total) p/ o badge da sidebar.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Search, X, Minus, Send, MessagesSquare } from 'lucide-react'
import { sendChatMessage, getConversation, getChatOverview, markChatRead, touchPresence, type ChatMsg } from '@/app/actions/chat'
import { playNotifSound } from '@/lib/notif-sound'

interface Member { id: string; name: string; avatarUrl: string | null }
type Msg = ChatMsg & { pending?: boolean }

export function ChatDock({ orgId, meId, members }: { orgId: string; meId: string; members: Member[] }) {
  const memberById = useMemo(() => Object.fromEntries(members.map(m => [m.id, m])), [members])
  const memberIds = useMemo(() => members.map(m => m.id), [members])
  const STORE = `flow:chat:${orgId}:${meId}`

  const [panelOpen, setPanelOpen] = useState(false)
  const [q, setQ] = useState('')
  const [windows, setWindows] = useState<string[]>([])
  const [minimized, setMinimized] = useState<Set<string>>(new Set())
  const [online, setOnline] = useState<Set<string>>(new Set())
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [msgs, setMsgs] = useState<Record<string, Msg[]>>({})
  const [draft, setDraft] = useState<Record<string, string>>({})

  const windowsRef = useRef(windows)
  const minimizedRef = useRef(minimized)
  useEffect(() => { windowsRef.current = windows }, [windows])
  useEffect(() => { minimizedRef.current = minimized }, [minimized])

  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

  const loadMessages = useCallback(async (peer: string) => {
    const data = await getConversation(orgId, peer)
    setMsgs(prev => ({ ...prev, [peer]: data }))
  }, [orgId])

  const markRead = useCallback(async (peer: string) => {
    await markChatRead(orgId, peer)
    setUnread(prev => { const n = { ...prev }; delete n[peer]; return n })
  }, [orgId])

  // ── Restaura janelas abertas (persistidas) ────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE)
      if (raw) {
        const s = JSON.parse(raw) as { windows?: string[]; minimized?: string[] }
        const w = (s.windows ?? []).filter(id => memberById[id])
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setWindows(w)
        setMinimized(new Set((s.minimized ?? []).filter(id => w.includes(id))))
        for (const id of w) loadMessages(id)
      }
    } catch { /* storage indisponível */ }
  }, [STORE, memberById, loadMessages])

  // Persiste estado das janelas
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ windows, minimized: [...minimized] })) } catch { /* noop */ }
  }, [windows, minimized, STORE])

  // ── Heartbeat de presença ───────────────────────────────────────────────
  useEffect(() => {
    const beat = () => { if (!hidden()) touchPresence() }
    beat()
    const t = setInterval(beat, 25_000)
    return () => clearInterval(t)
  }, [])

  // ── Presença + não-lidas ────────────────────────────────────────────────
  const loadOverview = useCallback(async () => {
    if (hidden()) return
    const { online: on, unread: un } = await getChatOverview(orgId, memberIds)
    setOnline(new Set(on))
    setUnread(un)
  }, [orgId, memberIds])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadOverview()
    const t = setInterval(loadOverview, 12_000)
    return () => clearInterval(t)
  }, [loadOverview])

  // Total de não-lidas → badge da sidebar (+ som quando aumenta = mensagem nova)
  const prevTotal = useRef<number | null>(null)
  useEffect(() => {
    const total = Object.values(unread).reduce((a, b) => a + b, 0)
    if (prevTotal.current !== null && total > prevTotal.current) playNotifSound()
    prevTotal.current = total
    window.dispatchEvent(new CustomEvent('flow:chat-unread', { detail: total }))
  }, [unread])

  // ── Mensagens das conversas abertas (não minimizadas) ─────────────────────
  useEffect(() => {
    const tick = () => {
      if (hidden()) return
      for (const peer of windowsRef.current) {
        if (minimizedRef.current.has(peer)) continue
        loadMessages(peer)
        if (unread[peer]) markRead(peer)
      }
    }
    const t = setInterval(tick, 4_000)
    return () => clearInterval(t)
  }, [loadMessages, markRead, unread])

  // ── Abrir/fechar/minimizar ────────────────────────────────────────────────
  const openConvo = useCallback((peer: string) => {
    setPanelOpen(false)
    setWindows(prev => prev.includes(peer) ? prev : [...prev, peer])
    setMinimized(prev => { const n = new Set(prev); n.delete(peer); return n })
    loadMessages(peer)
    markRead(peer)
  }, [loadMessages, markRead])

  function closeConvo(peer: string) {
    setWindows(prev => prev.filter(p => p !== peer))
    setMinimized(prev => { const n = new Set(prev); n.delete(peer); return n })
  }
  function toggleMin(peer: string) {
    setMinimized(prev => {
      const n = new Set(prev)
      if (n.has(peer)) { n.delete(peer); loadMessages(peer); markRead(peer) } else n.add(peer)
      return n
    })
  }

  // Eventos da sidebar
  useEffect(() => {
    const toggle = () => setPanelOpen(o => !o)
    const open = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (id) openConvo(id) }
    window.addEventListener('flow:chat-toggle', toggle)
    window.addEventListener('flow:chat-open', open as EventListener)
    return () => {
      window.removeEventListener('flow:chat-toggle', toggle)
      window.removeEventListener('flow:chat-open', open as EventListener)
    }
  }, [openConvo])

  // ── Enviar ────────────────────────────────────────────────────────────────
  async function send(peer: string) {
    const text = (draft[peer] ?? '').trim()
    if (!text) return
    setDraft(prev => ({ ...prev, [peer]: '' }))
    const temp: Msg = { id: `tmp-${Date.now()}`, sender_id: meId, recipient_id: peer, content: text, created_at: new Date().toISOString(), read_at: null, pending: true }
    setMsgs(prev => ({ ...prev, [peer]: [...(prev[peer] ?? []), temp] }))
    const r = await sendChatMessage(orgId, peer, text)
    if (r?.error) {
      setMsgs(prev => ({ ...prev, [peer]: (prev[peer] ?? []).filter(m => m.id !== temp.id) }))
      setDraft(prev => ({ ...prev, [peer]: text }))
      toast.error(`Não enviou: ${r.error}`)
      return
    }
    loadMessages(peer)
  }

  if (!members.length) return null

  const term = q.trim().toLowerCase()
  const contacts = members
    .filter(m => !term || m.name.toLowerCase().includes(term))
    .sort((a, b) => {
      const oa = online.has(a.id) ? 0 : 1, ob = online.has(b.id) ? 0 : 1
      return oa - ob || a.name.localeCompare(b.name)
    })
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0)

  // Messenger sempre no canto inferior direito (acima da modal de tarefa, z-60 > z-50).
  return (
    <div className="fixed bottom-0 right-0 z-[60] flex items-end gap-3 p-3 pointer-events-none">
      {/* Janelas de conversa */}
      {windows.map(peer => {
        const m = memberById[peer]
        if (!m) return null
        const isMin = minimized.has(peer)
        return (
          <div key={peer} className={cn('pop-up pointer-events-auto w-[320px] bg-white rounded-t-xl border border-gray-200 shadow-2xl flex flex-col overflow-hidden', !isMin && 'h-[440px] max-h-[80vh]')}>
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 text-white cursor-pointer" onClick={() => toggleMin(peer)}>
              <ChatAvatar member={m} online={online.has(peer)} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{m.name}</p>
                <p className="text-[10px] text-gray-400">{online.has(peer) ? 'Online' : 'Offline'}</p>
              </div>
              <button onClick={e => { e.stopPropagation(); toggleMin(peer) }} aria-label="Minimizar conversa" className="p-1 rounded hover:bg-white/10" title="Minimizar"><Minus className="w-4 h-4" /></button>
              <button onClick={e => { e.stopPropagation(); closeConvo(peer) }} aria-label="Fechar conversa" className="p-1 rounded hover:bg-white/10" title="Fechar"><X className="w-4 h-4" /></button>
            </div>

            {!isMin && (
              <>
                <MessageList msgs={msgs[peer] ?? []} meId={meId} />
                <div className="flex items-center gap-2 p-2 border-t border-gray-100">
                  <input
                    value={draft[peer] ?? ''}
                    onChange={e => setDraft(prev => ({ ...prev, [peer]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(peer) } }}
                    placeholder="Escreva uma mensagem…"
                    className="flex-1 min-w-0 text-sm bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <button onClick={() => send(peer)} disabled={!(draft[peer] ?? '').trim()} aria-label="Enviar mensagem" className="p-2 rounded-full bg-orange-600 text-[#fff] hover:bg-orange-700 disabled:opacity-40 transition shrink-0">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })}

      {/* Painel de contatos OU lançador (bolinha) — o messenger fica sempre no canto */}
      {panelOpen ? (
        <div className="pop-up pointer-events-auto w-[300px] h-[440px] bg-white rounded-t-xl border border-gray-200 shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-900 text-white">
            <MessagesSquare className="w-4 h-4" />
            <span className="text-sm font-semibold flex-1">Mensagens</span>
            <button onClick={() => setPanelOpen(false)} aria-label="Minimizar mensagens" className="p-1 rounded hover:bg-white/10" title="Minimizar"><Minus className="w-4 h-4" /></button>
          </div>
          <div className="p-2 border-b border-gray-100">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded-lg">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar pessoa…" className="flex-1 bg-transparent text-sm focus:outline-none" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {contacts.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">Ninguém encontrado</p>
            ) : contacts.map(m => (
              <button key={m.id} onClick={() => openConvo(m.id)} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 transition text-left">
                <ChatAvatar member={m} online={online.has(m.id)} />
                <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">{m.name}</span>
                {unread[m.id] > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[#fff] text-[10px] font-semibold flex items-center justify-center">{unread[m.id] > 99 ? '99+' : unread[m.id]}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Lançador minimizado — fica sempre no canto direito (clique reabre) */
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          title="Mensagens"
          aria-label={totalUnread > 0 ? `Mensagens (${totalUnread} não lidas)` : 'Mensagens'}
          className="pointer-events-auto relative w-12 h-12 rounded-full bg-orange-600 text-[#fff] shadow-2xl flex items-center justify-center hover:bg-orange-700 transition"
        >
          <MessagesSquare className="w-5 h-5" />
          {totalUnread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[#fff] text-[10px] font-semibold flex items-center justify-center ring-2 ring-white">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </button>
      )}
    </div>
  )
}

// ── Avatar com bolinha de presença ──────────────────────────────────────────
function ChatAvatar({ member, online }: { member: Member; online: boolean }) {
  const initials = (member.name || '?').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()
  return (
    <span className="relative shrink-0">
      {member.avatarUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={member.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
        : <span className="w-7 h-7 rounded-full bg-orange-100 text-orange-700 text-[11px] font-semibold flex items-center justify-center">{initials}</span>}
      <span className={cn('absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white', online ? 'bg-green-500' : 'bg-gray-300')} />
    </span>
  )
}

// ── Lista de mensagens (rola pro fim ao mudar) ──────────────────────────────
function MessageList({ msgs, meId }: { msgs: Msg[]; meId: string }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1.5 bg-gray-50/50">
      {msgs.length === 0 && <p className="text-xs text-gray-400 text-center py-6">Diga olá 👋</p>}
      {msgs.map(m => {
        const mine = m.sender_id === meId
        return (
          <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
            <span className={cn(
              'max-w-[80%] px-3 py-1.5 rounded-2xl text-sm break-words whitespace-pre-wrap',
              mine ? 'bg-orange-600 text-[#fff] rounded-br-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm',
              m.pending && 'opacity-60',
            )}>
              {m.content}
            </span>
          </div>
        )
      })}
      <div ref={endRef} />
    </div>
  )
}
