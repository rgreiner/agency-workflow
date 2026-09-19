import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { porNome } from '@/lib/utils'

/**
 * Árvore de documentos (pastas + docs, ativos e arquivados) e os clientes que
 * servem de destino do "Mover para". Quem lê: o painel da sidebar (@painel/docs)
 * e a página do documento (acha a pasta-raiz para o aviso de acesso herdado).
 *
 * `cache` porque as duas rodam no MESMO request — o slot @painel e a página são
 * renderizados juntos — e a consulta sai uma vez só.
 */
export interface DocNo {
  id: string
  title: string
  visibility: string
  workspace_id: string | null
  parent_id: string | null
  is_folder: boolean
  archived: boolean
  briefing_workspace_id: string | null
  briefing_campaign_id: string | null
  workspaces: { name: string; color: string | null } | null
}

export interface ArvoreDocs {
  orgId: string
  docs: DocNo[]
  clientes: { id: string; name: string; color: string | null }[]
}

export const carregarArvoreDocs = cache(async (orgSlug: string): Promise<ArvoreDocs | null> => {
  const supabase = await createClient()
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  const [{ data: docs }, { data: clientes }] = await Promise.all([
    supabase
      .from('documents')
      .select('id, title, visibility, workspace_id, parent_id, is_folder, archived, briefing_workspace_id, briefing_campaign_id, workspaces!workspace_id(name, color)')
      .eq('org_id', org.id),
    supabase.from('workspaces').select('id, name, color').eq('org_id', org.id).neq('archived', true),
  ])

  // A–Z no JS, não no banco: o Postgres do VPS (Alpine/musl) ordena por BYTES e
  // jogava "Árvore" depois de "Zebra". Pastas antes de documentos.
  const lista = ((docs ?? []) as unknown as DocNo[])
    .sort((a, b) => Number(b.is_folder) - Number(a.is_folder) || porNome<DocNo>(d => d.title)(a, b))

  return {
    orgId: org.id,
    docs: lista,
    clientes: ((clientes ?? []) as ArvoreDocs['clientes']).sort(porNome(c => c.name)),
  }
})
