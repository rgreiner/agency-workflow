import { requireMidias } from '@/lib/auth/operacional'

export default async function VendasLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  await requireMidias(orgSlug)
  return <>{children}</>
}
