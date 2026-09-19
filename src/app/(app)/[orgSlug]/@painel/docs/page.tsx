import { PainelDocs } from './PainelDocs'

export default async function PainelDocsIndex({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  return <PainelDocs orgSlug={orgSlug} docId="" />
}
