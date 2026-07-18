import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

/**
 * Acesso ao Operacional, computado por CARGO × toggles do membro.
 * - `verTudo` (Diretoria / owner / admin): vê todas as seções, ignora os toggles.
 * - `midias` / `producao`: sob `can_vendas`, conforme os marcadores do cargo.
 * - `financeiro`: `can_finance` (ou verTudo).
 * - `cadastros`: `can_vendas` OU `can_finance` (ou verTudo).
 */
export interface OperacionalAccess {
  verTudo: boolean
  midias: boolean
  producao: boolean
  financeiro: boolean
  cadastros: boolean
  operacional: boolean
  isOwner: boolean
  positionName: string | null
}

type PosRow = { name?: string | null; op_ver_tudo?: boolean | null; op_midias?: boolean | null; op_producao?: boolean | null }
export interface MembershipRow {
  role: string
  can_finance?: boolean | null
  can_vendas?: boolean | null
  org_positions?: PosRow | PosRow[] | null
}

/** Colunas a selecionar em organization_members para computar o acesso. */
export const ACCESS_SELECT = 'role, can_finance, can_vendas, org_positions(name, op_ver_tudo, op_midias, op_producao)'

export function computeAccess(m: MembershipRow): OperacionalAccess {
  const isAdmin = m.role === 'owner' || m.role === 'admin'
  const pos = (Array.isArray(m.org_positions) ? m.org_positions[0] : m.org_positions) ?? null
  const verTudo = isAdmin || !!pos?.op_ver_tudo
  const canFinance = !!m.can_finance
  const canVendas = !!m.can_vendas
  const midias = verTudo || (canVendas && !!pos?.op_midias)
  const producao = verTudo || (canVendas && !!pos?.op_producao)
  const financeiro = verTudo || canFinance
  const cadastros = verTudo || canVendas || canFinance
  return {
    verTudo, midias, producao, financeiro, cadastros,
    operacional: midias || producao || financeiro || cadastros,
    isOwner: m.role === 'owner',
    positionName: pos?.name ?? null,
  }
}

/** Carrega membership + cargo e computa o acesso. null se sem sessão/org/membro. */
export async function getAccess(orgSlug: string): Promise<
  { supabase: Awaited<ReturnType<typeof createClient>>; orgId: string; userId: string; access: OperacionalAccess } | null
> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return null

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any)
    .from('organization_members').select(ACCESS_SELECT)
    .eq('org_id', org.id).eq('user_id', user.id).single() as { data: MembershipRow | null }
  if (!m) return null

  return { supabase, orgId: org.id as string, userId: user.id as string, access: computeAccess(m) }
}
