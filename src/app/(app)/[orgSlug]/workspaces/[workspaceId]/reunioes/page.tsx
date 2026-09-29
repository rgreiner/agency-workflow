import { redirect } from 'next/navigation'

/** A lista mora em /reunioes (sidebar); aqui é o atalho já filtrado pelo cliente. */
export default async function ReunioesDoClientePage({ params }: {
  params: Promise<{ orgSlug: string; workspaceId: string }>
}) {
  const { orgSlug, workspaceId } = await params
  redirect(`/${orgSlug}/reunioes?ws=${workspaceId}`)
}
