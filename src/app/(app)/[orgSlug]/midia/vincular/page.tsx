import { assertMidiaAccess } from '@/lib/midia-hub'
import { carregarVinculoEntregas } from '@/app/actions/midia-hub'
import { VincularEntregas } from './VincularEntregas'

export const metadata = { title: 'Mídia — Vincular entregas' }

export default async function VincularPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  await assertMidiaAccess(orgSlug)

  const r = await carregarVinculoEntregas(orgSlug)
  if ('error' in r && r.error) throw new Error(r.error)

  return (
    <VincularEntregas
      orgSlug={orgSlug}
      entregas={r.entregas ?? []}
      tarefas={r.tarefas ?? {}}
    />
  )
}
