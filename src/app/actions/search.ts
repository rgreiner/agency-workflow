'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

export interface ActivitySearchResult {
  id: string
  title: string
  status: string
  archived: boolean
  campaignId: string
  campaignName: string
  workspaceId: string
  workspaceName: string
}

export async function searchActivities(
  orgSlug: string,
  query: string,
  includeArchived = false,
): Promise<ActivitySearchResult[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return []

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .single()
  if (!org) return []

  // RPC com unaccent: ignora acentos e busca título + briefing.
  const { data } = await supabase.rpc('search_activities', {
    p_user_id: user.id,
    p_org_id: org.id,
    p_query: q,
    p_include_archived: includeArchived,
  })

  return (data ?? []).map(a => ({
    id: a.id,
    title: a.title,
    status: a.status,
    archived: a.archived,
    campaignId: a.campaign_id,
    campaignName: a.campaign_name,
    workspaceId: a.workspace_id,
    workspaceName: a.workspace_name,
  }))
}

// ── Busca em Documentos, Mídias e Produção (além de Atividades) ──────────────
export interface ExtraSearchResult {
  id: string
  type: 'doc' | 'midia' | 'producao'
  title: string
  hint?: string          // cliente, quando houver
  href: string           // caminho absoluto já com /${orgSlug}
  archived: boolean
}

// tipo da mídia → pasta de detalhe; produção usa o próprio tipo como pasta.
const MIDIA_ROUTE: Record<string, string> = {
  impressa_jornal: 'impressa', impressa_revista: 'impressa',
  eletronica: 'eletronica', externa: 'externas', digital: 'digitais',
}
const PROD_ROUTES = new Set(['orcamento', 'pedido', 'fee', 'proposta'])

export async function searchExtras(
  orgSlug: string,
  query: string,
  includeArchived = false,
): Promise<ExtraSearchResult[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return []

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return []

  const base = `/${orgSlug}`
  const like = `%${q}%`
  // Tabelas fora dos tipos gerados (mesmo padrão do resto do app). RLS já limita à org.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [docs, midias, prod] = await Promise.all([
    sb.from('documents').select('id, title, archived').eq('org_id', org.id).eq('is_folder', false).ilike('title', like).limit(6),
    sb.from('midias').select('id, titulo, tipo, archived, workspace_id').eq('org_id', org.id).ilike('titulo', like).limit(6),
    sb.from('producao').select('id, titulo, tipo, archived, workspace_id').eq('org_id', org.id).ilike('titulo', like).limit(6),
  ])

  // Nome do cliente (uma consulta só) p/ mostrar como contexto.
  const wsIds = [
    ...(midias.data ?? []).map((m: { workspace_id: string }) => m.workspace_id),
    ...(prod.data ?? []).map((p: { workspace_id: string }) => p.workspace_id),
  ].filter(Boolean)
  const wsName = new Map<string, string>()
  if (wsIds.length) {
    const { data: ws } = await sb.from('workspaces').select('id, name').in('id', [...new Set(wsIds)])
    for (const w of ws ?? []) wsName.set(w.id, w.name)
  }

  const out: ExtraSearchResult[] = []
  for (const d of docs.data ?? []) {
    if (!includeArchived && d.archived) continue
    out.push({ id: d.id, type: 'doc', title: d.title || 'Sem título', href: `${base}/docs/${d.id}`, archived: !!d.archived })
  }
  for (const m of midias.data ?? []) {
    if (!includeArchived && m.archived) continue
    const route = MIDIA_ROUTE[m.tipo as string] ?? 'simplificada'
    out.push({ id: m.id, type: 'midia', title: m.titulo, hint: wsName.get(m.workspace_id), href: `${base}/midias/${route}/${m.id}`, archived: !!m.archived })
  }
  for (const p of prod.data ?? []) {
    if (!includeArchived && p.archived) continue
    const route = PROD_ROUTES.has(p.tipo) ? p.tipo : 'orcamento'
    out.push({ id: p.id, type: 'producao', title: p.titulo, hint: wsName.get(p.workspace_id), href: `${base}/producao/${route}/${p.id}`, archived: !!p.archived })
  }
  return out
}
