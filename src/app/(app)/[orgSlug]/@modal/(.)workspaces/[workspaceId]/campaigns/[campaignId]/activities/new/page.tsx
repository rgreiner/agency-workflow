import { TaskModal } from '@/app/(app)/[orgSlug]/_components/TaskModal'
import NewActivityPage from '@/app/(app)/[orgSlug]/workspaces/[workspaceId]/campaigns/[campaignId]/activities/new/page'

// "Nova atividade" também abre em modal (este intercept estático tem precedência
// sobre o [activityId], então não cai mais no caso de UUID). A página é server
// (carrega os membros pro seletor de responsável), então repassa os params —
// mesmo padrão do intercept do [activityId]. `?from=` (duplicar) vai junto.
export default async function InterceptedNewActivityPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string; workspaceId: string; campaignId: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const content = await NewActivityPage({ params, searchParams, modal: true })
  return <TaskModal fill>{content}</TaskModal>
}
