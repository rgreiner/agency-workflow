import 'server-only'
import { createCronClient } from '@/lib/supabase/cron'
import { messageOf } from '@/lib/notifications'
import type { NotificationItem } from '@/app/actions/notifications'

/**
 * Envio de web-push (fase 4 do PWA). Duas fontes:
 *   • dispatchPushNotificacoes — despacha o que caiu no sino (triggers do banco
 *     criam as linhas; aqui a gente só empurra pro aparelho). Chamado pelo cron
 *     de 15min E inline (after) nas actions que geram notificação — o claim no
 *     banco é atômico, então os dois podem correr juntos sem duplicar.
 *   • pushLembretePonto — lembrete de entrada com o app fechado (cron).
 *
 * Sem chaves VAPID no ambiente, tudo degrada em silêncio: os jobs reportam
 * "sem chaves" e nenhuma tela quebra. web-push é import dinâmico de propósito
 * (nada de exigir env no import — regra do build no Coolify).
 */

type Payload = { title: string; body: string; url: string; tag?: string }

export function pushConfigurado() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

async function getWebpush() {
  const webpush = (await import('web-push')).default
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:flow@oneaone.com.br',
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  )
  return webpush
}

type SubRow = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }

/** Envia 1 payload por usuário para TODOS os aparelhos dele; limpa endpoint morto. */
async function enviarPorUsuario(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  porUsuario: Map<string, Payload>,
): Promise<{ enviados: number; mortos: number }> {
  const uids = [...porUsuario.keys()]
  if (!uids.length) return { enviados: 0, mortos: 0 }
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', uids)
  const rows: SubRow[] = subs ?? []
  if (!rows.length) return { enviados: 0, mortos: 0 }

  const webpush = await getWebpush()
  let enviados = 0
  const mortos: string[] = []
  await Promise.all(rows.map(async (s) => {
    const payload = porUsuario.get(s.user_id)
    if (!payload) return
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 3600 },
      )
      enviados++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      // 404/410 = inscrição morta (app desinstalado, permissão revogada) → limpa.
      if (code === 404 || code === 410) mortos.push(s.id)
      // Outros erros: melhor perder um push do que derrubar o lote.
    }
  }))
  if (mortos.length) await supabase.from('push_subscriptions').delete().in('id', mortos)
  return { enviados, mortos: mortos.length }
}

type Claim = {
  id: string; user_id: string; org_slug: string | null; type: string
  data: Record<string, unknown> | null; created_at: string
  actor_name: string | null; activity_id: string | null; activity_title: string | null
  campaign_id: string | null; workspace_id: string | null
}

/** Mesmos destinos do clique no sino (InboxClient.navigateTo). */
function urlDe(n: Claim): string {
  const slug = n.org_slug
  if (!slug) return '/'
  if (n.type === 'drive_sync' && n.workspace_id && n.campaign_id)
    return `/${slug}/workspaces/${n.workspace_id}/campaigns/${n.campaign_id}?drive=sync`
  if (n.type === 'portal_solicitacao') return `/${slug}/solicitacoes`
  if (n.workspace_id && n.campaign_id && n.activity_id)
    return `/${slug}/workspaces/${n.workspace_id}/campaigns/${n.campaign_id}/activities/${n.activity_id}`
  return `/${slug}/inbox`
}

export async function dispatchPushNotificacoes(): Promise<string> {
  if (!pushConfigurado()) return 'sem chaves VAPID (defina VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)'
  const supabase = await createCronClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('push_claim_pending')
  if (error) throw new Error(error.message)
  const rows: Claim[] = data ?? []
  if (!rows.length) return '0 pendentes'

  const byUser = new Map<string, Claim[]>()
  rows.forEach((r) => { byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]) })

  const porUsuario = new Map<string, Payload>()
  for (const [uid, list] of byUser) {
    if (list.length === 1) {
      const n = list[0]
      // messageOf com os labels padrão de status: pro push (resumo) serve; o
      // label configurado da org aparece ao abrir o app.
      const item: NotificationItem = {
        id: n.id, type: n.type, data: n.data ?? {}, readAt: null, createdAt: n.created_at,
        actorName: n.actor_name, title: n.activity_title ?? '',
        activityId: n.activity_id, campaignId: n.campaign_id, workspaceId: n.workspace_id,
      }
      porUsuario.set(uid, {
        title: n.activity_title ?? 'Flow', body: messageOf(item), url: urlDe(n), tag: `notif-${n.id}`,
      })
    } else {
      // Várias de uma vez viram UM push-resumo (nada de rajada no bolso).
      const slug = list[0].org_slug
      porUsuario.set(uid, {
        title: 'Flow', body: `${list.length} novas notificações`,
        url: slug ? `/${slug}/inbox` : '/', tag: 'notif-lote',
      })
    }
  }

  const r = await enviarPorUsuario(supabase, porUsuario)
  return `${rows.length} notificação(ões) → ${r.enviados} push(es), ${r.mortos} inscrição(ões) morta(s)`
}

export async function pushLembretePonto(): Promise<string> {
  if (!pushConfigurado()) return 'sem chaves VAPID (defina VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)'
  const supabase = await createCronClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('rh_push_lembrete_entrada')
  if (error) throw new Error(error.message)
  const rows: { user_id: string; entrada: string; org_slug: string }[] = data ?? []
  if (!rows.length) return '0 lembretes'

  const porUsuario = new Map<string, Payload>(rows.map((r) => [r.user_id, {
    title: 'Hora de bater o ponto',
    body: `Sua entrada é ${r.entrada} e o dia ainda está sem marcação. Toque para registrar.`,
    url: `/${r.org_slug}/ponto`,
    tag: 'ponto-lembrete',
  }]))
  const r = await enviarPorUsuario(supabase, porUsuario)
  return `${rows.length} lembrete(s) → ${r.enviados} push(es)`
}
