import { assertFinanceAccess } from '@/lib/finance'
import { LancamentosClient, type Lancamento } from './LancamentosClient'

export default async function LancamentosPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw } = await (supabase as any)
    .from('lancamentos')
    .select('id, tipo, origem_tipo, contato_nome, descricao, valor, vencimento, competencia, situacao, nf_emitida, boleto_gerado, revisar')
    .eq('org_id', orgId)
    .order('vencimento', { ascending: true, nullsFirst: false })

  const lancamentos = (raw ?? []) as Lancamento[]
  const today = new Date().toISOString().slice(0, 10)

  return <LancamentosClient orgSlug={orgSlug} lancamentos={lancamentos} today={today} />
}
