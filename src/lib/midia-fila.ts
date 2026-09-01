import 'server-only'
import { statusDaMidia } from '@/lib/midia-hub'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Fonte única da fila da mídia — usada pela tela **Trabalhar** (`/midia`) e pela
 * **Visão geral** (`/midia/visao-geral`).
 *
 * A separação pedido × rotina mora aqui de propósito: as duas telas precisam
 * dela e, duplicada, uma passaria a discordar da outra na primeira mudança do
 * catálogo de rotinas.
 */

export interface FilaTarefa {
  id: string; titulo: string; status: string; prazo: string | null
  cliente: string; campanha: string
  workspaceId: string; campaignId: string
  pastaUrl: string | null; pastaPath: string | null
  redacaoUrl: string | null; previewUrl: string | null; finalUrl: string | null
  /** Preenchido só quando a tarefa é a instância viva de uma rotina do catálogo. */
  rotina: { nome: string; frequencia: string } | null
}

export interface FilaEntrega {
  id: string; titulo: string; cliente: string; veiculo: string | null
  prazoEnvio: string | null; conflito: boolean
  activityId: string | null
  tarefaTitulo: string | null; tarefaStatus: string | null
  /** A tarefa já chegou num status que a mídia opera (ou concluiu). */
  materialPronto: boolean
}

export interface StatusCfg { valor: string; label: string; bg: string; txt: string }

export interface OperacaoMidia {
  id: string; workspaceId: string; cliente: string; campaignId: string | null
}

export interface FilaMidia {
  tarefas: FilaTarefa[]
  entregas: FilaEntrega[]
  statusCfg: StatusCfg[]
  statusMidia: string[]
  operacoes: OperacaoMidia[]
}

export async function carregarFilaMidia(sb: any, orgId: string): Promise<FilaMidia> {
  const statusMidia = await statusDaMidia(sb, orgId)

  const [resOper, resStatus, resEntregas] = await Promise.all([
    sb.from('midia_cliente')
      .select('id, campaign_id, workspace_id, workspaces(name), midia_cliente_rotina(id, ativo, activity_id, midia_rotina(nome, frequencia))')
      .eq('org_id', orgId).eq('ativo', true),
    sb.from('org_status').select('valor, label, bg, txt').eq('org_id', orgId),
    sb.from('midia_entrega_view')
      .select('id, titulo, cliente, veiculo, prazo_envio, conflito_prazo, activity_id, tarefa_titulo, tarefa_status')
      .eq('org_id', orgId).eq('situacao', 'aguardando')
      .order('prazo_envio', { ascending: true, nullsFirst: false }),
  ])
  if (resOper.error) throw new Error(`Falha ao carregar as operações de mídia: ${resOper.error.message}`)
  if (resStatus.error) throw new Error(`Falha ao carregar os status: ${resStatus.error.message}`)
  if (resEntregas.error) throw new Error(`Falha ao carregar as entregas: ${resEntregas.error.message}`)

  const oper = (resOper.data ?? []) as any[]

  const { data: ativRaw, error: errAtiv } = await sb
    .from('activities')
    .select('id, title, status, due_date, drive_folder_url, drive_path, redacao_url, preview_url, finalizacao_url, campaign_id, campaigns!inner(id, name, workspace_id, workspaces!inner(id, name, org_id))')
    .eq('campaigns.workspaces.org_id', orgId)
    .eq('archived', false)
    .in('status', statusMidia)
    .order('due_date', { ascending: true, nullsFirst: false })
  if (errAtiv) throw new Error(`Falha ao carregar a fila da mídia: ${errAtiv.message}`)

  const todas = (ativRaw ?? []) as any[]

  // Qual tarefa é instância de rotina — o resto é pedido do time.
  const rotinaPorAtividade = new Map<string, { nome: string; frequencia: string }>()
  for (const o of oper) {
    for (const r of o.midia_cliente_rotina ?? []) {
      if (r.ativo && r.activity_id && r.midia_rotina) {
        rotinaPorAtividade.set(r.activity_id, {
          nome: r.midia_rotina.nome, frequencia: r.midia_rotina.frequencia,
        })
      }
    }
  }
  const campanhasOperacao = new Set(oper.map(o => o.campaign_id).filter(Boolean) as string[])

  const tarefas: FilaTarefa[] = todas.map(a => {
    // Campanha de operação sem vínculo de rotina ainda conta como rotina: é o
    // caso da tarefa recorrente criada à mão dentro da campanha do cliente.
    const rot = rotinaPorAtividade.get(a.id)
      ?? (campanhasOperacao.has(a.campaign_id) ? { nome: a.title, frequencia: '' } : null)
    return {
      id: a.id, titulo: rot?.nome || a.title, status: a.status, prazo: a.due_date ?? null,
      cliente: a.campaigns.workspaces.name, campanha: a.campaigns.name,
      workspaceId: a.campaigns.workspaces.id, campaignId: a.campaign_id,
      pastaUrl: a.drive_folder_url ?? null, pastaPath: a.drive_path ?? null,
      redacaoUrl: a.redacao_url ?? null, previewUrl: a.preview_url ?? null,
      finalUrl: a.finalizacao_url ?? null,
      rotina: rot,
    }
  })

  const prontos = new Set(statusMidia)
  const entregas: FilaEntrega[] = ((resEntregas.data ?? []) as any[]).map(e => ({
    id: e.id, titulo: e.titulo, cliente: e.cliente, veiculo: e.veiculo ?? null,
    prazoEnvio: e.prazo_envio ?? null, conflito: !!e.conflito_prazo,
    activityId: e.activity_id ?? null,
    tarefaTitulo: e.tarefa_titulo ?? null, tarefaStatus: e.tarefa_status ?? null,
    materialPronto: !e.tarefa_titulo || (!!e.tarefa_status && prontos.has(e.tarefa_status)),
  }))

  return {
    tarefas,
    entregas,
    statusCfg: (resStatus.data ?? []) as StatusCfg[],
    statusMidia,
    operacoes: oper.map(o => ({
      id: o.id, workspaceId: o.workspace_id,
      cliente: o.workspaces?.name ?? '—', campaignId: o.campaign_id ?? null,
    })),
  }
}
