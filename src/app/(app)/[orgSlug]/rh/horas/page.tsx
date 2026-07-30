import { assertHorasAccess } from '@/lib/horas'
import { HorasClient, type LinhaTarefa, type LinhaPessoa } from './HorasClient'

export const metadata = { title: 'Horas — Flow' }

/** Período em BRT (o dia do relatório é o dia daqui, não o do servidor). */
function hojeBR() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
}
const iso = (d: Date) => d.toISOString().slice(0, 10)

function periodo(p: string | undefined, de?: string, ate?: string) {
  const hoje = hojeBR()
  if (de && ate && /^\d{4}-\d{2}-\d{2}$/.test(de) && /^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return { de, ate, preset: 'custom' as const }
  }
  if (p === 'hoje') return { de: iso(hoje), ate: iso(hoje), preset: 'hoje' as const }
  if (p === '7d') {
    const d = new Date(hoje); d.setDate(d.getDate() - 6)
    return { de: iso(d), ate: iso(hoje), preset: '7d' as const }
  }
  if (p === 'anterior') {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0)
    return { de: iso(ini), ate: iso(fim), preset: 'anterior' as const }
  }
  const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
  return { de: iso(ini), ate: iso(hoje), preset: 'mes' as const }
}

export default async function HorasPage({
  params, searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ p?: string; de?: string; ate?: string }>
}) {
  const { orgSlug } = await params
  const sp = await searchParams
  const { supabase, orgId } = await assertHorasAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { de, ate, preset } = periodo(sp.p, sp.de, sp.ate)

  const [tarefasRes, pessoasRes] = await Promise.all([
    sb.rpc('horas_por_atividade', { p_org: orgId, p_ini: de, p_fim: ate }),
    sb.rpc('horas_por_pessoa', { p_org: orgId, p_ini: de, p_fim: ate }),
  ])

  const tarefas = (tarefasRes.data ?? []) as LinhaTarefa[]
  const pessoas = (pessoasRes.data ?? []) as LinhaPessoa[]
  const erro = (tarefasRes.error?.message ?? pessoasRes.error?.message ?? null) as string | null

  return (
    <HorasClient
      orgSlug={orgSlug}
      de={de} ate={ate} preset={preset}
      tarefas={tarefas} pessoas={pessoas} erro={erro}
    />
  )
}
