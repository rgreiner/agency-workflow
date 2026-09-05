import 'server-only'
import { statusDaMidia } from '@/lib/midia-hub'
import { contatoDoVeiculo } from '@/lib/veiculo-contato'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Fonte única da fila da mídia — usada pela tela **Trabalhar** (`/midia`), pela
 * **Visão geral** (`/midia/visao-geral`) e pela Agenda (itens datados).
 *
 * A separação pedido × rotina mora aqui de propósito: as telas precisam
 * dela e, duplicada, uma passaria a discordar da outra na primeira mudança do
 * catálogo de rotinas.
 */

/** Item do checklist da tarefa como a fila enxerga: texto, data opcional e feito. */
export interface ChecklistItemFila { id: string; texto: string; data: string | null; feito: boolean }

export interface ChecklistResumo { feitos: number; total: number; itens: ChecklistItemFila[] }

export interface FilaTarefa {
  id: string; titulo: string; status: string; prazo: string | null
  cliente: string; campanha: string
  workspaceId: string; campaignId: string
  pastaUrl: string | null; pastaPath: string | null
  redacaoUrl: string | null; previewUrl: string | null; finalUrl: string | null
  /** Preenchido só quando a tarefa é a instância viva de uma rotina do catálogo. */
  rotina: { nome: string; frequencia: string } | null
  /** Quem está na tarefa — é o que o filtro "Eu" lê. */
  assigneeIds: string[]
  /** Quem criou a tarefa (nome), para o "pedido por" do bloco de pedidos. */
  pedidoPor: string | null
  /** Primeira vez que a tarefa entrou num status da mídia; null quando não há histórico. */
  entrouEm: string | null
  criadaEm: string
  prioridade: string
  complexidade: string
  checklist: ChecklistResumo
}

export interface FilaEntrega {
  id: string; titulo: string; cliente: string; veiculo: string | null
  /** E-mail e telefone do cadastro do veículo (mig. 278), quando a entrega aponta para ele. */
  veiculoContato: string | null
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

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/

/** Lê o jsonb do checklist sem confiar no formato: item sem texto é ignorado. */
export function resumoChecklist(raw: unknown): ChecklistResumo {
  const itens: ChecklistItemFila[] = []
  if (Array.isArray(raw)) {
    for (const it of raw as any[]) {
      const texto = String(it?.text ?? '').trim()
      if (!it?.id || !texto) continue
      const data = typeof it.data === 'string' && DATA_ISO.test(it.data) ? it.data : null
      itens.push({ id: String(it.id), texto, data, feito: !!it.done })
    }
  }
  return { feitos: itens.filter(i => i.feito).length, total: itens.length, itens }
}

export async function carregarFilaMidia(sb: any, orgId: string): Promise<FilaMidia> {
  const statusMidia = await statusDaMidia(sb, orgId)

  const [resOper, resStatus, resEntregas] = await Promise.all([
    sb.from('midia_cliente')
      .select('id, campaign_id, workspace_id, workspaces(name), midia_cliente_rotina(id, ativo, activity_id, midia_rotina(nome, frequencia))')
      .eq('org_id', orgId).eq('ativo', true),
    sb.from('org_status').select('valor, label, bg, txt').eq('org_id', orgId),
    sb.from('midia_entrega_view')
      .select('id, titulo, cliente, veiculo, veiculo_emails, veiculo_telefones, prazo_envio, conflito_prazo, activity_id, tarefa_titulo, tarefa_status')
      .eq('org_id', orgId).eq('situacao', 'aguardando')
      .order('prazo_envio', { ascending: true, nullsFirst: false }),
  ])
  if (resOper.error) throw new Error(`Falha ao carregar as operações de mídia: ${resOper.error.message}`)
  if (resStatus.error) throw new Error(`Falha ao carregar os status: ${resStatus.error.message}`)
  if (resEntregas.error) throw new Error(`Falha ao carregar as entregas: ${resEntregas.error.message}`)

  const oper = (resOper.data ?? []) as any[]

  const { data: ativRaw, error: errAtiv } = await sb
    .from('activities')
    .select('id, title, status, due_date, created_at, created_by, priority, complexity, checklist, drive_folder_url, drive_path, redacao_url, preview_url, finalizacao_url, campaign_id, activity_assignees(user_id), campaigns!inner(id, name, workspace_id, workspaces!inner(id, name, org_id))')
    .eq('campaigns.workspaces.org_id', orgId)
    .eq('archived', false)
    .in('status', statusMidia)
    .order('due_date', { ascending: true, nullsFirst: false })
  if (errAtiv) throw new Error(`Falha ao carregar a fila da mídia: ${errAtiv.message}`)

  const todas = (ativRaw ?? []) as any[]
  const ids = todas.map(a => a.id as string)

  // Quem pediu e quando entrou na mídia — duas consultas pequenas, só sobre a fila.
  // A entrada é a PRIMEIRA vez num status da mídia (uma peça pode ir e voltar
  // entre validação e implantação; o que interessa é desde quando está aqui).
  const criadores = [...new Set(todas.map(a => a.created_by).filter(Boolean) as string[])]
  const [resPerfis, resHist] = ids.length
    ? await Promise.all([
        criadores.length
          ? sb.from('profiles').select('id, full_name').in('id', criadores)
          : Promise.resolve({ data: [], error: null }),
        sb.from('activity_history').select('activity_id, changed_at')
          .in('activity_id', ids).in('to_status', statusMidia)
          .order('changed_at', { ascending: true }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]
  const nomePorId = new Map<string, string>(
    ((resPerfis.data ?? []) as any[]).map(p => [p.id, p.full_name ?? '']))
  const entradaPorAtividade = new Map<string, string>()
  for (const h of (resHist.data ?? []) as any[]) {
    if (!entradaPorAtividade.has(h.activity_id)) {
      entradaPorAtividade.set(h.activity_id, String(h.changed_at).slice(0, 10))
    }
  }

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
      assigneeIds: ((a.activity_assignees ?? []) as any[]).map(x => x.user_id as string).filter(Boolean),
      pedidoPor: a.created_by ? (nomePorId.get(a.created_by) || null) : null,
      entrouEm: entradaPorAtividade.get(a.id) ?? null,
      criadaEm: String(a.created_at ?? '').slice(0, 10),
      prioridade: a.priority ?? 'medium',
      complexidade: a.complexity ?? 'medium',
      checklist: resumoChecklist(a.checklist),
    }
  })

  const prontos = new Set(statusMidia)
  const entregas: FilaEntrega[] = ((resEntregas.data ?? []) as any[]).map(e => ({
    id: e.id, titulo: e.titulo, cliente: e.cliente, veiculo: e.veiculo ?? null,
    veiculoContato: contatoDoVeiculo(e.veiculo_emails, e.veiculo_telefones),
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
