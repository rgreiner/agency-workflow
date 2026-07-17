import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { updateMidia } from '@/app/actions/midia'
import { midiaTextoLegalPadrao } from '@/lib/agency'
import { MidiaForm, type ClienteOpt, type VeiculoOpt, type MemberOpt, type MidiaValues } from '../MidiaForm'

function s(v: unknown): string {
  return v == null ? '' : String(v)
}
function num2br(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (isNaN(n)) return ''
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function EditarMidiaPage({
  params,
}: {
  params: Promise<{ orgSlug: string; midiaId: string }>
}) {
  const { orgSlug, midiaId } = await params
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) redirect('/login')

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) redirect('/')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any)
    .from('midias').select('*').eq('id', midiaId).single()
  if (!m) notFound()

  // Seletores
  const { data: wsRaw } = await supabase
    .from('workspaces')
    .select('id, name, campaigns(id, name)')
    .eq('org_id', org.id)
    .eq('archived', false)
    .eq('campaigns.archived', false)
    .order('name')
  const clientes: ClienteOpt[] = (wsRaw ?? []).map(w => ({
    id: w.id, name: w.name,
    campaigns: (w.campaigns as unknown as { id: string; name: string }[]) ?? [],
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: veicRaw } = await (supabase as any)
    .from('veiculos').select('id, name, commission_pct')
    .eq('org_id', org.id).eq('archived', false).order('name')
  const veiculos = (veicRaw ?? []) as VeiculoOpt[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memRaw } = await (supabase as any)
    .from('organization_members')
    .select('profiles!user_id(id, full_name, email)')
    .eq('org_id', org.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members: MemberOpt[] = (memRaw ?? []).map((mm: any) => ({
    id: mm.profiles?.id, name: mm.profiles?.full_name ?? mm.profiles?.email ?? '—',
  })).filter((mm: MemberOpt) => mm.id)

  const initial: MidiaValues = {
    workspace_id: s(m.workspace_id),
    campaign_id: s(m.campaign_id),
    veiculo_id: s(m.veiculo_id),
    tipo: s(m.tipo) || 'impressa_jornal',
    serie: s(m.serie),
    titulo: s(m.titulo),
    emissao: s(m.emissao),
    job: s(m.job),
    aut_veiculo: s(m.aut_veiculo),
    codigo_identificador: s(m.codigo_identificador),
    nota_fiscal: s(m.nota_fiscal),
    pecas: s(m.pecas),
    praca: s(m.praca),
    abrangencia: s(m.abrangencia) || 'local',
    valor: num2br(m.valor),
    desconto_pct: num2br(m.desconto_pct),
    faturamento: s(m.faturamento) || 'valor_bruto',
    prazo: s(m.prazo) || 'a_vista',
    data_base: s(m.data_base),
    dias_agencia: s(m.dias_agencia) || '7',
    primeira_veiculacao: s(m.primeira_veiculacao),
    ultima_veiculacao: s(m.ultima_veiculacao),
    contato: s(m.contato),
    responsavel_id: s(m.responsavel_id),
    situacao: s(m.situacao) || 'em_aberto',
    observacao: s(m.observacao),
    texto_legal: s(m.texto_legal),
  }

  const today = new Date().toISOString().slice(0, 10)
  const defaultTextoLegal = await midiaTextoLegalPadrao(supabase, org.id)

  return (
    <MidiaForm
      clientes={clientes}
      veiculos={veiculos}
      members={members}
      defaultResponsavelId={user.id}
      today={today}
      initial={initial}
      submitLabel="Salvar"
      defaultTextoLegal={defaultTextoLegal}
      onSubmit={updateMidia.bind(null, orgSlug, midiaId)}
    />
  )
}
