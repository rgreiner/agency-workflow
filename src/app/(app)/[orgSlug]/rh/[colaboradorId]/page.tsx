import { notFound } from 'next/navigation'
import { assertRhAccess } from '@/lib/rh'
import { unwrap, unwrapOne } from '@/lib/supabase/unwrap'
import { ColaboradorClient, type Colaborador, type Documento, type GestorRef, type MembroRef } from './ColaboradorClient'

export const dynamic = 'force-dynamic'

export default async function ColaboradorPage({ params }: { params: Promise<{ orgSlug: string; colaboradorId: string }> }) {
  const { orgSlug, colaboradorId } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const colab = unwrapOne<Colaborador>(await (supabase as any)
    .from('rh_colaborador')
    .select('id, nome, cpf, email, telefone, cargo, tipo_vinculo, data_admissao, data_demissao, status, gestor_id, salario_atual, observacao, arquivado, membro_user_id')
    .eq('id', colaboradorId).eq('org_id', orgId).maybeSingle(), 'colaborador')
  if (!colab) notFound()

  // Membros da org (p/ vincular a ficha ao login → habilita o ponto).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const membros = unwrap<MembroRef>(await (supabase as any)
    .from('organization_members').select('user_id, profiles!user_id(full_name, email)')
    .eq('org_id', orgId), 'membros')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const documentos = unwrap<Documento>(await (supabase as any)
    .from('rh_documento')
    .select('id, tipo, nome, competencia, created_at')
    .eq('colaborador_id', colaboradorId)
    .order('created_at', { ascending: false }), 'documentos')

  // Possíveis gestores: os outros colaboradores ativos da org.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gestores = unwrap<GestorRef>(await (supabase as any)
    .from('rh_colaborador')
    .select('id, nome')
    .eq('org_id', orgId).eq('arquivado', false).neq('id', colaboradorId)
    .order('nome', { ascending: true }), 'gestores')

  return <ColaboradorClient orgSlug={orgSlug} colab={colab} documentos={documentos} gestores={gestores} membros={membros} />
}
