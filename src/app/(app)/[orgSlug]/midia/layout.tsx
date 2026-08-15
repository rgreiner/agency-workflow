import { assertMidiaAccess } from '@/lib/midia-hub'

/** Gate por URL do Hub de Mídia (toggle `op_midia_hub` do cargo). */
export default async function MidiaHubLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  await assertMidiaAccess(orgSlug)
  return <>{children}</>
}
