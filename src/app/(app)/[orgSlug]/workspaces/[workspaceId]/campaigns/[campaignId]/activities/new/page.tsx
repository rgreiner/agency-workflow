import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { membrosAtivos } from '@/lib/membros'
import { porNome } from '@/lib/utils'
import { NewActivityForm, type MembroSelecionavel } from './NewActivityForm'

/**
 * "Nova atividade" — a página é server pra carregar a lista de membros: o form
 * exige escolher o responsável na criação (tarefa não nasce sem dono, e não é
 * mais o criador por padrão). O form em si fica em NewActivityForm (client).
 */
export default async function NewActivityPage({ params }: {
  params: Promise<{ orgSlug: string; workspaceId: string; campaignId: string }>
}) {
  const { workspaceId } = await params
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

  return <NewActivityForm members={members} currentUserId={user?.id ?? null} />
}
