import { getNotifications } from '@/app/actions/notifications'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { getMergedStatusConfig, type StatusOverride } from '@/types'
import { InboxClient } from './InboxClient'
import { MyTasksPanel, type MyTask } from './MyTasksPanel'
import { TodoPanel, type Todo } from './TodoPanel'

export default async function InboxPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { items } = await getNotifications(orgSlug, 60)

  const supabase = await createClient()
  const user = await getUsuario()

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()

  // Cores de status seguem Configurações → Aparência (mescladas)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawSettings } = await (supabase as any)
    .from('org_settings').select('status_overrides').eq('org_id', org?.id ?? '').single()
  const statusConfig = getMergedStatusConfig((rawSettings?.status_overrides ?? []) as StatusOverride[])

  // To-do pessoal (anotações livres) deste usuário nesta org
  let todos: Todo[] = []
  if (user && org) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: td } = await (supabase as any)
      .from('todos')
      .select('id, texto, done, due_date')
      .eq('user_id', user.id).eq('org_id', org.id)
      .order('done', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
    todos = (td ?? []) as Todo[]
  }

  // Minhas tarefas = activities onde sou responsável (activity_assignees), não arquivadas
  let tasks: MyTask[] = []
  if (user) {
    const { data: assigned } = await supabase
      .from('activity_assignees').select('activity_id').eq('user_id', user.id)
    const ids = Array.from(new Set((assigned ?? []).map(a => a.activity_id)))
    if (ids.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: acts } = await (supabase as any)
        .from('activities')
        .select('id, title, status, due_date, campaign_id, campaigns(name, workspace_id)')
        .in('id', ids).eq('archived', false)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tasks = (acts ?? []).map((a: any) => {
        const camp = Array.isArray(a.campaigns) ? a.campaigns[0] : a.campaigns
        const cfg = statusConfig.find(s => s.value === a.status)
        return {
          id: a.id,
          title: a.title,
          status: a.status,
          statusLabel: cfg?.label ?? a.status,
          // Cor de PREENCHIMENTO da pílula do status (bg) — é a cor "real" do
          // status. Usar text deixava a bolinha branca quando o text da org = #fff.
          statusColor: cfg?.bg ?? '#9ca3af',
          dueDate: a.due_date ?? null,
          href: camp?.workspace_id
            ? `/${orgSlug}/workspaces/${camp.workspace_id}/campaigns/${a.campaign_id}/activities/${a.id}`
            : `/${orgSlug}/views/lista`,
        } as MyTask
      })
    }
  }

  return (
    <div className="flex flex-col lg:flex-row lg:h-full lg:overflow-hidden">
      <div className="flex-1 min-w-0 lg:overflow-y-auto">
        <InboxClient orgSlug={orgSlug} initial={items} />
      </div>
      <aside className="w-full lg:w-[340px] shrink-0 border-t lg:border-t-0 lg:border-l border-gray-200 bg-gray-50/40 lg:overflow-y-auto">
        <MyTasksPanel tasks={tasks} />
        <TodoPanel orgSlug={orgSlug} todos={todos} />
      </aside>
    </div>
  )
}
