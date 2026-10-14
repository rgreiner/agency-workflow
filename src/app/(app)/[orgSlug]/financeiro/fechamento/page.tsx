import { assertFinanceAccess } from '@/lib/finance'
import { unwrap, unwrapOne } from '@/lib/supabase/unwrap'
import { FechamentoClient, type Fechamento, type ConfigContabil } from './FechamentoClient'
import { conferirMes, type ConferenciaConta } from '@/app/actions/contabil'

// Lê estado que muda por ação humana (confirmar/enviar) — nunca serve render cacheada.
export const dynamic = 'force-dynamic'

/** Competência do mês anterior, em horário de Brasília. */
function competenciaAnterior(): string {
  const hoje = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const [ano, mes] = hoje.split('-').map(Number)
  const d = new Date(Date.UTC(ano, mes - 1, 1))
  d.setUTCMonth(d.getUTCMonth() - 1)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function FechamentoPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [resFech, resCfg] = await Promise.all([
    sb.from('fechamento_contabil')
      .select('id, competencia, status, confirmado_em, enviado_em, destinatarios, erro, envios')
      .eq('org_id', orgId).order('competencia', { ascending: false }),
    sb.from('org_settings')
      .select('contabil_emails, contabil_dia, contabil_ativo')
      .eq('org_id', orgId).maybeSingle(),
  ])

  const fechamentos = unwrap<Fechamento>(resFech, 'fechamentos')
  const cfgRow = unwrapOne<ConfigContabil>(resCfg, 'configuração da contabilidade')

  // Conferência com o banco de cada mês ainda por enviar (ou reaberto): é ela
  // que libera o botão de enviar.
  const conferencias: Record<string, ConferenciaConta[]> = {}
  await Promise.all(fechamentos.filter(f => f.status !== 'enviado').map(async f => {
    const r = await conferirMes(orgSlug, f.competencia)
    conferencias[f.competencia] = 'contas' in r ? r.contas : []
  }))

  return (
    <FechamentoClient
      orgSlug={orgSlug}
      fechamentos={fechamentos}
      config={{
        contabil_emails: cfgRow?.contabil_emails ?? [],
        contabil_dia: cfgRow?.contabil_dia ?? 5,
        contabil_ativo: cfgRow?.contabil_ativo ?? false,
      }}
      competenciaSugerida={competenciaAnterior()}
      conferencias={conferencias}
    />
  )
}
