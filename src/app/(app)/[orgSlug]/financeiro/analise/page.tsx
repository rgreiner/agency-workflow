import { assertFinanceAccess } from '@/lib/finance'
import type { CuboRow } from '@/lib/fin-cubo'
import type { CategoriaGrupoLike } from '@/lib/finance-categorias'
import type { FinanceCentro } from '@/app/actions/financeiro'
import { AnaliseClient } from './AnaliseClient'

export const metadata = { title: 'Financeiro — Análise' }

const PAGE = 1000

/**
 * Análise financeira: tabela dinâmica sobre o cubo (`fin_cubo`, migration 248).
 *
 * A tela desce UMA vez e pivota tudo em memória — período, dimensão de linha e
 * de coluna, filtros. Medido em produção: o histórico inteiro (2023→2032, com o
 * previsto recorrente) cabe em 4,4 mil linhas agregadas. Fatiar isso no servidor
 * a cada troca de cruzamento seria uma requisição por clique para reagregar o
 * mesmo dado.
 */
export default async function AnalisePage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // PostgREST limita o nº de linhas por request — pagina até esgotar. Erro
  // levanta em vez de virar lista vazia: tabela em branco aqui se leria como
  // "não teve custo", que é uma decisão errada.
  async function paginado<T>(rpc: string, rotulo: string): Promise<T[]> {
    const out: T[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.rpc(rpc, { p_org: orgId }).range(from, from + PAGE - 1)
      if (error) throw new Error(`Falha ao carregar ${rotulo}: ${error.message}`)
      if (!data || data.length === 0) break
      out.push(...(data as T[]))
      if (data.length < PAGE) break
    }
    return out
  }

  const [rows, resSettings] = await Promise.all([
    paginado<CuboRow>('fin_cubo', 'a análise financeira'),
    sb.from('org_settings').select('finance_categorias, finance_centros_custo').eq('org_id', orgId).maybeSingle(),
  ])

  const categorias = (resSettings?.data?.finance_categorias ?? []) as CategoriaGrupoLike[]
  const centros = (resSettings?.data?.finance_centros_custo ?? []) as FinanceCentro[]

  return <AnaliseClient orgSlug={orgSlug} rows={rows} categorias={categorias} centros={centros} />
}
