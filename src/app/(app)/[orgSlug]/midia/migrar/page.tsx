import { assertMidiaAccess } from '@/lib/midia-hub'
import { origensDeMigracao } from '@/app/actions/midia-hub'
import { MigrarRotinas } from './MigrarRotinas'

export const metadata = { title: 'Mídia — Migrar rotinas' }

export default async function MigrarPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  await assertMidiaAccess(orgSlug)

  const r = await origensDeMigracao(orgSlug)
  if ('error' in r && r.error) throw new Error(r.error)

  // O balde é, na prática, quem concentra rotina de mídia: abre nele.
  return <MigrarRotinas orgSlug={orgSlug} origens={r.origens ?? []} />
}
