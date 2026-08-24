import { TaskModal } from '@/app/(app)/[orgSlug]/_components/TaskModal'
import NewActivityPage from '@/app/(app)/[orgSlug]/workspaces/[workspaceId]/campaigns/[campaignId]/activities/new/page'

// "Nova atividade" também abre em modal (este intercept estático tem precedência
// sobre o [activityId], então não cai mais no caso de UUID). A página é server
// (carrega os membros pro seletor de responsável), então repassa os params —
// mesmo padrão do intercept do [activityId].
export default async function InterceptedNewActivityPage({ params }: {
  params: Promise<{ orgSlug: string; workspaceId: string; campaignId: string }>
}) {
  const content = await NewActivityPage({ params })
  return <TaskModal>{content}</TaskModal>
}
