import { redirect } from 'next/navigation'
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { listPreviewFiles } from '@/lib/task-folders'
import { PortalShell } from '../../PortalShell'
import { AprovacaoClient, type Peca } from './AprovacaoClient'

export const dynamic = 'force-dynamic'

/** Ambiente de aprovação: peças da pasta Preview + comentários + aceite. */
export default async function PortalAprovacaoPage({
  params,
}: {
  params: Promise<{ activityId: string }>
}) {
  if (!(await sessaoPortal())) redirect('/portal')
  const { activityId } = await params

  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('portal_aprovacao', { p_activity_id: activityId })
  if (error || !data) redirect('/portal/painel')

  const t = data as {
    id: string; titulo: string; campanha: string; pasta_ref: string | null
    decisao: { kind: string } | null
  }

  // A pasta pode não estar vinculada ainda, ou o storage estar indisponível —
  // a tela abre mesmo assim, avisando que as peças não vieram.
  let pecas: Peca[] = []
  if (t.pasta_ref) {
    try {
      pecas = await listPreviewFiles(t.pasta_ref)
    } catch {
      pecas = []
    }
  }

  return (
    <PortalShell wide>
      <AprovacaoClient
        activityId={t.id}
        titulo={t.titulo}
        campanha={t.campanha}
        pecas={pecas}
        decidido={t.decisao?.kind ?? null}
      />
    </PortalShell>
  )
}
