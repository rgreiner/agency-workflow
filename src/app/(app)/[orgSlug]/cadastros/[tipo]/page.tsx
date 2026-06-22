import { notFound } from 'next/navigation'
import { EmBreve } from '@/components/ui/EmBreve'

const TITLES: Record<string, string> = {
  veiculos: 'Cadastros — Veículos',
  fornecedores: 'Cadastros — Fornecedores',
}

export default async function CadastroPlaceholderPage({
  params,
}: {
  params: Promise<{ tipo: string }>
}) {
  const { tipo } = await params
  const title = TITLES[tipo]
  if (!title) notFound()
  return <EmBreve title={title} />
}
