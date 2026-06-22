import { notFound } from 'next/navigation'
import { EmBreve } from '@/components/ui/EmBreve'

const TITLES: Record<string, string> = {
  orcamento: 'Liberação de Produção — Orçamento',
  pedido: 'Liberação de Produção — Pedido de produção',
  fee: 'Liberação de Produção — FEE',
}

export default async function ProducaoPlaceholderPage({
  params,
}: {
  params: Promise<{ tipo: string }>
}) {
  const { tipo } = await params
  const title = TITLES[tipo]
  if (!title) notFound()
  return <EmBreve title={title} />
}
