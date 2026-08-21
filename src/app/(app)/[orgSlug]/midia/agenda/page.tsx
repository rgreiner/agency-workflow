import { assertMidiaAccess } from '@/lib/midia-hub'
import { carregarCicloMidia } from '@/app/actions/midia-hub'
import { AgendaMidia } from './AgendaMidia'

export const metadata = { title: 'Mídia — Agenda do mês' }

/** Primeiro e último dia do mês 'YYYY-MM' (sem fuso: string pura). */
function limitesDoMes(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const ini = `${ym}-01`
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { ini, fim: `${ym}-${String(ultimo).padStart(2, '0')}`, ultimo }
}

export default async function AgendaPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ m?: string }>
}) {
  const { orgSlug } = await params
  const { m } = await searchParams
  await assertMidiaAccess(orgSlug)

  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  const ym = /^\d{4}-\d{2}$/.test(m ?? '') ? m! : hoje.slice(0, 7)
  const { ini, fim, ultimo } = limitesDoMes(ym)

  const r = await carregarCicloMidia(orgSlug, ini, fim)
  if ('error' in r && r.error) throw new Error(r.error)

  return (
    <AgendaMidia
      orgSlug={orgSlug} ym={ym} diasNoMes={ultimo} hoje={hoje}
      cobertura={r.cobertura ?? []} agenda={r.agenda ?? []}
    />
  )
}
