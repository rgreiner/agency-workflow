'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

export interface ChatMsg {
  id: string
  sender_id: string
  recipient_id: string
  content: string
  created_at: string
  read_at: string | null
}

const ONLINE_MS = 70_000

/** Envia uma mensagem 1:1. */
export async function sendChatMessage(orgId: string, recipientId: string, content: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('send_chat_message', {
    p_user_id: user.id, p_recipient_id: recipientId, p_org_id: orgId, p_content: content,
  })
  if (error) return { error: error.message }
  return { id: data as string }
}

/** Mensagens da conversa entre o usuário atual e `otherId`. */
export async function getConversation(orgId: string, otherId: string): Promise<ChatMsg[]> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('get_chat_conversation', {
    p_user_id: user.id, p_other_id: otherId, p_org_id: orgId,
  })
  return (data ?? []) as ChatMsg[]
}

/** Presença (online) dos membros + não-lidas por remetente. */
export async function getChatOverview(orgId: string, memberIds: string[]): Promise<{ online: string[]; unread: Record<string, number> }> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { online: [], unread: {} }

  let online: string[] = []
  if (memberIds.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pres } = await (supabase as any)
      .from('user_presence').select('user_id, last_seen_at').in('user_id', memberIds)
    const now = Date.now()
    online = (pres ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((p: any) => now - new Date(p.last_seen_at).getTime() < ONLINE_MS)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => p.user_id as string)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: un } = await (supabase as any).rpc('get_unread_counts', { p_user_id: user.id, p_org_id: orgId })
  const unread: Record<string, number> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (un ?? []) as any[]) unread[r.other_id] = r.n
  return { online, unread }
}

/** Marca como lidas as mensagens recebidas de `otherId`. */
export async function markChatRead(orgId: string, otherId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).rpc('mark_chat_read', { p_user_id: user.id, p_other_id: otherId, p_org_id: orgId })
}

/** Heartbeat de presença (marca o usuário como visto agora). */
export async function touchPresence() {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).rpc('touch_presence', { p_user_id: user.id })
}
