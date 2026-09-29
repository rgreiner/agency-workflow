import 'server-only'
import { createClient } from '@/lib/supabase/server'

/** Cliente, campanhas ativas e se quem vê pode editar atas (portal_pode_gerir). */
export async function contextoReuniao(workspaceId: string) {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: workspace } = await supabase
    .from('workspaces').select('id, name, org_id').eq('id', workspaceId).maybeSingle()
  if (!workspace) return null
  const [{ data: campanhas }, { data: podeGerir }] = await Promise.all([
    supabase.from('campaigns').select('id, name')
      .eq('workspace_id', workspaceId).eq('archived', false).order('name'),
    sb.rpc('portal_pode_gerir', { p_org: workspace.org_id }),
  ])
  return {
    sb,
    clienteNome: workspace.name as string,
    campanhas: (campanhas ?? []) as { id: string; name: string }[],
    podeGerir: podeGerir === true,
  }
}
