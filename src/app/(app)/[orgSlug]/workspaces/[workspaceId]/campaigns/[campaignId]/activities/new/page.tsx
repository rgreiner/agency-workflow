import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { membrosAtivos } from '@/lib/membros'
import { porNome } from '@/lib/utils'
import { decomporTitulo } from '@/lib/atividade-titulo'
import { NewActivityForm, type MembroSelecionavel, type NovaAtividadeInicial } from './NewActivityForm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * "Nova atividade" — a página é server pra carregar a lista de membros: o form
 * exige escolher o responsável na criação (tarefa não nasce sem dono, e não é
 * mais o criador por padrão). O form em si fica em NewActivityForm (client).
 *
 * `?from=<id>` = duplicar: herda veículo/formato/título, briefing, prioridade,
 * complexidade, horas e responsáveis da tarefa de origem; data e período são de
 * hoje. A leitura passa pela RLS — quem não enxerga a origem cria em branco.
 */
export default async function NewActivityPage({ params, searchParams, modal = false }: {
  params: Promise<{ orgSlug: string; workspaceId: string; campaignId: string }>
  searchParams?: Promise<{ from?: string }>
  /** Renderizada dentro do TaskModal (intercept): layout ocupa a altura do card. */
  modal?: boolean
}) {
  const { workspaceId } = await params
  const { from } = (await searchParams) ?? {}
  const supabase = await createClient()
  const user = await getUsuario()

  const { data: ws } = await supabase
    .from('workspaces').select('org_id').eq('id', workspaceId).single()

  type Raw = { user_id: string; profiles: unknown }
  const { data: membersRaw } = ws
    ? await membrosAtivos<Raw>(supabase, ws.org_id, 'user_id, profiles!user_id(full_name, email, avatar_url)')
    : { data: [] as Raw[] }

  const members: MembroSelecionavel[] = (membersRaw ?? []).map(m => {
    const p = m.profiles as { full_name: string | null; email: string; avatar_url: string | null } | null
    return {
      userId: m.user_id,
      fullName: p?.full_name ?? null,
      email: p?.email ?? '',
      avatarUrl: p?.avatar_url ?? null,
    }
  }).filter(m => m.email || m.fullName).sort(porNome(m => m.fullName ?? m.email))

  let inicial: NovaAtividadeInicial | null = null
  if (from && UUID_RE.test(from)) {
    const [{ data: origem }, { data: resp }] = await Promise.all([
      supabase.from('activities')
        .select('title, description, priority, complexity, estimated_hours')
        .eq('id', from).maybeSingle(),
      supabase.from('activity_assignees').select('user_id').eq('activity_id', from),
    ])
    if (origem) {
      inicial = {
        fromTitle: origem.title,
        ...decomporTitulo(origem.title),
        description: origem.description,
        priority: origem.priority,
        complexity: origem.complexity,
        estimated_hours: origem.estimated_hours,
        assigneeIds: (resp ?? []).map(r => r.user_id),
      }
    }
  }

  return <NewActivityForm members={members} currentUserId={user?.id ?? null} inicial={inicial} modal={modal} />
}
