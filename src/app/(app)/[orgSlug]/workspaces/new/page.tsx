import { getAccess } from '@/lib/auth/access'
import { redirect } from 'next/navigation'
import { NovoClienteForm } from './NovoClienteForm'

export default async function NewWorkspacePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const r = await getAccess(orgSlug)
  if (!r) redirect('/')

  // A opção "já ativar a mídia" só aparece para quem opera o Hub — para os
  // demais, um checkbox que a RPC recusaria seria só uma promessa quebrada.
  return <NovoClienteForm orgSlug={orgSlug} podeMidia={r.access.midiaHub} />
}
