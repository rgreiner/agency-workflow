import { notFound } from 'next/navigation'
import { createMidia } from '@/app/actions/midia'
import { loadMidiaSelectors } from '@/lib/midia-selectors'
import { ImpressaForm } from '../../ImpressaForm'
import { JornalForm } from '../../JornalForm'

export default async function NovaImpressaPage({
  params,
}: {
  params: Promise<{ orgSlug: string; tipo: string }>
}) {
  const { orgSlug, tipo } = await params
  if (tipo !== 'jornal' && tipo !== 'revista') notFound()

  const { clientes, veiculos, members, userId, today } = await loadMidiaSelectors(orgSlug)
  const common = {
    clientes, veiculos, members,
    defaultResponsavelId: userId, today,
    redirectTo: `/${orgSlug}/midias/impressa`,
    submitLabel: 'Gravar',
    onSubmit: createMidia.bind(null, orgSlug),
  }

  return tipo === 'jornal' ? <JornalForm {...common} /> : <ImpressaForm {...common} />
}
