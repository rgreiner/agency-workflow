'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'
import type { StatusOverride } from '@/types'
import type { AgencyInfo, DocNote } from '@/lib/agency'

export async function upsertOrgSettings(
  orgId: string,
  logoUrl: string | null,
  accentColor: string,
  statusOverrides: StatusOverride[],
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('upsert_org_settings', {
    p_user_id:          user.id,
    p_org_id:           orgId,
    p_logo_url:         logoUrl,
    p_accent_color:     accentColor,
    p_status_overrides: statusOverrides,
  })

  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
}

/** Salva dados da agência + observações legais (Configurações → Documentos; owner/admin). */
export async function setOrgDocs(orgSlug: string, orgId: string, agency: AgencyInfo, nfNotes: DocNote[], midiaNotes: DocNote[]) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_org_docs', {
    p_user_id: user.id, p_org_id: orgId,
    p_agency: agency, p_nf_notes: nfNotes, p_midia_notes: midiaNotes,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/documentos`)
  return {}
}

/** Dados bancários da org (usados na cobrança automática). owner/admin/can_finance. */
export async function setOrgPaymentInfo(orgSlug: string, orgId: string, info: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_org_payment_info', { p_user_id: user.id, p_org_id: orgId, p_info: info })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/documentos`)
  return {}
}

export interface ReviewGates { redacao: boolean; design: boolean; finalizacao: boolean }

/** Liga/desliga a revisão por IA por gate (Configurações → Revisão IA; owner/admin). */
export async function setOrgReviewGates(orgSlug: string, orgId: string, gates: ReviewGates) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_org_review_gates', {
    p_user_id: user.id,
    p_org_id:  orgId,
    p_gates:   gates,
  })

  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/revisao`)
}
