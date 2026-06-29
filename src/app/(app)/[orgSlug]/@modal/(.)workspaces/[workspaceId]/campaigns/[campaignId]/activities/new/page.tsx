import { TaskModal } from '@/app/(app)/[orgSlug]/_components/TaskModal'
import NewActivityPage from '@/app/(app)/[orgSlug]/workspaces/[workspaceId]/campaigns/[campaignId]/activities/new/page'

// "Nova atividade" também abre em modal (este intercept estático tem precedência
// sobre o [activityId], então não cai mais no caso de UUID). O form lê os params
// pela URL (useParams) e, ao salvar, redireciona para a tarefa criada.
export default function InterceptedNewActivityPage() {
  return (
    <TaskModal>
      <NewActivityPage />
    </TaskModal>
  )
}
