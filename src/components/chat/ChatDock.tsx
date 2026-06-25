'use client'

/**
 * Messenger interno (chat 1:1). Dock global no canto inferior direito: janelas de
 * conversa (abrir/minimizar/fechar) + painel de contatos (aberto pela sidebar via
 * evento 'flow:chat-toggle'). Sem Realtime — usa polling (pausa com a aba oculta):
 *   · heartbeat de presença a cada 25s   · contatos/não-lidas a cada 12s
 *   · mensagens das conversas abertas a cada 4s
 * Emite 'flow:chat-unread' (total) p/ o badge da sidebar.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Search, X, Minus, Send, MessagesSquare } from 'lucide-react'

interface Member { id: string; name: string; avatarUrl: string | null }
interface Msg { id: string; sender_id: string; recipient_id: string; content: string; created_at: string; read_at: string | null; pending?: boolean }

const ONLINE_MS = 70_000

export function ChatDock({ orgId, meId, members }: { orgId: string; meId: string; members: Member[] }) {
  const [supabase] = useState(() => createClient())
  const memberById = useMemo(() => Object.fromEntries(members.map(m => [m.id, m])), [members])

  const [panelOpen, setPanelOpen] = useState(false)
  const [q, setQ] = useState('')
  const [windows, setWindows] = useState<string[]>([])      // peers com janela aberta
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

  // ── Heartbeat de presença ───────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const beat = () => { if (!hidden()) (supabase as any).rpc('touch_presence').then(() => {}, () => {}) }
    beat()
    const t = setInterval(beat, 25_000)
    return () => clearInterval(t)
  }, [supabase])

  // ── Presença + não-lidas ────────────────────────────────────────────────
  const loadOverview = useCallback(async () => {
    if (hidden()) return
    const ids = members.map(m => m.id)
    if (ids.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pres } = await (supabase as any).from('user_presence').select('user_id, last_seen_at').in('user_id', ids)
      const now = Date.now()
      const set = new Set<string>()
      for (const p of pres ?? []) if (now - new Date(p.last_seen_at).getTime() < ONLINE_MS) set.add(p.user_id)
      setOnline(set)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: un } = await (supabase as any)
      .from('chat_messages').select('sender_id').eq('recipient_id', meId).eq('org_id', orgId).is('read_at', null)
    const tally: Record<string, number> = {}
    for (const r of un ?? []) tally[r.sender_id] = (tally[r.sender_id] ?? 0) + 1
    setUnread(tally)
  }, [supabase, members, meId, orgId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadOverview()
    const t = setInterval(loadOverview, 12_000)
    return () => clearInterval(t)
  }, [loadOverview])

  // Total de não-lidas → badge da sidebar
  useEffect(() => {
    const total = Object.values(unread).reduce((a, b) => a + b, 0)
    window.dispatchEvent(new CustomEvent('flow:chat-unread', { detail: total }))
  }, [unread])

  // ── Mensagens das conversas abertas (não minimizadas) ─────────────────────
  const loadMessages = useCallback(async (peer: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('chat_messages').select('*').eq('org_id', orgId)
      .or(`and(sender_id.eq.${meId},recipient_id.eq.${peer}),and(sender_id.eq.${peer},recipient_id.eq.${meId})`)
      .order('created_at', { ascending: true }).limit(200)
    setMsgs(prev => ({ ...prev, [peer]: (data ?? []) as Msg[] }))
  }, [supabase, orgId, meId])

  const markRead = useCallback(async (peer: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc('mark_chat_read', { p_other_id: peer, p_org_id: orgId })
    setUnread(prev => { const n = { ...prev }; delete n[peer]; return n })
  }, [supabase, orgId])

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc('send_chat_message', { p_recipient_id: peer, p_org_id: orgId, p_content: text })
    if (error) {
      setMsgs(prev => ({ ...prev, [peer]: (prev[peer] ?? []).filter(m => m.id !== temp.id) }))
      setDraft(prev => ({ ...prev, [peer]: text }))
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

  return (
    <div className="fixed bottom-0 right-0 z-[60] flex items-end gap-3 p-3 pointer-events-none">
      {/* Janelas de conversa */}
      {windows.map(peer => {
        const m = memberById[peer]
        if (!m) return null
        const isMin = minimized.has(peer)
        return (
          <div key={peer} className="pointer-events-auto w-[320px] bg-white rounded-t-xl border border-gray-200 shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 text-white cursor-pointer" onClick={() => toggleMin(peer)}>
              <ChatAvatar member={m} online={online.has(peer)} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{m.name}</p>
                <p className="text-[10px] text-gray-400">{online.has(peer) ? 'Online' : 'Offline'}</p>
              </div>
              <button onClick={e => { e.stopPropagation(); toggleMin(peer) }} className="p-1 rounded hover:bg-white/10" title="Minimizar"><Minus className="w-4 h-4" /></button>
              <button onClick={e => { e.stopPropagation(); closeConvo(peer) }} className="p-1 rounded hover:bg-white/10" title="Fechar"><X className="w-4 h-4" /></button>
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
                    className="flex-1 min-w-0 text-sm bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button onClick={() => send(peer)} disabled={!(draft[peer] ?? '').trim()} className="p-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition shrink-0">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })}

      {/* Painel de contatos */}
      {panelOpen && (
        <div className="pointer-events-auto w-[300px] h-[440px] bg-white rounded-t-xl border border-gray-200 shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-900 text-white">
            <MessagesSquare className="w-4 h-4" />
            <span className="text-sm font-semibold flex-1">Mensagens</span>
            <button onClick={() => setPanelOpen(false)} className="p-1 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
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
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">{unread[m.id] > 99 ? '99+' : unread[m.id]}</span>
                )}
              </button>
            ))}
          </div>
        </div>
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
        : <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-[11px] font-semibold flex items-center justify-center">{initials}</span>}
      <span className={cn('absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white', online ? 'bg-green-500' : 'bg-gray-300')} />
    </span>
  )
}

// ── Lista de mensagens (rola pro fim ao mudar) ──────────────────────────────
function MessageList({ msgs, meId }: { msgs: Msg[]; meId: string }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])
  return (
    <div className="flex-1 h-[300px] overflow-y-auto px-3 py-2 space-y-1.5 bg-gray-50/50">
      {msgs.length === 0 && <p className="text-xs text-gray-400 text-center py-6">Diga olá 👋</p>}
      {msgs.map(m => {
        const mine = m.sender_id === meId
        return (
          <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
            <span className={cn(
              'max-w-[80%] px-3 py-1.5 rounded-2xl text-sm break-words whitespace-pre-wrap',
              mine ? 'bg-indigo-600 text-[#fff] rounded-br-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm',
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
