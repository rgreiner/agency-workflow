import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { backendForRef } from '@/lib/task-folders'

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

/** Campanhas da org que TÊM pasta (id → nome + ref da pasta, p/ saber o backend). */
async function campanhasComDrive(supabase: SupabaseClient<Database>, orgId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: ws } = await sb.from('workspaces').select('id').eq('org_id', orgId)
  const wsIds = (ws ?? []).map((w: { id: string }) => w.id)
  const map = new Map<string, { name: string; folderId: string }>()
  if (wsIds.length === 0) return map

  const { data: camps } = await sb
    .from('campaigns').select('id, name, drive_folder_id').in('workspace_id', wsIds).not('drive_folder_id', 'is', null)
  for (const c of (camps ?? []) as { id: string; name: string; drive_folder_id: string }[]) {
    map.set(c.id, { name: c.name, folderId: c.drive_folder_id })
  }
  return map
}

/**
 * Tarefas ATIVAS cuja campanha tem pasta de Drive, mas a própria tarefa ficou sem
 * pasta vinculada — tipicamente uma provisão de 2º plano que falhou. Corrigível
 * gerando a pasta na hora.
 */

/**
 * Campanhas ATIVAS sem pasta vinculada. Não há correção automática — ninguém
 * pode inventar o link da pasta —, então o item leva para a campanha, onde se
 * cola o link.
 *
 * Vale como verificação porque a consequência é silenciosa: a campanha funciona
 * normalmente, as tarefas nascem, e só quando alguém vai procurar o arquivo
 * descobre que pasta nenhuma foi criada. O sublabel conta quantas tarefas ativas
 * já estão nessa situação, para separar "campanha vazia recém-criada" de
 * "campanha rodando sem pasta".
 */
async function checkCampanhasSemDrive(supabase: SupabaseClient<Database>, orgId: string, orgSlug: string): Promise<HealthCheck> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const items: HealthItem[] = []

  const { data: ws } = await sb.from('workspaces').select('id, name').eq('org_id', orgId).eq('archived', false)
  const wsRows = (ws ?? []) as { id: string; name: string }[]
  const wsNome = new Map(wsRows.map(w => [w.id, w.name]))

  if (wsRows.length > 0) {
    const { data: camps } = await sb
      .from('campaigns')
      .select('id, name, workspace_id, drive_folder_id')
      .in('workspace_id', wsRows.map(w => w.id))
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .limit(200)

    type Camp = { id: string; name: string; workspace_id: string; drive_folder_id: string | null }
    const semPasta = ((camps ?? []) as Camp[]).filter(c => !(c.drive_folder_id ?? '').trim())

    if (semPasta.length > 0) {
      // Quantas tarefas ativas cada uma já tem — é o que mede o estrago.
      const { data: tarefas } = await sb
        .from('activities')
        .select('campaign_id')
        .in('campaign_id', semPasta.map(c => c.id))
        .eq('archived', false)
        .neq('status', CONCLUIDO)
      const porCampanha = new Map<string, number>()
      for (const t of ((tarefas ?? []) as { campaign_id: string }[])) {
        porCampanha.set(t.campaign_id, (porCampanha.get(t.campaign_id) ?? 0) + 1)
      }

      for (const c of semPasta) {
        const n = porCampanha.get(c.id) ?? 0
        items.push({
          id: c.id,
          label: c.name,
          sublabel: `${wsNome.get(c.workspace_id) ?? 'Cliente'} · ${
            n === 0 ? 'sem tarefas ainda' : `${n} tarefa(s) ativa(s) sem pasta`}`,
          href: `/${orgSlug}/workspaces/${c.workspace_id}/campaigns/${c.id}`,
        })
      }
      // Primeiro as que já têm tarefa rodando: são as que doem.
    }
  }

  return {
    id: 'campanhas-sem-drive',
    label: 'Campanhas sem pasta vinculada',
    description: 'Campanhas ativas sem pasta vinculada: as tarefas delas não geram pasta nenhuma, e isso só aparece quando alguém vai procurar o arquivo. Abra a campanha e cole o link — ou ignore, se for campanha interna que não precisa de pasta.',
    items,
  }
}

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
        sublabel: camps.get(a.campaign_id)?.name,
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
    const { data: camps } = await sb.from('campaigns').select('id, name, drive_folder_id').in('workspace_id', wsIds)
    const campName = new Map<string, string>()
    const campFolder = new Map<string, string | null>()
    for (const c of (camps ?? []) as { id: string; name: string; drive_folder_id: string | null }[]) {
      campName.set(c.id, c.name); campFolder.set(c.id, c.drive_folder_id)
    }

    if (campName.size > 0) {
      const { data } = await sb
        .from('activities')
        .select('id, title, campaign_id, drive_folder_id, redacao_url, finalizacao_url, preview_url')
        .in('campaign_id', [...campName.keys()])
        .eq('archived', false)
        .not('drive_folder_id', 'is', null)
        .or('redacao_url.is.null,finalizacao_url.is.null,preview_url.is.null')
        .neq('status', CONCLUIDO)
        .order('created_at', { ascending: false })
        .limit(200)

      type Row = { id: string; title: string; campaign_id: string; drive_folder_id: string; redacao_url: string | null; finalizacao_url: string | null; preview_url: string | null }
      for (const a of (data ?? []) as Row[]) {
        // Pasta no storage errado (backend da tarefa ≠ da campanha) → tratada no
        // check 'vinculo-errado' com re-provisão; reler a subpasta aqui seria no
        // storage errado e não resolveria.
        const cf = campFolder.get(a.campaign_id)
        if (cf && backendForRef(a.drive_folder_id) !== backendForRef(cf)) continue
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
    description: 'Tarefas com pasta de Drive vinculada mas sem o link de Redação, Final ou Preview. Pasta antiga criada à mão pode não ter a subpasta (era opcional) — a correção cria o que faltar e vincula.',
    fixLabel: 'Re-vincular campos',
    items,
  }
}

/**
 * Tarefas ATIVAS cuja pasta está no STORAGE ERRADO: o backend da ref da tarefa
 * (S3/Drive) difere do backend da campanha. Acontece na transição — tarefa criada
 * enquanto a campanha estava no S3 e a campanha depois voltou pro Drive (ou vice-
 * versa). A tarefa aponta pro lugar errado e some dos outros checks (tem pasta E
 * tem link, só que do backend errado). Corrige gerando a pasta no backend da
 * campanha (regenera + regrava as refs).
 */
async function checkVinculoErrado(supabase: SupabaseClient<Database>, orgId: string): Promise<HealthCheck> {
  const camps = await campanhasComDrive(supabase, orgId)
  const items: HealthItem[] = []

  if (camps.size > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('activities')
      .select('id, title, campaign_id, drive_folder_id, status')
      .in('campaign_id', [...camps.keys()])
      .eq('archived', false)
      .not('drive_folder_id', 'is', null)
      .neq('status', CONCLUIDO)
      .order('created_at', { ascending: false })
      .limit(200)

    for (const a of (data ?? []) as { id: string; title: string; campaign_id: string; drive_folder_id: string }[]) {
      const camp = camps.get(a.campaign_id)
      if (!camp) continue
      if (backendForRef(a.drive_folder_id) !== backendForRef(camp.folderId)) {
        items.push({
          id: a.id,
          label: a.title || 'Sem título',
          sublabel: `${camp.name} — pasta no storage errado`,
          fix: { kind: 'provision-drive', activityId: a.id },
        })
      }
    }
  }

  return {
    id: 'vinculo-errado',
    label: 'Tarefas vinculadas no storage errado',
    description: 'Tarefas cuja pasta ficou num storage (S3/Drive) diferente do da campanha — criadas durante a transição. A correção gera a pasta no storage certo e revincula os campos.',
    fixLabel: 'Re-vincular',
    items,
  }
}

/**
 * Executor de agendados (crontab do VPS) parado. O job 'heartbeat' roda a cada
 * 30min; se a última execução tem +70min (ou nunca rodou), o cron não está batendo
 * na rota — e digest/lembretes/cobrança dependem dele.
 */
async function checkCronParado(supabase: SupabaseClient<Database>): Promise<HealthCheck> {
  const items: HealthItem[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).from('cron_runs').select('last_run_at').eq('job', 'heartbeat').maybeSingle()
    const last = data?.last_run_at ? new Date(data.last_run_at).getTime() : 0
    if (!last || Date.now() - last > 70 * 60 * 1000) {
      items.push({
        id: 'cron',
        label: last ? `Última execução há mais de 1h (${new Date(last).toLocaleString('pt-BR')})` : 'Nunca executou',
        sublabel: 'Confira o crontab do VPS batendo em /api/cron e a env CRON_SECRET.',
      })
    }
  } catch { /* tabela ainda não existe → não alarma */ }

  return {
    id: 'cron-parado',
    label: 'Executor de agendados',
    description: 'O cron do VPS que dispara digest, lembretes de prazo e cobrança. Deve rodar a cada poucos minutos.',
    items,
  }
}

/** Roda todas as verificações e devolve os checks (mesmo os zerados, p/ dar o “tudo certo”). */
export async function runHealthChecks(supabase: SupabaseClient<Database>, orgId: string, orgSlug: string): Promise<HealthCheck[]> {
  return Promise.all([
    checkCampanhasSemDrive(supabase, orgId, orgSlug),
    checkAtividadesSemDrive(supabase, orgId),
    checkVinculoErrado(supabase, orgId),
    checkCamposSemLink(supabase, orgId),
    checkCronParado(supabase),
    // Fase futura (quando o Financeiro/BTG existir): extrato sem conciliar, fee sem lançamento…
  ])
}
