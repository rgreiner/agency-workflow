import { assertHorasAccess } from '@/lib/horas'
import { getUsuario } from '@/lib/auth/server'
import { HorasClient, type LinhaTarefa, type LinhaPessoa } from './HorasClient'
import { CustoHora, type CamadaPessoa, type PrecoVenda } from './CustoHora'

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

  const user = await getUsuario()

  const [tarefasRes, pessoasRes, camadasRes, precoRes, membroRes] = await Promise.all([
    sb.rpc('horas_por_atividade', { p_org: orgId, p_ini: de, p_fim: ate }),
    sb.rpc('horas_por_pessoa', { p_org: orgId, p_ini: de, p_fim: ate }),
    // Composição do custo: exige can_rh de verdade (expõe salário) — pode negar
    // para owner de horas sem RH; nesse caso a seção simplesmente não aparece.
    sb.rpc('horas_custo_camadas', { p_org: orgId }),
    sb.rpc('horas_preco_venda', { p_org: orgId }),
    user ? sb.from('organization_members').select('role').eq('org_id', orgId).eq('user_id', user.id).single() : Promise.resolve({ data: null }),
  ])

  const tarefas = (tarefasRes.data ?? []) as LinhaTarefa[]
  const pessoas = (pessoasRes.data ?? []) as LinhaPessoa[]
  const erro = (tarefasRes.error?.message ?? pessoasRes.error?.message ?? null) as string | null
  const camadas = (camadasRes.data ?? []) as CamadaPessoa[]
  const preco = (precoRes.data ?? null) as PrecoVenda | null
  const canConfig = ['owner', 'admin'].includes((membroRes.data as { role?: string } | null)?.role ?? '')

  return (
    <>
      <HorasClient
        orgSlug={orgSlug}
        de={de} ate={ate} preset={preset}
        tarefas={tarefas} pessoas={pessoas} erro={erro}
      />
      <div className="px-6 pb-10 max-w-6xl -mt-2">
        <CustoHora orgSlug={orgSlug} orgId={orgId} camadas={camadas} preco={preco} canConfig={canConfig} />
      </div>
    </>
  )
}
