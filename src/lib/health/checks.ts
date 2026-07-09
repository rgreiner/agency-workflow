import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Verificações de consistência ("o que não ficou correto" que NÃO é exceção).
 * Ao contrário do system_errors — que é um LOG do que já falhou — aqui cada check
 * roda na hora e lista DIVERGÊNCIAS acionáveis (estado inconsistente que ninguém
 * percebeu). Cada item traz uma ação de correção que a UI dispara.
 *
 * Para adicionar um check novo: escrever uma função `check*(supabase, orgId)` que
 * devolve um HealthCheck e registrá-la em `runHealthChecks`. Mantê-los baratos
 * (sem chamada externa por item); trabalho pesado fica sob demanda no clique.
 */

/** Ação de correção que a UI sabe disparar (discriminada por `kind`). */
export type HealthFix =
  | { kind: 'provision-drive'; activityId: string }
  | { kind: 'relink-drive'; activityId: string }

export interface HealthItem {
  id: string
  label: string
  sublabel?: string
  href?: string        // link p/ abrir o item (ex.: a tarefa)
  fix?: HealthFix      // ação de correção in-loco
}

export interface HealthCheck {
  id: string
  label: string
  description: string
  fixLabel?: string    // rótulo do botão de correção (ex.: 'Gerar pasta')
  items: HealthItem[]
}

const CONCLUIDO = 'concluido'

/** IDs das campanhas da org que TÊM pasta de Drive (só elas deveriam ter tarefas com pasta). */
async function campanhasComDrive(supabase: SupabaseClient<Database>, orgId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: ws } = await sb.from('workspaces').select('id').eq('org_id', orgId)
  const wsIds = (ws ?? []).map((w: { id: string }) => w.id)
  if (wsIds.length === 0) return new Map<string, string>()

  const { data: camps } = await sb
    .from('campaigns').select('id, name').in('workspace_id', wsIds).not('drive_folder_id', 'is', null)
  const map = new Map<string, string>()
  for (const c of (camps ?? []) as { id: string; name: string }[]) map.set(c.id, c.name)
  return map
}

/**
 * Tarefas ATIVAS cuja campanha tem pasta de Drive, mas a própria tarefa ficou sem
 * pasta vinculada — tipicamente uma provisão de 2º plano que falhou. Corrigível
 * gerando a pasta na hora.
 */
async function checkAtividadesSemDrive(supabase: SupabaseClient<Database>, orgId: string): Promise<HealthCheck> {
  const camps = await campanhasComDrive(supabase, orgId)
  const items: HealthItem[] = []

  if (camps.size > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('activities')
      .select('id, title, campaign_id, status')
      .in('campaign_id', [...camps.keys()])
      .eq('archived', false)
      .is('drive_folder_id', null)
      .neq('status', CONCLUIDO)
      .order('created_at', { ascending: false })
      .limit(200)

    for (const a of (data ?? []) as { id: string; title: string; campaign_id: string; status: string }[]) {
      items.push({
        id: a.id,
        label: a.title || 'Sem título',
        sublabel: camps.get(a.campaign_id),
        fix: { kind: 'provision-drive', activityId: a.id },
      })
    }
  }

  return {
    id: 'atividades-sem-drive',
    label: 'Tarefas sem pasta de Drive',
    description: 'Tarefas ativas de campanhas com Drive vinculado que ficaram sem pasta própria (provisão que falhou).',
    fixLabel: 'Gerar pasta',
    items,
  }
}

/**
 * Tarefas ativas COM pasta de Drive mas com campo de link faltando (Redação/
 * Final/Preview) — provisão parcial. Corrigível relendo a pasta existente.
 */
async function checkCamposSemLink(supabase: SupabaseClient<Database>, orgId: string): Promise<HealthCheck> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const items: HealthItem[] = []

  const { data: ws } = await sb.from('workspaces').select('id').eq('org_id', orgId)
  const wsIds = (ws ?? []).map((w: { id: string }) => w.id)
  if (wsIds.length > 0) {
    const { data: camps } = await sb.from('campaigns').select('id, name').in('workspace_id', wsIds)
    const campName = new Map<string, string>()
    for (const c of (camps ?? []) as { id: string; name: string }[]) campName.set(c.id, c.name)

    if (campName.size > 0) {
      const { data } = await sb
        .from('activities')
        .select('id, title, campaign_id, redacao_url, finalizacao_url, preview_url')
        .in('campaign_id', [...campName.keys()])
        .eq('archived', false)
        .not('drive_folder_id', 'is', null)
        .or('redacao_url.is.null,finalizacao_url.is.null,preview_url.is.null')
        .neq('status', CONCLUIDO)
        .order('created_at', { ascending: false })
        .limit(200)

      type Row = { id: string; title: string; campaign_id: string; redacao_url: string | null; finalizacao_url: string | null; preview_url: string | null }
      for (const a of (data ?? []) as Row[]) {
        const faltam = [
          !a.redacao_url && 'Redação',
          !a.finalizacao_url && 'Final',
          !a.preview_url && 'Preview',
        ].filter(Boolean).join(', ')
        items.push({
          id: a.id,
          label: a.title || 'Sem título',
          sublabel: `${campName.get(a.campaign_id) ?? ''} — sem link: ${faltam}`,
          fix: { kind: 'relink-drive', activityId: a.id },
        })
      }
    }
  }

  return {
    id: 'campos-sem-link',
    label: 'Tarefas com campos sem link',
    description: 'Tarefas com pasta de Drive vinculada mas sem o link de Redação, Final ou Preview — a correção relê a pasta e regrava os links.',
    fixLabel: 'Re-vincular campos',
    items,
  }
}

/** Roda todas as verificações e devolve os checks (mesmo os zerados, p/ dar o “tudo certo”). */
export async function runHealthChecks(supabase: SupabaseClient<Database>, orgId: string): Promise<HealthCheck[]> {
  return Promise.all([
    checkAtividadesSemDrive(supabase, orgId),
    checkCamposSemLink(supabase, orgId),
    // Fase futura (quando o Financeiro/BTG existir): extrato sem conciliar, fee sem lançamento…
  ])
}
