import { TaskModal } from '@/app/(app)/[orgSlug]/_components/TaskModal'
import ActivityPage from '@/app/(app)/[orgSlug]/workspaces/[workspaceId]/campaigns/[campaignId]/activities/[activityId]/page'

// Rota interceptadora: ao abrir uma tarefa por navegação no app, mostra o
// detalhe dentro de uma modal (mesma URL). Refresh/link direto cai na página
// inteira (o slot @modal renderiza default.tsx). Reusa a própria ActivityPage.
export default async function InterceptedActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; workspaceId: string; campaignId: string; activityId: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const content = await ActivityPage({ params, searchParams, modal: true })
  return <TaskModal>{content}</TaskModal>
}
