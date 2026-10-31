import 'server-only'
import { cache } from 'react'
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
  /** Lista global (todos os clientes e status). Quem executa usa o Atendimento,
   *  que já filtra pelos status do cargo — a Lista é ferramenta de quem coordena. */
  listaGlobal: boolean
  midias: boolean
  producao: boolean
  /** Hub de Mídia (operação): toggle PRÓPRIO do cargo — `midias` é o comercial
   *  (PI/MX) e está ligado também na Revisão. */
  midiaHub: boolean
  financeiro: boolean
  cadastros: boolean
  rh: boolean
  operacional: boolean
  isOwner: boolean
  positionName: string | null
  /** Destino do "Trabalhar" (sem a barra inicial): quem tem cargo de mídia
   *  (o Hub ligado no PRÓPRIO cargo, não herdado do "vê tudo") trabalha na fila
   *  da mídia; os demais, na fila por status do cargo (Rafael, 12/10). */
  trabalharHref: string
}

type PosRow = { name?: string | null; op_ver_tudo?: boolean | null; op_midias?: boolean | null; op_producao?: boolean | null; op_midia_hub?: boolean | null }
export interface MembershipRow {
  role: string
  can_finance?: boolean | null
  can_vendas?: boolean | null
  can_rh?: boolean | null
  org_positions?: PosRow | PosRow[] | null
}

/** Colunas a selecionar em organization_members para computar o acesso. */
export const ACCESS_SELECT = 'role, can_finance, can_vendas, can_rh, org_positions(name, op_ver_tudo, op_midias, op_producao, op_midia_hub)'

export function computeAccess(m: MembershipRow): OperacionalAccess {
  const isAdmin = m.role === 'owner' || m.role === 'admin'
  const pos = (Array.isArray(m.org_positions) ? m.org_positions[0] : m.org_positions) ?? null
  const verTudo = isAdmin || !!pos?.op_ver_tudo
  const canFinance = !!m.can_finance
  const canVendas = !!m.can_vendas
  const midias = verTudo || (canVendas && !!pos?.op_midias)
  const producao = verTudo || (canVendas && !!pos?.op_producao)
  // Hub de Mídia NÃO herda de can_vendas: é a operação da mídia, não a venda.
  const midiaHub = verTudo || !!pos?.op_midia_hub
  const financeiro = verTudo || canFinance
  const cadastros = verTudo || canVendas || canFinance
  // RH é sensível: só owner/admin OU can_rh explícito (não herda de vendas/finance).
  const rh = verTudo || !!m.can_rh
  return {
    verTudo, midias, producao, midiaHub, financeiro, cadastros, rh,
    listaGlobal: isAdmin || m.role === 'manager' || verTudo,
    operacional: midias || producao || midiaHub || financeiro || cadastros || rh,
    isOwner: m.role === 'owner',
    positionName: pos?.name ?? null,
    trabalharHref: pos?.op_midia_hub ? 'midia' : 'views/atendimento',
  }
}

/**
 * Org pelo slug, uma vez por request. O layout da org e `getAccess()` faziam a
 * mesma consulta em sequência (medido: 14 pontos de chamada, 5 páginas) — com
 * `cache()` do React a segunda chamada na mesma request não vai ao banco.
 */
export const orgPorSlug = cache(async (orgSlug: string): Promise<{ id: string; name: string; slug: string } | null> => {
  const supabase = await createClient()
  const { data } = await supabase.from('organizations').select('id, name, slug').eq('slug', orgSlug).single()
  return (data as { id: string; name: string; slug: string } | null) ?? null
})

/**
 * Vínculo ATIVO da pessoa com a org (+ cargo), uma vez por request.
 * Arquivado = sem acesso (mesma régua de is_org_member, migration 178). Sem isto a
 * pessoa desligada ainda abria as telas — vazias, porque a RLS barra o dado, mas
 * abria.
 */
export const membershipAtiva = cache(async (orgId: string, userId: string): Promise<MembershipRow | null> => {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('organization_members').select(ACCESS_SELECT)
    .eq('org_id', orgId).eq('user_id', userId).eq('arquivado', false)
    .maybeSingle() as { data: MembershipRow | null }
  return data ?? null
})

/** Carrega membership + cargo e computa o acesso. null se sem sessão/org/membro. */
export async function getAccess(orgSlug: string): Promise<
  { supabase: Awaited<ReturnType<typeof createClient>>; orgId: string; userId: string; access: OperacionalAccess } | null
> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return null

  const org = await orgPorSlug(orgSlug)
  if (!org) return null

  const m = await membershipAtiva(org.id, user.id)
  if (!m) return null

  return { supabase, orgId: org.id, userId: user.id, access: computeAccess(m) }
}
