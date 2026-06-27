import { createClient } from '@/lib/supabase/server'
import { ContasClient, type Conta } from './ContasClient'

export default async function ContasPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contasRaw } = await (supabase as any)
    .from('contas_financeiras')
    .select('id, nome, tipo, saldo_inicial, cor, ativo, ordem')
    .eq('org_id', org.id)
    .order('ordem', { ascending: true })
    .order('nome', { ascending: true })

  const contas = (contasRaw ?? []) as Conta[]

  return <ContasClient orgSlug={orgSlug} contas={contas} />
}
