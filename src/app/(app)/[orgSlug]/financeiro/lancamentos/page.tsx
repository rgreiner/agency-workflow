import { assertFinanceAccess } from '@/lib/finance'
import { LancamentosClient, type Lancamento, type ContaRef } from './LancamentosClient'
import type { FinanceCategoriaGrupo, FinanceCentro } from '@/app/actions/financeiro'

export default async function LancamentosPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [{ data: raw }, { data: contasRaw }, { data: settings }] = await Promise.all([
    sb.from('lancamentos')
      .select('id, tipo, origem_tipo, parcela_num, parcela_total, contato_nome, descricao, valor, valor_realizado, vencimento, competencia, situacao, nf_emitida, boleto_gerado, revisar, conta_id, categoria, centro_custo, data_liquidacao, forma_pagamento, observacao, juros, multa, desconto, tarifa, anexos')
      .eq('org_id', orgId)
      .order('vencimento', { ascending: true, nullsFirst: false }),
    sb.from('contas_financeiras')
      .select('id, nome, cor, ativo')
      .eq('org_id', orgId)
      .order('ordem', { ascending: true }),
    sb.from('org_settings')
      .select('finance_categorias, finance_centros_custo')
      .eq('org_id', orgId)
      .maybeSingle(),
  ])

  const lancamentos = (raw ?? []) as Lancamento[]
  const contas = ((contasRaw ?? []) as ContaRef[]).filter(c => c.ativo)
  const categorias = (settings?.finance_categorias ?? []) as FinanceCategoriaGrupo[]
  const centros = (settings?.finance_centros_custo ?? []) as FinanceCentro[]
  const today = new Date().toISOString().slice(0, 10)

  return (
    <LancamentosClient
      orgSlug={orgSlug}
      lancamentos={lancamentos}
      contas={contas}
      categorias={categorias}
      centros={centros}
      today={today}
    />
  )
}
