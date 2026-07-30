import { notFound } from 'next/navigation'
import { assertRhAccess } from '@/lib/rh'
import { unwrap, unwrapOne } from '@/lib/supabase/unwrap'
import { ColaboradorClient, type Colaborador, type GestorRef, type MembroRef } from './ColaboradorClient'
import type { JornadaVals } from '../JornadaEditor'

export const dynamic = 'force-dynamic'

export default async function ColaboradorPage({ params }: { params: Promise<{ orgSlug: string; colaboradorId: string }> }) {
  const { orgSlug, colaboradorId } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const colab = unwrapOne<Colaborador>(await (supabase as any)
    .from('rh_colaborador')
    .select('id, nome, cpf, email, telefone, cargo, tipo_vinculo, data_admissao, data_demissao, status, gestor_id, salario_atual, beneficios_mensal, observacao, arquivado, membro_user_id')
    .eq('id', colaboradorId).eq('org_id', orgId).maybeSingle(), 'colaborador')
  if (!colab) notFound()

  // Membros da org (p/ vincular a ficha ao login → habilita o ponto).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const membros = unwrap<MembroRef>(await (supabase as any)
    .from('organization_members').select('user_id, profiles!user_id(full_name, email)')
    .eq('org_id', orgId), 'membros')

  // Possíveis gestores: os outros colaboradores ativos da org.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gestores = unwrap<GestorRef>(await (supabase as any)
    .from('rh_colaborador')
    .select('id, nome')
    .eq('org_id', orgId).eq('arquivado', false).neq('id', colaboradorId)
    .order('nome', { ascending: true }), 'gestores')

  // Jornada: override da pessoa (se houver) + padrão da org (fallback exibido quando herda).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jornadaOverride = unwrapOne<Partial<JornadaVals>>(await (supabase as any)
    .from('rh_jornada')
    .select('entrada, intervalo_ini, intervalo_fim, saida, flex_min, dias_semana')
    .eq('colaborador_id', colaboradorId).maybeSingle(), 'jornada pessoa')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jornadaPadrao = unwrapOne<Partial<JornadaVals>>(await (supabase as any)
    .from('rh_jornada')
    .select('entrada, intervalo_ini, intervalo_fim, saida, flex_min, dias_semana')
    .eq('org_id', orgId).is('colaborador_id', null).maybeSingle(), 'jornada padrão')

  return <ColaboradorClient orgSlug={orgSlug} colab={colab} gestores={gestores} membros={membros}
    jornadaOverride={jornadaOverride} jornadaPadrao={jornadaPadrao} />
}
