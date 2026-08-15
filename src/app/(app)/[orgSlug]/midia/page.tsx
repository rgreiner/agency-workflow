import Link from 'next/link'
import { CalendarClock, Inbox, Truck, Users } from 'lucide-react'
import { assertMidiaAccess, statusDaMidia } from '@/lib/midia-hub'
import { unwrap } from '@/lib/supabase/unwrap'
import { PainelMidia, type PedidoRow, type RotinaRow } from './PainelMidia'
import { EntregasResumo, type EntregaResumoRow } from './EntregasResumo'

export const metadata = { title: 'Mídia — Painel' }

interface AtividadeRow {
  id: string; title: string; status: string; due_date: string | null
  drive_folder_url: string | null; drive_path: string | null
  redacao_url: string | null; preview_url: string | null; finalizacao_url: string | null
  campaign_id: string
}

export default async function MidiaPainelPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertMidiaAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const statuses = await statusDaMidia(sb, orgId)

  // Campanhas de operação (as rotinas) x resto da pauta (os pedidos): a fila da
  // mídia é o que o time MANDOU para ela, não o que ela mesma agendou.
  const [resOper, resStatus, resEntregas] = await Promise.all([
    sb.from('midia_cliente')
      .select('id, ano, campaign_id, workspace_id, workspaces(name), midia_cliente_rotina(id, ativo, activity_id, midia_rotina(nome, frequencia))')
      .eq('org_id', orgId).eq('ativo', true),
    sb.from('org_status').select('valor, label, bg, txt').eq('org_id', orgId),
    sb.from('midia_entrega_view')
      .select('id, titulo, cliente, veiculo, prazo_envio, situacao, conflito_prazo, tarefa_titulo, tarefa_status, tarefa_prazo')
      .eq('org_id', orgId).eq('situacao', 'aguardando')
      .order('prazo_envio', { ascending: true, nullsFirst: false }),
  ])
  const operacoes = unwrap<{
    id: string; ano: number; campaign_id: string | null; workspace_id: string
    workspaces: { name: string } | null
    midia_cliente_rotina: { id: string; ativo: boolean; activity_id: string | null; midia_rotina: { nome: string; frequencia: string } | null }[]
  }>(resOper, 'operações de mídia')
  const statusCfg = unwrap<{ valor: string; label: string; bg: string; txt: string }>(resStatus, 'status')
  const entregasRaw = unwrap<{
    id: string; titulo: string; cliente: string; veiculo: string | null
    prazo_envio: string | null; situacao: string; conflito_prazo: boolean | null
    tarefa_titulo: string | null; tarefa_status: string | null; tarefa_prazo: string | null
  }>(resEntregas, 'entregas')

  const campanhasOperacao = new Set(operacoes.map(o => o.campaign_id).filter(Boolean) as string[])
  const rotinaActivityIds = operacoes.flatMap(o =>
    o.midia_cliente_rotina.filter(r => r.ativo && r.activity_id).map(r => r.activity_id as string))

  // Tudo que está num status de mídia, ativo e com prazo conhecido.
  const { data: ativRaw, error: errAtiv } = await sb
    .from('activities')
    .select('id, title, status, due_date, drive_folder_url, drive_path, redacao_url, preview_url, finalizacao_url, campaign_id, campaigns!inner(id, name, workspace_id, workspaces!inner(id, name, org_id))')
    .eq('campaigns.workspaces.org_id', orgId)
    .eq('archived', false)
    .in('status', statuses)
    .order('due_date', { ascending: true, nullsFirst: false })
  if (errAtiv) throw new Error(`Falha ao carregar a fila da mídia: ${errAtiv.message}`)

  type Raw = AtividadeRow & { campaigns: { id: string; name: string; workspace_id: string; workspaces: { id: string; name: string } } }
  const todas = (ativRaw ?? []) as Raw[]

  const pedidos: PedidoRow[] = todas
    .filter(a => !campanhasOperacao.has(a.campaign_id))
    .map(a => ({
      id: a.id, titulo: a.title, status: a.status, prazo: a.due_date,
      cliente: a.campaigns.workspaces.name, campanha: a.campaigns.name,
      workspaceId: a.campaigns.workspaces.id, campaignId: a.campaign_id,
      pastaUrl: a.drive_folder_url, pastaPath: a.drive_path,
      redacaoUrl: a.redacao_url, previewUrl: a.preview_url, finalUrl: a.finalizacao_url,
    }))

  // Rotinas: a tarefa viva de cada vínculo ativo (o prazo delas é o calendário da mídia).
  const porId = new Map(todas.map(a => [a.id, a]))
  const rotinas: RotinaRow[] = []
  for (const o of operacoes) {
    for (const r of o.midia_cliente_rotina) {
      if (!r.ativo || !r.activity_id) continue
      const a = porId.get(r.activity_id)
      if (!a) continue
      rotinas.push({
        id: a.id, titulo: r.midia_rotina?.nome ?? a.title, status: a.status, prazo: a.due_date,
        cliente: o.workspaces?.name ?? '—', frequencia: r.midia_rotina?.frequencia ?? '',
        workspaceId: o.workspace_id, campaignId: a.campaign_id,
      })
    }
  }
  rotinas.sort((a, b) => (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999'))

  const entregas: EntregaResumoRow[] = entregasRaw.map(e => ({
    id: e.id, titulo: e.titulo, cliente: e.cliente, veiculo: e.veiculo,
    prazoEnvio: e.prazo_envio, conflito: !!e.conflito_prazo,
    tarefaTitulo: e.tarefa_titulo,
    // Material pronto = a tarefa já chegou num status que a mídia opera.
    materialPronto: !e.tarefa_titulo || (!!e.tarefa_status && statuses.includes(e.tarefa_status)),
  }))
  void rotinaActivityIds

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Mídia</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            O que o time mandou para a mídia e as rotinas de cada cliente.
          </p>
        </div>
        <Link href={`/${orgSlug}/midia/clientes`}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
          <Users className="w-4 h-4" /> Clientes e rotinas
        </Link>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <Resumo icon={<Inbox className="w-4 h-4" />} label="Pedidos na fila" valor={pedidos.length} />
        <Resumo icon={<CalendarClock className="w-4 h-4" />} label="Rotinas ativas" valor={rotinas.length} />
        <Resumo icon={<Truck className="w-4 h-4" />} label="Entregas pendentes" valor={entregas.length} />
        <Resumo icon={<Users className="w-4 h-4" />} label="Clientes com mídia" valor={operacoes.length} />
      </div>

      <EntregasResumo orgSlug={orgSlug} entregas={entregas} />

      <PainelMidia orgSlug={orgSlug} pedidos={pedidos} rotinas={rotinas} statusCfg={statusCfg} />
    </div>
  )
}

function Resumo({ icon, label, valor }: { icon: React.ReactNode; label: string; valor: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-[11px] text-gray-400 inline-flex items-center gap-1.5">{icon} {label}</p>
      <p className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{valor}</p>
    </div>
  )
}
