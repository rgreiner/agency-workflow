import 'server-only'
import { redirect } from 'next/navigation'
import { getUsuario } from '@/lib/auth/server'
import { getAccess, type OperacionalAccess } from '@/lib/auth/access'

/**
 * Garante acesso a uma seção do Operacional, olhando CARGO × toggles do membro
 * (ver `computeAccess`). Redireciona p/ a home da org se não tiver. Usado nos
 * layouts dessas rotas — bloqueia por URL, não só esconde na sidebar.
 */
type Area = 'midias' | 'producao' | 'financeiro' | 'cadastros'

async function requireArea(orgSlug: string, area: Area): Promise<void> {
  const user = await getUsuario()
  if (!user) redirect('/login')
  const r = await getAccess(orgSlug)
  if (!r) redirect('/')
  if (!r.access[area as keyof OperacionalAccess]) redirect(`/${orgSlug}`)
}

/** Liberação de mídias: verTudo, ou can_vendas + cargo libera Mídias. */
export function requireMidias(orgSlug: string): Promise<void> {
  return requireArea(orgSlug, 'midias')
}

/** Liberação de Produção: verTudo, ou can_vendas + cargo libera Produção. */
export function requireProducao(orgSlug: string): Promise<void> {
  return requireArea(orgSlug, 'producao')
}

/** Cadastros: verTudo, ou can_vendas OU can_finance. */
export function requireCadastros(orgSlug: string): Promise<void> {
  return requireArea(orgSlug, 'cadastros')
}

/** Financeiro: verTudo, ou can_finance. */
export function requireFinanceiro(orgSlug: string): Promise<void> {
  return requireArea(orgSlug, 'financeiro')
}
