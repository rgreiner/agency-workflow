import { requireOperacional } from '@/lib/auth/operacional'

export default async function OperacionalLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  await requireOperacional(orgSlug)
  return <>{children}</>
}
