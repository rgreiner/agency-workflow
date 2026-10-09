import { assertFinanceAccess } from '@/lib/finance'
import { unwrap } from '@/lib/supabase/unwrap'
import type { FinanceCentro, FinanceCategoriaGrupo } from '@/app/actions/financeiro'
import type { ContaRef } from '../faturamento/ClassificacaoFields'
import { LancarDespesaClient, type FornecedorRef } from './LancarDespesaClient'

export const metadata = { title: 'Financeiro — Lançar despesa' }
export const dynamic = 'force-dynamic'

/**
 * Lançar despesa a partir do documento: a NF, o cupom ou o boleto entram, a IA
 * lê o cabeçalho, a pessoa confere e o lançamento nasce com o arquivo anexado.
 * Feita para lançar em sequência — depois de salvar, a tela volta limpa para o
 * próximo papel da pilha.
 */
export default async function LancarDespesaPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [resContas, resSettings, resForn] = await Promise.all([
    sb.from('contas_financeiras').select('id, nome, ativo, favorita').eq('org_id', orgId),
    sb.from('org_settings').select('finance_categorias, finance_centros_custo').eq('org_id', orgId).maybeSingle(),
    sb.from('fornecedores').select('id, name').eq('org_id', orgId).eq('archived', false).order('name'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contasAtivas = unwrap<any>(resContas, 'contas').filter(c => c.ativo)
  const contas: ContaRef[] = contasAtivas.map(c => ({ id: c.id, nome: c.nome }))
  const contaPadrao = (contasAtivas.find(c => c.favorita) ?? contasAtivas[0])?.id ?? ''
  const categorias = (resSettings?.data?.finance_categorias ?? []) as FinanceCategoriaGrupo[]
  const centros = (resSettings?.data?.finance_centros_custo ?? []) as FinanceCentro[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fornecedores: FornecedorRef[] = unwrap<any>(resForn, 'fornecedores').map(f => ({ id: f.id, nome: f.name }))

  return (
    <LancarDespesaClient orgSlug={orgSlug} contas={contas} contaPadrao={contaPadrao}
      categorias={categorias} centros={centros} fornecedores={fornecedores} />
  )
}
