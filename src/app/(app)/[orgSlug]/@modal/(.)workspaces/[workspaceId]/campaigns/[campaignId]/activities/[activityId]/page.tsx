import { TaskModal } from '@/app/(app)/[orgSlug]/_components/TaskModal'
import ActivityPage from '@/app/(app)/[orgSlug]/workspaces/[workspaceId]/campaigns/[campaignId]/activities/[activityId]/page'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const { activityId } = await params
  // Só intercepta IDs reais (UUID). "new" (Nova atividade) e afins seguem para
  // a página inteira — sem modal.
  if (!UUID_RE.test(activityId)) return null

  const content = await ActivityPage({ params, searchParams, modal: true })
  return <TaskModal>{content}</TaskModal>
}
