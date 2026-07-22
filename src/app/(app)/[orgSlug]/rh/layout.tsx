import { assertRhAccess } from '@/lib/rh'

/** Gate por URL: RH só para owner/admin ou can_rh (não só escondido na sidebar). */
export default async function RhLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  await assertRhAccess(orgSlug)
  return <>{children}</>
}
