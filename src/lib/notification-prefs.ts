/**
 * Preferências de notificação por usuário (evento × canal) — migration 254.
 *
 * Modelo: PUSH ⊂ CAIXA DE ENTRADA. O filtro de verdade mora no banco (trigger
 * BEFORE INSERT em notifications): inbox desligada = a linha nem nasce; push
 * desligado = nasce já carimbada com push_sent_at. Aqui ficam só o tipo, a
 * ordem/rótulos da grade do Perfil e o helper de leitura (ausente = ligado).
 *
 * Menção é travada na caixa por decisão de produto: quem menciona espera
 * resposta. Por isso 'mention' só existe no canal push (o RPC whitelista).
 */

export interface CanalPrefs {
  /** null/ausente = todos os status; array = só esses (values do org_status). */
  status?: string[] | null
  new_comment?: boolean
  /** Só faz sentido no canal push — a caixa de entrada de menção é fixa. */
  mention?: boolean
  assigned?: boolean
  due_soon?: boolean
  portal?: boolean
  drive_sync?: boolean
}

export interface NotifPrefs {
  inbox?: CanalPrefs
  push?: CanalPrefs
}

export type EventKey = 'status' | 'new_comment' | 'mention' | 'assigned' | 'due_soon' | 'portal' | 'drive_sync'

export const EVENT_ROWS: {
  key: EventKey
  label: string
  desc: string
  /** Menção: célula da caixa fixa em "sempre". */
  inboxLocked?: boolean
  /** Mudança de status: cada canal ligado ganha um MultiSelect de status. */
  hasStatusPicker?: boolean
}[] = [
  { key: 'status',      label: 'Mudança de status',        desc: 'Tarefas suas mudam de etapa', hasStatusPicker: true },
  { key: 'new_comment', label: 'Comentários',              desc: 'Nas tarefas em que você participa' },
  { key: 'mention',     label: 'Menções @você',            desc: 'Sempre caem na caixa de entrada', inboxLocked: true },
  { key: 'assigned',    label: 'Tarefa atribuída a você',  desc: 'Quando alguém te coloca como responsável' },
  { key: 'due_soon',    label: 'Prazo — vence amanhã',     desc: 'Lembrete na véspera da entrega' },
  { key: 'portal',      label: 'Portal do cliente',        desc: 'Aprovações, ajustes, respostas e solicitações' },
  { key: 'drive_sync',  label: 'Drive — pasta vinculada',  desc: 'Resultado da sincronização de pastas' },
]

/** Switch ligado? Chave ausente = ligado (default do sistema). Para 'status',
 *  ligado = null (todos) ou array não-vazio; a UI nunca grava array vazio. */
export function isOn(prefs: NotifPrefs, canal: 'inbox' | 'push', key: EventKey): boolean {
  const c = prefs[canal]
  if (!c) return true
  if (key === 'status') return c.status === undefined || c.status === null || c.status.length > 0
  const v = c[key]
  return v !== false
}

/** Lista de status do canal pro MultiSelect ([] = todos, na UX do filtro). */
export function statusValues(prefs: NotifPrefs, canal: 'inbox' | 'push'): string[] {
  const s = prefs[canal]?.status
  return Array.isArray(s) ? s : []
}
