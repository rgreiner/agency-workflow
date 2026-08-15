import { assertMidiaAccess } from '@/lib/midia-hub'
import { unwrap } from '@/lib/supabase/unwrap'
import { RotinasCatalogo, type RotinaCat } from './RotinasCatalogo'

export const metadata = { title: 'Mídia — Catálogo de rotinas' }

export default async function RotinasPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertMidiaAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [resRot, resStatus, resUso] = await Promise.all([
    sb.from('midia_rotina').select('*').eq('org_id', orgId).order('ordem'),
    sb.from('org_status').select('valor, label').eq('org_id', orgId).order('ordem'),
    // Quantos clientes já usam cada rotina — desativar uma rotina em uso não é
    // o mesmo gesto que arrumar o catálogo antes de começar.
    sb.from('midia_cliente_rotina').select('rotina_id, ativo').eq('org_id', orgId).eq('ativo', true),
  ])

  const rotinas = unwrap<RotinaCat>(resRot, 'rotinas')
  const status = unwrap<{ valor: string; label: string }>(resStatus, 'status')
  const uso = unwrap<{ rotina_id: string }>(resUso, 'uso das rotinas')
  const contagem: Record<string, number> = {}
  for (const u of uso) contagem[u.rotina_id] = (contagem[u.rotina_id] ?? 0) + 1

  return <RotinasCatalogo orgSlug={orgSlug} rotinas={rotinas} status={status} uso={contagem} />
}
