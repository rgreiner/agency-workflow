import { MidiaPrint } from '../../../MidiaPrint'

export default async function Page({ params }: { params: Promise<{ orgSlug: string; midiaId: string }> }) {
  const { orgSlug, midiaId } = await params
  return <MidiaPrint orgSlug={orgSlug} midiaId={midiaId} />
}
