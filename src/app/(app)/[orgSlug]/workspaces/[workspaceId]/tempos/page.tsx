import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { notFound, redirect } from 'next/navigation'
import { buildSegmentos, type Segmento, type TransicaoHist } from '@/lib/status-tempos'
import { getStatusConfig } from '@/lib/status'
import { TemposClient, type TarefaTempos } from './TemposClient'

export const metadata = { title: 'Tempos — Flow' }

/**
 * Visão "Tempos" do cliente: cada tarefa vira uma barra segmentada pelo tempo
 * que passou em cada status (reconstruído do activity_history), inclusive idas
 * e voltas. Arquivadas ENTRAM: concluída arquivada é justamente o histórico do
 * processo — esta tela é análise, não pauta.
 */
export default async function TemposPage({
  params,
}: {
  params: Promise<{ orgSlug: string; workspaceId: string }>
}) {
  const { orgSlug, workspaceId } = await params
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) redirect('/login')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: workspace } = await supabase
    .from('workspaces').select('id, name, org_id').eq('id', workspaceId).single()
  if (!workspace) notFound()

  const { data: campanhas } = await supabase
    .from('campaigns').select('id, name').eq('workspace_id', workspaceId).order('name')
  const campIds = (campanhas ?? []).map(c => c.id)

  const { data: acts } = campIds.length
    ? await sb
        .from('activities')
        .select('id, title, status, created_at, archived, campaign_id')
        .in('campaign_id', campIds)
        .order('created_at', { ascending: false })
    : { data: [] }

  const actIds = ((acts ?? []) as { id: string }[]).map(a => a.id)
  const { data: hist } = actIds.length
    ? await sb
        .from('activity_history')
        .select('activity_id, from_status, to_status, changed_at')
        .in('activity_id', actIds)
        .order('changed_at', { ascending: true })
    : { data: [] }

  const statusCfg = await getStatusConfig(supabase, workspace.org_id as string)
  const finais = new Set(statusCfg.filter(s => s.group === 'done').map(s => s.value as string))

  const porTarefa = new Map<string, TransicaoHist[]>()
  for (const h of (hist ?? []) as (TransicaoHist & { activity_id: string })[]) {
    const arr = porTarefa.get(h.activity_id) ?? []
    arr.push({ from_status: h.from_status, to_status: h.to_status, changed_at: h.changed_at })
    porTarefa.set(h.activity_id, arr)
  }

  const agora = new Date().toISOString()
  const campNome = Object.fromEntries((campanhas ?? []).map(c => [c.id, c.name]))

  const tarefas: TarefaTempos[] = ((acts ?? []) as {
    id: string; title: string; status: string; created_at: string; archived: boolean; campaign_id: string
  }[]).map(a => {
    const segs: Segmento[] = buildSegmentos(a.created_at, a.status, porTarefa.get(a.id) ?? [], agora, finais)
    return {
      id: a.id,
      titulo: a.title,
      campanhaId: a.campaign_id,
      campanha: campNome[a.campaign_id] ?? '—',
      statusAtual: a.status,
      arquivada: a.archived,
      criada: a.created_at,
      segmentos: segs,
    }
  }).filter(t => t.segmentos.length > 0)

  return (
    <TemposClient
      orgSlug={orgSlug}
      workspaceId={workspaceId}
      clienteNome={workspace.name}
      campanhas={(campanhas ?? []) as { id: string; name: string }[]}
      tarefas={tarefas}
      agora={agora}
    />
  )
}
