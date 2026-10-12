import { assertFinanceAccess } from '@/lib/finance'
import { DRE_MAPA_PADRAO, type DreConfig } from '@/lib/dre-template'
import { grupoServeA, isTransferenciaCategoria, type CategoriaGrupoLike } from '@/lib/finance-categorias'
import { DreEstruturaClient, type CategoriaDre } from './DreEstruturaClient'

export const metadata = { title: 'Financeiro — Estrutura da DRE' }
export const dynamic = 'force-dynamic'

/**
 * Estrutura da DRE: em qual linha cada categoria entra.
 *
 * A estrutura padrão mora no código (lib/dre-template.ts); aqui a org move
 * categoria e cria subgrupo sem depender de deploy. A lista de categorias vem do
 * cadastro (Financeiro → Categorias) — medido em 12/10/2026: toda categoria
 * usada em lançamento está cadastrada — mais as do padrão.
 */
export default async function DreEstruturaPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cfg } = await (supabase as any).from('org_settings')
    .select('finance_categorias, dre_estrutura').eq('org_id', orgId).maybeSingle()

  const grupos = (cfg?.finance_categorias ?? []) as CategoriaGrupoLike[]
  const porNome = new Map<string, CategoriaDre>()
  for (const g of grupos) {
    const tipo: CategoriaDre['tipo'] = grupoServeA(g, 'entrada') && grupoServeA(g, 'saida') ? 'ambos'
      : grupoServeA(g, 'entrada') ? 'entrada' : 'saida'
    // Grupo com filhos é só agrupador: quem vai no lançamento é o filho.
    const nomes = (g.filhos ?? []).length ? (g.filhos ?? []).map(f => f.nome) : [g.nome]
    for (const nome of nomes) {
      if (!nome?.trim() || isTransferenciaCategoria(nome)) continue
      const ja = porNome.get(nome)
      porNome.set(nome, { nome, tipo: ja && ja.tipo !== tipo ? 'ambos' : tipo })
    }
  }
  for (const nome of Object.keys(DRE_MAPA_PADRAO)) if (!porNome.has(nome)) porNome.set(nome, { nome, tipo: null })

  return (
    <DreEstruturaClient
      orgSlug={orgSlug}
      categorias={[...porNome.values()]}
      config={(cfg?.dre_estrutura ?? null) as DreConfig | null}
    />
  )
}
