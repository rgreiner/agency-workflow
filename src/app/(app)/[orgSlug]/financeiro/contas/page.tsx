import { createClient } from '@/lib/supabase/server'
import { unwrap } from '@/lib/supabase/unwrap'
import { ContasClient, type Conta } from './ContasClient'
import { BtgCard } from './BtgCard'
import { btgConfigured, btgEnv } from '@/lib/btg/config'
import { getBtgConnection } from '@/lib/btg/store'

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
  const resContas = await (supabase as any)
    .from('contas_saldo')
    .select('id, nome, tipo, saldo_inicial, saldo_atual, cor, ativo, ordem')
    .eq('org_id', org.id)
    .order('ordem', { ascending: true })
    .order('nome', { ascending: true })

  const contas = unwrap<Conta>(resContas, 'contas')

  const conn = await getBtgConnection(org.id)
  const btg = {
    configured: btgConfigured(),
    env: btgEnv(),
    connected: !!conn?.refreshToken && conn.status !== 'revoked',
    status: conn?.status ?? null,
    companyId: conn?.companyId ?? null,
    accountId: conn?.accountId ?? null,
    lastSyncAt: conn?.lastSyncAt ?? null,
    lastError: conn?.lastError ?? null,
  }

  // A integração mora dentro da conta que ela alimenta (migration 128). Aqui ela só
  // aparece enquanto NÃO estiver vinculada a nenhuma — senão ficaria inalcançável.
  const orfa = !conn?.contaId

  return (
    <>
      <ContasClient orgSlug={orgSlug} contas={contas} />
      {orfa && (
        <div className="px-6 pb-8 -mt-2">
          <p className="text-xs text-gray-400 mb-2">
            Integração sem conta vinculada — assim que apontar pra uma conta, ela passa a aparecer dentro dela.
          </p>
          <BtgCard orgSlug={orgSlug} btg={btg} />
        </div>
      )}
    </>
  )
}
