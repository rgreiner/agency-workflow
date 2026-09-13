import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { usoDaPauta } from '@/app/actions/org-pauta'
import { PautaClient } from './PautaClient'
import type { OrgPautaOpcaoRow } from '@/lib/atividade-titulo'

export const metadata = { title: 'Configurações — Pauta' }

/**
 * Configurações → Pauta: as sugestões que compõem o título da tarefa
 * ("AAMMDD - Veículo - Formato - Objetivo - Título da demanda").
 *
 * A tela carrega duas coisas: o cadastro e o USO real de cada opção, medido nos
 * títulos já gravados. É o que faz a lista se corrigir sozinha em vez de inchar —
 * dá pra ver o que ninguém usa e o que a equipe digita porque falta na lista.
 */
export default async function PautaPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) redirect('/login')

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) redirect('/')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any)
    .from('organization_members').select('role').eq('org_id', org.id).eq('user_id', user.id).single() as { data: { role: string } | null }
  if (!m || !['owner', 'admin'].includes(m.role)) redirect(`/${orgSlug}/settings/membros`)

  const [{ data: opcoes }, uso] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('org_pauta_opcao').select('id, campo, valor, ordem')
      .eq('org_id', org.id).order('campo').order('ordem') as Promise<{ data: OrgPautaOpcaoRow[] | null }>,
    usoDaPauta(org.id),
  ])

  return <PautaClient orgSlug={orgSlug} orgId={org.id} opcoes={opcoes ?? []} uso={uso} />
}
