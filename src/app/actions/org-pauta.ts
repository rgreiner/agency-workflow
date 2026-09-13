'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

/**
 * Cadastro das sugestões que compõem o título da pauta (migration 285) —
 * Configurações → Pauta. Veículo, formato e objetivo.
 *
 * Toda a regra vive no banco (owner/admin, duplicata, " - " proibido no valor);
 * aqui é só transporte. `revalidatePath(layout)` porque as listas viajam pelo
 * OrgSettingsProvider, montado no layout da org.
 */

export type CampoPauta = 'veiculo' | 'formato' | 'objetivo'

/** Uma linha da tela: opção do cadastro com seu uso, ou valor digitado que ainda não é opção. */
export interface PautaUsoRow {
  campo: CampoPauta | null
  valor: string
  usos: number
  ultimo: string | null
  no_cadastro: boolean
}

/** Cria (id null) ou renomeia. Renomear não reescreve título já gravado. */
export async function salvarOpcaoPauta(
  orgSlug: string, orgId: string, id: string | null, campo: CampoPauta, valor: string,
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('org_pauta_salvar', {
    p_org: orgId, p_id: id, p_campo: campo, p_valor: valor,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}`, 'layout')
  return { ok: true, id: data as string }
}

/** Exclui. Seguro: nenhuma tarefa aponta para a opção, o texto já está no título. */
export async function excluirOpcaoPauta(orgSlug: string, orgId: string, id: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('org_pauta_excluir', { p_org: orgId, p_id: id })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}`, 'layout')
  return { ok: true }
}

/** Reordena (a ordem do array vira a ordem do Select). */
export async function reordenarOpcoesPauta(
  orgSlug: string, orgId: string, campo: CampoPauta, ids: string[],
) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('org_pauta_reordenar', {
    p_org: orgId, p_campo: campo, p_ids: ids,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}`, 'layout')
  return { ok: true }
}

/**
 * Uso real de cada opção + o que a equipe digita fora do cadastro.
 * É o que transforma a tela num levantamento vivo em vez de uma lista cega:
 * `usos = 0` é candidata a sair, `no_cadastro` é candidata a entrar.
 */
export async function usoDaPauta(orgId: string): Promise<PautaUsoRow[]> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('org_pauta_uso', { p_org: orgId })
  if (error) return []
  return (data ?? []) as PautaUsoRow[]
}
