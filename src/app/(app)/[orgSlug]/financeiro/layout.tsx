import { requireFinanceiro } from '@/lib/auth/operacional'

export default async function FinanceiroLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  await requireFinanceiro(orgSlug)
  return <>{children}</>
}
