'use server'

/**
 * Batimento único da aba (Onda 2 da auditoria de 31/10/2026).
 *
 * Antes, cada aba aberta mantinha QUATRO timers independentes — contatos do chat
 * a 12 s, presença a 25 s, inbox a 30 s, trava do ponto a 60 s — cerca de 13
 * pedidos por minuto com ninguém clicando, e `user_presence` sofria 21 mil
 * updates em 8 dias para 16 linhas. Agora o `Heartbeat` (components/layout)
 * chama isto uma vez a cada 30 s e cada componente só OUVE o resultado.
 *
 * O que entra em cada batida é decidido pelo cliente (`q`): presença e trava
 * do ponto a cada 2 batidas (60 s), estado completo do ponto a cada 10 (5 min)
 * ou na hora, quando alguém bate o ponto.
 */
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { pontoGate, pontoEstado } from '@/app/actions/rh-ponto'

/** Presença: visto há menos que isto = online. A escrita agora é a cada 60 s. */
const ONLINE_MS = 150_000

export type PontoGateDTO = Awaited<ReturnType<typeof pontoGate>>
export type PontoEstadoDTO = NonNullable<Awaited<ReturnType<typeof pontoEstado>>>

export interface PedidoBatimento {
  /** Registrar presença nesta batida (grava em user_presence). */
  presenca: boolean
  /** Houve mouse/teclado há pouco — só assim o dia entra em user_presence_dia (mig. 281). */
  interagiu: boolean
  /** Incluir a trava do ponto (rh_ponto_gate). */
  gate: boolean
  /** Incluir o estado completo do ponto (rh_ponto_estado), para o lembrete. */
  estado: boolean
}

export interface Batimento {
  /** Notificações não lidas da pessoa nesta org. */
  inbox: number
  /** Membros vistos há pouco. */
  online: string[]
  /** Mensagens de chat não lidas, por remetente. */
  chatUnread: Record<string, number>
  /** Só quando pedido (`q.gate`). */
  gate?: PontoGateDTO
  /** Só quando pedido (`q.estado`). null = sem ficha vinculada. */
  estado?: PontoEstadoDTO | null
}

export async function batimento(orgId: string, memberIds: string[], q: PedidoBatimento): Promise<Batimento | null> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [inboxRes, presRes, unRes, gate, estado] = await Promise.all([
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('read_at', null),
    memberIds.length
      ? sb.from('user_presence').select('user_id, last_seen_at').in('user_id', memberIds)
      : Promise.resolve({ data: [] as { user_id: string; last_seen_at: string }[] }),
    sb.rpc('get_unread_counts', { p_user_id: user.id, p_org_id: orgId }),
    q.gate ? pontoGate() : Promise.resolve(undefined),
    q.estado ? pontoEstado() : Promise.resolve(undefined),
    // Presença não segura a resposta nem derruba a batida se falhar.
    q.presenca
      ? sb.rpc('touch_presence', { p_user_id: user.id, p_interagiu: q.interagiu }).then(() => null, () => null)
      : Promise.resolve(null),
  ])

  const now = Date.now()
  const online = ((presRes.data ?? []) as { user_id: string; last_seen_at: string }[])
    .filter(p => now - new Date(p.last_seen_at).getTime() < ONLINE_MS)
    .map(p => p.user_id)
  const chatUnread: Record<string, number> = {}
  for (const r of (unRes.data ?? []) as { other_id: string; n: number }[]) chatUnread[r.other_id] = r.n

  return {
    inbox: inboxRes.count ?? 0,
    online,
    chatUnread,
    ...(q.gate ? { gate } : {}),
    ...(q.estado ? { estado: estado ?? null } : {}),
  }
}
