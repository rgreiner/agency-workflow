import { requireVendas } from '@/lib/auth/operacional'

export default async function VendasLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  await requireVendas(orgSlug)
  return <>{children}</>
}
