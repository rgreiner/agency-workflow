import { assertRhAccess } from '@/lib/rh'
import { unwrap } from '@/lib/supabase/unwrap'
import { ContratacoesClient, type AdmissaoRow, type ConfigAdmissao } from './ContratacoesClient'
import type { JornadaProposta } from '@/lib/admissao'

export const dynamic = 'force-dynamic'

export default async function ContratacoesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (supabase as any).from('organizations').select('name').eq('id', orgId).maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lista = unwrap<AdmissaoRow>(await (supabase as any)
    .from('rh_admissao')
    .select('id, nome, email, telefone, cargo, tipo_vinculo, salario, data_inicio, data_primeiro_pagamento, '
      + 'local_trabalho, jornada, beneficios, carta, token, expira_em, enviada_em, aberta_em, aceita_em, '
      + 'recusada_em, recusa_motivo, ficha_em, exame_em, exame_local, status, observacao, dados_limpos_em, '
      + 'contabil_em, colaborador_id, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false }), 'contratações')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cfg } = await (supabase as any)
    .from('org_settings').select('rh_admissao, agency_info').eq('org_id', orgId).maybeSingle()

  // Jornada padrão da empresa: a proposta nasce com ela (e a vigência de hoje —
  // desde a mig. 288 existe mais de uma linha por alvo).
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jornadas = unwrap<JornadaProposta & { vigencia_ini: string }>(await (supabase as any)
    .from('rh_jornada')
    .select('vigencia_ini, entrada, intervalo_ini, intervalo_fim, saida, dias_semana')
    .eq('org_id', orgId).is('colaborador_id', null)
    .order('vigencia_ini', { ascending: false }), 'jornada padrão')
  const jornadaPadrao = jornadas.find(j => j.vigencia_ini <= hoje) ?? null

  const config: ConfigAdmissao = {
    ...(cfg?.rh_admissao ?? {}),
    endereco: cfg?.agency_info?.endereco ?? null,
  }

  return <ContratacoesClient orgSlug={orgSlug} agencia={org?.name ?? 'a agência'} lista={lista}
    config={config} jornadaPadrao={jornadaPadrao} hoje={hoje} />
}
