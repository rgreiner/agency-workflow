import { notFound } from 'next/navigation'
import { EmBreve } from '@/components/ui/EmBreve'

const TITLES: Record<string, string> = {
  simplificada: 'Liberação de mídias — Simplificada',
  impressa: 'Liberação de mídias — Impressa',
  eletronica: 'Liberação de mídias — Eletrônica',
  externas: 'Liberação de mídias — Externas',
  digitais: 'Liberação de mídias — Digitais',
}

export default async function MidiaPlaceholderPage({
  params,
}: {
  params: Promise<{ tipo: string }>
}) {
  const { tipo } = await params
  const title = TITLES[tipo]
  if (!title) notFound()
  return <EmBreve title={title} />
}
