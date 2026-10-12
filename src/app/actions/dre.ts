'use server'

import { revalidatePath } from 'next/cache'
import { assertFinanceAccess } from '@/lib/finance'
import { getUsuario } from '@/lib/auth/server'
import { DRE_GRUPOS, DRE_SUBS_PADRAO, type DreConfig } from '@/lib/dre-template'

/**
 * Grava os ajustes da org sobre a estrutura padrão da DRE (mig. 340).
 * Recebe a configuração INTEIRA, já como diferença sobre o padrão — a tela
 * calcula; aqui só se confere a forma antes de gravar.
 */
export async function salvarDreEstrutura(orgSlug: string, config: DreConfig): Promise<{ error?: string }> {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const grupos = new Set(DRE_GRUPOS.map(g => g.code))
  const padrao = new Set(DRE_SUBS_PADRAO.map(s => s.code))
  const subs = (config.subs ?? []).map(s => ({ code: String(s.code), label: String(s.label ?? '').trim().slice(0, 80), grupo: String(s.grupo) }))
  for (const s of subs) {
    // Até dois níveis abaixo do grupo (06.3, 06.2.1), sempre dentro do próprio grupo.
    if (!/^\d{2}(\.\d{1,2}){1,2}$/.test(s.code) || !grupos.has(s.grupo) || !s.code.startsWith(`${s.grupo}.`))
      return { error: `Subgrupo inválido: ${s.code}` }
    if (padrao.has(s.code)) return { error: `O código ${s.code} já é da estrutura padrão.` }
    if (!s.label) return { error: 'O subgrupo precisa de um nome.' }
  }
  if (new Set(subs.map(s => s.code)).size !== subs.length) return { error: 'Há dois subgrupos com o mesmo código.' }

  const validos = new Set([...padrao, ...subs.map(s => s.code)])
  const mapa: Record<string, string> = {}
  for (const [cat, sub] of Object.entries(config.mapa ?? {})) {
    const c = cat.trim()
    if (!c) continue
    if (sub !== '' && !validos.has(sub)) return { error: `Linha da DRE inexistente: ${sub}` }
    mapa[c] = sub
  }

  const vazio = subs.length === 0 && Object.keys(mapa).length === 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_dre_estrutura', {
    p_user_id: user.id, p_org_id: orgId, p_estrutura: vazio ? null : { subs, mapa },
  })
  if (error) return { error: error.message }

  revalidatePath(`/${orgSlug}/financeiro/dre`)
  revalidatePath(`/${orgSlug}/views/gestao`)
  return {}
}
