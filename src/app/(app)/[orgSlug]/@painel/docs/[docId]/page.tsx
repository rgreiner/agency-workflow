import { PainelDocs } from '../PainelDocs'

export default async function PainelDocAberto({ params }: { params: Promise<{ orgSlug: string; docId: string }> }) {
  const { orgSlug, docId } = await params
  return <PainelDocs orgSlug={orgSlug} docId={docId} />
}
