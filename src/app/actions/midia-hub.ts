'use server'

// Ações do Hub de Mídia (migration 234). Toda escrita passa por RPC com guard
// `midia_can` — a tela nunca escreve direto nas tabelas.

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { dispatchPushNotificacoes } from '@/lib/push'
import { assertMidiaAccess, statusDaMidia } from '@/lib/midia-hub'
import { resumoChecklist } from '@/lib/midia-fila'
import { dataValida } from '@/lib/checklist-datas'
import { provisionActivitiesDrive } from '@/lib/drive-provision'
import { porNome } from '@/lib/utils'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Liga a operação de mídia num cliente (cria a campanha de operação do ano). */
export async function ativarClienteMidia(orgSlug: string, workspaceId: string, ano?: number) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { data, error } = await (supabase as any)
    .rpc('midia_ativar_cliente', { p_workspace_id: workspaceId, p_ano: ano ?? null })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/clientes`)
  revalidatePath(`/${orgSlug}/midia`)
  revalidatePath(`/${orgSlug}/midia/visao-geral`)
  return { id: data as string }
}

/** Cria as tarefas recorrentes das rotinas escolhidas. Devolve quantas nasceram. */
export async function aplicarRotinas(
  orgSlug: string, midiaClienteId: string, rotinaIds: string[], responsavel?: string | null,
) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  if (rotinaIds.length === 0) return { criadas: 0 }
  const { data, error } = await (supabase as any).rpc('midia_aplicar_rotinas', {
    p_midia_cliente_id: midiaClienteId,
    p_rotina_ids: rotinaIds,
    p_responsavel: responsavel || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/clientes`)
  revalidatePath(`/${orgSlug}/midia`)
  revalidatePath(`/${orgSlug}/midia/visao-geral`)
  return { criadas: (data as number) ?? 0 }
}

/** Desliga a rotina do cliente — a tarefa em andamento continua existindo. */
export async function desativarRotina(orgSlug: string, vinculoId: string) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { error } = await (supabase as any).rpc('midia_desativar_rotina', { p_id: vinculoId })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/clientes`)
  return {}
}

/** Links fixos da operação (plano, tabela de specs, CRM, pasta no drive Mídia). */
export async function salvarDadosOperacao(orgSlug: string, id: string, dados: {
  plano_url?: string | null
  specs_url?: string | null
  crm_url?: string | null
  drive_folder_id?: string | null
  observacao?: string | null
}) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { error } = await (supabase as any).rpc('midia_atualizar_cliente', {
    p_id: id,
    p_plano_url: dados.plano_url ?? null,
    p_specs_url: dados.specs_url ?? null,
    p_crm_url: dados.crm_url ?? null,
    p_drive_folder_id: dados.drive_folder_id ?? null,
    p_observacao: dados.observacao ?? null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/clientes`)
  return {}
}

// ── Entregas (migration 236) ─────────────────────────────────────────────────

export interface EntregaInput {
  id?: string | null
  workspaceId: string
  titulo: string
  veiculo?: string | null
  /** Veículo do cadastro (mig. 278). Com ele, o nome canônico vence o texto. */
  veiculoId?: string | null
  formato?: string | null
  prazoEnvio?: string | null
  activityId?: string | null
  campaignId?: string | null
  observacao?: string | null
  /**
   * Campanha onde a entrega deve ABRIR um briefing novo (em vez de vincular uma
   * tarefa que já existe). Sem isso, `activityId` vazio continua significando
   * "material pronto, não passa pela criação" — os dois vazios eram o mesmo
   * estado e por isso nada chegava no atendimento.
   */
  briefingEmCampanha?: string | null
}

const hojeBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

/**
 * Nome da tarefa no padrão da casa: DATA - VEÍCULO - FORMATO - JOB, pulando o
 * que estiver vazio. A data é a do dia em que a tarefa nasce (convenção das
 * pastas do Drive, YYMMDD) — e como o título já começa com 6 dígitos, o
 * `taskFolderName` mantém exatamente este nome na pasta em vez de prefixar de novo.
 *
 * Nada é deduplicado: se o nome da entrega já repete o veículo, o título repete
 * também. Decisão do Rafael (01/09) — previsível ganha de curto.
 */
function tituloDaTarefa(e: EntregaInput): string {
  const d = hojeBR()
  const data = `${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}`
  return [data, e.veiculo, e.formato, e.titulo]
    .map(p => (p ?? '').trim())
    .filter(Boolean)
    .join(' - ')
}

/**
 * Cria ou edita a entrega. O prazo aqui é o da MÍDIA — nunca toca o de uma
 * tarefa que já existe.
 *
 * Com `briefingEmCampanha`, a entrega ABRE a tarefa: nasce em Briefing, sem
 * responsável (cai na fila "Sem responsável" do atendimento, mesma régua da
 * mig. 253) e com o prazo do envio. A entrega é gravada ANTES da tarefa de
 * propósito — se a criação falhar, sobra uma entrega sem vínculo (recuperável
 * reabrindo o modal) em vez de uma tarefa órfã que ninguém liga a nada.
 */
export async function salvarEntrega(orgSlug: string, e: EntregaInput) {
  const { supabase, userId } = await assertMidiaAccess(orgSlug)
  const abrirEm = (e.briefingEmCampanha ?? '').trim()

  // Com veículo do cadastro, o nome canônico é o que vai para o título da tarefa
  // (o cliente manda o rótulo, mas quem decide é o cadastro).
  if (e.veiculoId) {
    const { data: v } = await (supabase as any).from('veiculos').select('name').eq('id', e.veiculoId).maybeSingle()
    if (v?.name) e = { ...e, veiculo: v.name as string }
  }

  const { data, error } = await (supabase as any).rpc('midia_entrega_salvar', {
    p_id: e.id || null,
    p_workspace_id: e.workspaceId,
    p_titulo: e.titulo,
    p_veiculo: e.veiculo || null,
    p_formato: e.formato || null,
    p_prazo_envio: e.prazoEnvio || null,
    p_activity_id: abrirEm ? null : (e.activityId || null),
    p_campaign_id: abrirEm || e.campaignId || null,
    p_observacao: e.observacao || null,
    p_veiculo_id: e.veiculoId || null,
  })
  if (error) return { error: error.message }
  const id = data as string

  let briefingErro: string | undefined
  let briefingId: string | undefined
  if (abrirEm) {
    const r = await abrirBriefing(supabase, userId, orgSlug, id, abrirEm, e)
    briefingErro = r.erro
    briefingId = r.activityId
  }

  revalidatePath(`/${orgSlug}/midia/entregas`)
  revalidatePath(`/${orgSlug}/midia`)
  revalidatePath(`/${orgSlug}/midia/visao-geral`)
  if (abrirEm) revalidatePath(`/${orgSlug}`, 'layout')
  return { id, briefingErro, briefingId }
}

/** Cria a tarefa de briefing e devolve o vínculo pra entrega. Não lança. */
async function abrirBriefing(
  supabase: any, userId: string, orgSlug: string,
  entregaId: string, campaignId: string, e: EntregaInput,
): Promise<{ activityId?: string; erro?: string }> {
  // Sem p_assignees de propósito (mig. 253): a mídia não decide quem produz.
  const titulo = tituloDaTarefa(e)
  // Briefing nasce VAZIO de propósito: o que a mídia sabe já está no título
  // (data/veículo/formato/job) e no aviso dentro da tarefa (prazo do veículo e
  // conflito). Contato e forma de envio são assunto da mídia, não da criação —
  // repetir isso aqui só polui o campo que o atendimento vai escrever.
  const { data: activityId, error } = await supabase.rpc('create_activity', {
    p_user_id: userId,
    p_campaign_id: campaignId,
    p_title: titulo,
    p_description: '',
    p_status: 'briefing',
    p_priority: 'medium',
    p_complexity: 'medium',
    p_due_date: e.prazoEnvio || null,
    p_estimated_hours: null,
    p_start_date: null,
  })
  if (error || !activityId) return { erro: error?.message ?? 'A tarefa não foi criada.' }

  const { error: errVinculo } = await supabase.rpc('midia_entrega_salvar', {
    p_id: entregaId,
    p_workspace_id: e.workspaceId,
    p_titulo: e.titulo,
    p_veiculo: e.veiculo || null,
    p_formato: e.formato || null,
    p_prazo_envio: e.prazoEnvio || null,
    p_activity_id: activityId,
    p_campaign_id: campaignId,
    p_observacao: e.observacao || null,
    p_veiculo_id: e.veiculoId || null,
  })
  if (errVinculo) return { activityId: activityId as string, erro: errVinculo.message }

  await provisionActivitiesDrive(supabase, {
    campaignId, userId,
    items: [{ activityId: activityId as string, title: titulo, date: hojeBR() }],
  })
  // Aviso de tarefa nova sem dono sai pelo trigger da criação; o push é imediato
  // pra não esperar a varredura de 15min.
  after(() => dispatchPushNotificacoes().catch(() => {}))
  return { activityId: activityId as string }
}

export interface TarefaConcluidaPelaEntrega {
  titulo: string
  recorreu: boolean
  novoPrazo: string | null
}

/**
 * 'liberado' = o material já foi enviado ao veículo.
 *
 * Enviar ao veículo é o fim do trabalho — não sobra nada para produzir — então o
 * mesmo gesto CONCLUI a tarefa vinculada: rotina recorrente volta com o próximo
 * prazo, execução única fica concluída (mesma régua do "Feito" do painel).
 *
 * Reabrir a entrega NÃO desconclui a tarefa: a conclusão já gravou histórico e
 * pode ter disparado recorrência, e desfazer pelo lado da mídia seria adivinhar
 * de qual status a tarefa veio. Por isso a tela confirma antes, quando a tarefa
 * ainda está com a criação.
 */
export async function mudarSituacaoEntrega(
  orgSlug: string, id: string, situacao: 'aguardando' | 'liberado' | 'cancelado',
): Promise<{ error?: string; tarefa?: TarefaConcluidaPelaEntrega }> {
  const { supabase, orgId, userId } = await assertMidiaAccess(orgSlug)
  const sb = supabase as any
  const { error } = await sb.rpc('midia_entrega_situacao', { p_id: id, p_situacao: situacao })
  if (error) return { error: error.message }

  let tarefa: TarefaConcluidaPelaEntrega | undefined
  if (situacao === 'liberado') {
    const r = await concluirTarefaDaEntrega(sb, orgId, userId, id)
    if (r.error) return { error: r.error }
    tarefa = r.tarefa
  }

  revalidatePath(`/${orgSlug}/midia/entregas`)
  revalidatePath(`/${orgSlug}/midia`)
  revalidatePath(`/${orgSlug}/midia/visao-geral`)
  if (tarefa) revalidatePath(`/${orgSlug}`, 'layout')
  return { tarefa }
}

/** Conclui a tarefa vinculada à entrega. Sem tarefa (ou já concluída) = no-op. */
async function concluirTarefaDaEntrega(
  sb: any, orgId: string, userId: string, entregaId: string,
): Promise<{ error?: string; tarefa?: TarefaConcluidaPelaEntrega }> {
  const { data: e } = await sb
    .from('midia_entrega').select('activity_id').eq('id', entregaId).maybeSingle()
  const activityId = (e?.activity_id ?? null) as string | null
  if (!activityId) return {}

  const [{ data: st }, { data: act }] = await Promise.all([
    sb.from('org_status').select('valor').eq('org_id', orgId).eq('papel', 'conclusao').maybeSingle(),
    sb.from('activities').select('title, status').eq('id', activityId).maybeSingle(),
  ])
  const concluido = (st?.valor as string) ?? 'concluido'
  if (!act || act.status === concluido) return {}

  const { error } = await sb.rpc('update_activity_status', {
    p_user_id: userId, p_activity_id: activityId,
    p_new_status: concluido, p_comment: 'Material enviado ao veículo (entrega da mídia).',
  })
  if (error) return { error: error.message }

  // Síncrono, como no "Feito" do painel: a tela precisa dizer na hora para quando
  // a rotina voltou. Devolve false quando não há recorrência.
  const { data: recorreu, error: e2 } = await sb.rpc('recur_activity', {
    p_user_id: userId, p_activity_id: activityId,
  })
  if (e2) return { error: e2.message }

  let novoPrazo: string | null = null
  if (recorreu) {
    const { data } = await sb.from('activities').select('due_date').eq('id', activityId).maybeSingle()
    novoPrazo = (data?.due_date as string) ?? null
  }

  after(() => dispatchPushNotificacoes().catch(() => {}))
  return { tarefa: { titulo: act.title as string, recorreu: !!recorreu, novoPrazo } }
}

export async function excluirEntrega(orgSlug: string, id: string) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { error } = await (supabase as any).rpc('midia_entrega_excluir', { p_id: id })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/entregas`)
  return {}
}

/**
 * Tarefas ativas do cliente (pra vincular a entrega à peça da criação) e os
 * projetos ativos (pra escolher onde um briefing novo vai nascer). Vêm juntos
 * porque a tela pede os dois no mesmo momento — ao trocar de cliente.
 */
export async function tarefasDoCliente(orgSlug: string, workspaceId: string) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const [resT, resC] = await Promise.all([
    (supabase as any)
      .from('activities')
      .select('id, title, status, due_date, campaign_id, campaigns!inner(id, name, workspace_id)')
      .eq('campaigns.workspace_id', workspaceId)
      .eq('archived', false)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(300),
    (supabase as any)
      .from('campaigns')
      .select('id, name')
      .eq('workspace_id', workspaceId)
      .eq('archived', false)
      .limit(200),
  ])
  if (resT.error) return { error: resT.error.message as string }
  if (resC.error) return { error: resC.error.message as string }
  return {
    tarefas: (resT.data ?? []).map((a: any) => ({
      id: a.id as string, titulo: a.title as string, status: a.status as string,
      prazo: (a.due_date ?? null) as string | null,
      campanha: (a.campaigns?.name ?? '') as string,
      campaignId: a.campaign_id as string,
    })),
    // porNome: o Postgres Alpine ordena por bytes e joga acento pro fim.
    campanhas: ((resC.data ?? []) as { id: string; name: string }[])
      .map(c => ({ id: c.id, nome: c.name }))
      .sort(porNome(c => c.nome)),
  }
}

// ── Vincular entregas antigas às tarefas da pauta ────────────────────────────

export interface EntregaSemTarefa {
  id: string
  titulo: string
  cliente: string
  workspaceId: string
  veiculo: string | null
  formato: string | null
  prazoEnvio: string | null
  observacao: string | null
  tarefaSugerida: string | null
  sugestaoFraca: boolean
}

export interface TarefaCandidata {
  id: string; titulo: string; prazo: string | null; campanha: string; campaignId: string
}

/**
 * Tela transitória: as entregas criadas ANTES de o select ter três estados
 * ficaram com `activity_id` nulo sem dizer se era "material pronto" ou "ainda
 * não abriram a tarefa". Aqui a mídia liga cada pendente à tarefa que já existe
 * na pauta. Quando a lista zera, a tela pode sair do menu — igual à de migrar
 * rotinas.
 *
 * Só PENDENTES: entrega já enviada ao veículo é passado, e passado não se
 * conserta (decisão do Rafael, 01/09).
 */
export async function carregarVinculoEntregas(orgSlug: string) {
  const { supabase, orgId } = await assertMidiaAccess(orgSlug)
  const sb = supabase as any
  const { sugerirTarefa } = await import('@/lib/midia-migracao')

  const { data: rows, error } = await sb
    .from('midia_entrega_view')
    .select('id, titulo, cliente, workspace_id, veiculo, formato, prazo_envio, observacao')
    .eq('org_id', orgId)
    .eq('situacao', 'aguardando')
    .is('activity_id', null)
    .order('prazo_envio', { ascending: true, nullsFirst: false })
  if (error) return { error: error.message as string }

  const pendentes = (rows ?? []) as any[]
  const wsIds = [...new Set(pendentes.map(r => r.workspace_id as string))]
  if (wsIds.length === 0) return { entregas: [], tarefas: {} as Record<string, TarefaCandidata[]> }

  const { data: acts, error: e2 } = await sb
    .from('activities')
    .select('id, title, due_date, campaign_id, campaigns!inner(id, name, workspace_id)')
    .in('campaigns.workspace_id', wsIds)
    .eq('archived', false)
    .order('due_date', { ascending: false, nullsFirst: false })
    .limit(1000)
  if (e2) return { error: e2.message as string }

  const tarefas: Record<string, TarefaCandidata[]> = {}
  for (const a of (acts ?? []) as any[]) {
    const ws = a.campaigns?.workspace_id as string
    if (!ws) continue
    ;(tarefas[ws] ??= []).push({
      id: a.id, titulo: a.title, prazo: a.due_date ?? null,
      campanha: a.campaigns?.name ?? '', campaignId: a.campaign_id,
    })
  }

  const entregas: EntregaSemTarefa[] = pendentes.map(r => {
    const cand = tarefas[r.workspace_id] ?? []
    const sug = sugerirTarefa(r.titulo, cand.map(t => ({ id: t.id, nome: t.titulo, prazo: t.prazo })), r.prazo_envio)
    return {
      id: r.id, titulo: r.titulo, cliente: r.cliente, workspaceId: r.workspace_id,
      veiculo: r.veiculo ?? null, formato: r.formato ?? null,
      prazoEnvio: r.prazo_envio ?? null, observacao: r.observacao ?? null,
      tarefaSugerida: sug?.id ?? null,
      sugestaoFraca: sug ? !sug.forte : true,
    }
  })

  return { entregas, tarefas }
}

/** Liga uma entrega existente a uma tarefa da pauta (campanha vem da tarefa). */
export async function vincularEntregaTarefa(orgSlug: string, entregaId: string, activityId: string) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const sb = supabase as any

  const [{ data: e }, { data: a }] = await Promise.all([
    sb.from('midia_entrega')
      .select('workspace_id, titulo, veiculo, veiculo_id, formato, prazo_envio, observacao')
      .eq('id', entregaId).maybeSingle(),
    sb.from('activities').select('campaign_id').eq('id', activityId).maybeSingle(),
  ])
  if (!e) return { error: 'Entrega não encontrada.' }
  if (!a) return { error: 'Tarefa não encontrada.' }

  const { error } = await sb.rpc('midia_entrega_salvar', {
    p_id: entregaId,
    p_workspace_id: e.workspace_id,
    p_titulo: e.titulo,
    p_veiculo: e.veiculo ?? null,
    p_formato: e.formato ?? null,
    p_prazo_envio: e.prazo_envio ?? null,
    p_activity_id: activityId,
    p_campaign_id: a.campaign_id ?? null,
    p_observacao: e.observacao ?? null,
    p_veiculo_id: e.veiculo_id ?? null,
  })
  if (error) return { error: error.message }

  revalidatePath(`/${orgSlug}/midia/vincular`)
  revalidatePath(`/${orgSlug}/midia/entregas`)
  revalidatePath(`/${orgSlug}/midia`)
  revalidatePath(`/${orgSlug}/midia/visao-geral`)
  return {}
}

// ── Implantação (migration 237) ──────────────────────────────────────────────

export type EstadoImplantacao = 'pendente' | 'ok' | 'na' | 'perdido'

/** Marca o estado de um item de implantação. Estado REGRIDE — 'ok' hoje pode
 *  virar 'perdido' amanhã, e isso é o comportamento esperado. */
export async function marcarImplantacao(
  orgSlug: string, workspaceId: string, itemId: string, estado: EstadoImplantacao, nota?: string | null,
) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { error } = await (supabase as any).rpc('midia_implantacao_marcar', {
    p_workspace_id: workspaceId, p_item_id: itemId, p_estado: estado, p_nota: nota ?? null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/clientes`)
  revalidatePath(`/${orgSlug}/midia`)
  revalidatePath(`/${orgSlug}/midia/visao-geral`)
  return {}
}

// ── Catálogo de rotinas (migration 240) ──────────────────────────────────────

export interface RotinaInput {
  id?: string | null
  nome: string
  descricao?: string | null
  frequencia: string
  diaMes?: number | null
  diaSemana?: number | null
  statusRetorno?: string | null
  pasta?: string | null
  padrao?: boolean
  ordem?: number | null
}

export async function salvarRotina(orgSlug: string, r: RotinaInput) {
  const { supabase, orgId } = await assertMidiaAccess(orgSlug)
  const { data, error } = await (supabase as any).rpc('midia_rotina_salvar', {
    p_id: r.id || null,
    p_org: orgId,
    p_nome: r.nome,
    p_descricao: r.descricao || null,
    p_frequencia: r.frequencia,
    p_dia_mes: r.diaMes ?? null,
    p_dia_semana: r.diaSemana ?? null,
    p_status_retorno: r.statusRetorno || null,
    p_pasta: r.pasta || null,
    p_padrao: r.padrao ?? true,
    p_ordem: r.ordem ?? null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/rotinas`)
  revalidatePath(`/${orgSlug}/midia/clientes`)
  return { id: data as string }
}

/** Desativar tira das sugestões; as tarefas já criadas continuam vivas. */
export async function ativarRotinaCatalogo(orgSlug: string, id: string, ativo: boolean) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { error } = await (supabase as any).rpc('midia_rotina_ativo', { p_id: id, p_ativo: ativo })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/rotinas`)
  revalidatePath(`/${orgSlug}/midia/clientes`)
  return {}
}

// ── Pastas no drive "Mídia" (lib/midia-drive) ────────────────────────────────

/** Pastas de cliente do drive Mídia, para vincular à mão (os nomes não batem
 *  com os do Flow: "É O Amor" aqui é "É o Amor - Condomínio Fazenda" lá). */
export async function listarPastasDoDrive(orgSlug: string) {
  await assertMidiaAccess(orgSlug)
  try {
    const { pastasDeClientes } = await import('@/lib/midia-drive')
    return { pastas: await pastasDeClientes() }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao ler o drive Mídia' }
  }
}

/** Grava a pasta do cliente no drive Mídia. */
export async function vincularPastaCliente(orgSlug: string, midiaClienteId: string, folderId: string) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { error } = await (supabase as any).rpc('midia_atualizar_cliente', {
    p_id: midiaClienteId,
    p_plano_url: null, p_specs_url: null, p_crm_url: null,
    p_drive_folder_id: folderId, p_observacao: null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/clientes`)
  return {}
}

/**
 * Cria (ou reusa) a pasta do mês da rotina e a deixa vinculada na tarefa —
 * assim quem abre a tarefa na pauta chega na pasta certa do mês corrente.
 *
 * A pasta da ROTINA nunca é criada às cegas: se o casamento com as grafias
 * existentes falhar, devolve as opções para a pessoa escolher (e a escolha
 * fica gravada no vínculo, virando decisão em vez de heurística).
 */
export async function abrirPastaDoMes(orgSlug: string, vinculoRotinaId: string, mes?: number) {
  const { supabase, orgId } = await assertMidiaAccess(orgSlug)
  const sb = supabase as any

  const { data, error } = await sb
    .from('midia_cliente_rotina')
    .select('id, activity_id, pasta_folder_id, midia_rotina(nome, pasta), midia_cliente(ano, drive_folder_id)')
    .eq('id', vinculoRotinaId).eq('org_id', orgId).maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Rotina não encontrada' }

  const pastaCanonica = data.midia_rotina?.pasta as string | undefined
  const clienteFolderId = data.midia_cliente?.drive_folder_id as string | undefined
  if (!pastaCanonica) return { error: 'Esta rotina não tem pasta definida no catálogo.' }
  if (!clienteFolderId) return { error: 'Vincule primeiro a pasta do cliente no drive Mídia.' }

  const agora = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  const alvoMes = mes ?? Number(agora.slice(5, 7))
  const ano = (data.midia_cliente?.ano as number) ?? Number(agora.slice(0, 4))

  try {
    const { resolverPastaRotina, garantirPastaDoMes } = await import('@/lib/midia-drive')

    let rotinaFolderId = data.pasta_folder_id as string | null
    if (!rotinaFolderId) {
      const r = await resolverPastaRotina({ clienteFolderId, ano, pastaCanonica })
      if ('opcoes' in r) {
        return {
          precisaEscolher: true as const,
          canonica: pastaCanonica,
          anoFolderId: r.anoFolderId,
          opcoes: r.opcoes,
        }
      }
      rotinaFolderId = r.id
      await sb.rpc('midia_rotina_pasta', { p_vinculo: vinculoRotinaId, p_folder_id: rotinaFolderId })
    }

    const pasta = await garantirPastaDoMes({ rotinaFolderId, mes: alvoMes, rotulo: `${ano}/${pastaCanonica}` })

    // A tarefa recorrente aponta sempre para a pasta do mês em curso.
    if (data.activity_id) {
      await sb.from('activities').update({ drive_folder_url: pasta.link }).eq('id', data.activity_id)
    }
    revalidatePath(`/${orgSlug}/midia/clientes`)
    return { link: pasta.link, caminho: pasta.caminho, criadas: pasta.criadas }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao criar a pasta no drive' }
  }
}

/** Registra qual pasta do drive é a desta rotina neste cliente (ou cria a
 *  canônica, quando a pessoa escolhe "criar"). */
export async function definirPastaRotina(
  orgSlug: string, vinculoRotinaId: string,
  escolha: { folderId?: string; criarEm?: { anoFolderId: string; nome: string } },
) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const sb = supabase as any
  try {
    let folderId = escolha.folderId
    if (!folderId && escolha.criarEm) {
      const { criarPastaRotina } = await import('@/lib/midia-drive')
      folderId = await criarPastaRotina(escolha.criarEm.anoFolderId, escolha.criarEm.nome)
    }
    if (!folderId) return { error: 'Escolha uma pasta ou peça para criar.' }
    const { error } = await sb.rpc('midia_rotina_pasta', { p_vinculo: vinculoRotinaId, p_folder_id: folderId })
    if (error) return { error: error.message }
    revalidatePath(`/${orgSlug}/midia/clientes`)
    return { folderId }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao definir a pasta' }
  }
}

// ── Migração do cliente-balde (migration 243) ────────────────────────────────

export interface CandidataMigracao {
  id: string
  titulo: string
  recorrencia: string | null
  prazo: string | null
  status: string
  responsaveis: string[]
  campanha: string
  clienteSugerido: string | null
  rotinaSugerida: string | null
  sugestaoFraca: boolean
  /** Já migrada: id da tarefa nova no cliente real. */
  migradaPara: string | null
}

/**
 * As tarefas recorrentes de um workspace-balde, com as sugestões de cliente e
 * rotina. Sugerir é seguro; decidir não — nada migra sem confirmação na tela.
 */
export async function carregarMigracao(orgSlug: string, origemWorkspaceId: string) {
  const { supabase, orgId } = await assertMidiaAccess(orgSlug)
  const sb = supabase as any

  const [resAtiv, resWs, resRot, resFeitas] = await Promise.all([
    sb.from('activities')
      .select('id, title, status, due_date, recurrence, campaign_id, campaigns!inner(id, name, workspace_id), activity_assignees(profiles!user_id(full_name))')
      .eq('campaigns.workspace_id', origemWorkspaceId)
      .eq('archived', false)
      .not('recurrence', 'is', null)
      .order('title'),
    sb.from('workspaces').select('id, name, archived').eq('org_id', orgId),
    sb.from('midia_rotina').select('id, nome, descricao').eq('org_id', orgId).eq('ativo', true).order('ordem'),
    sb.from('midia_cliente_rotina').select('origem_activity_id, activity_id').eq('org_id', orgId).not('origem_activity_id', 'is', null),
  ])
  if (resAtiv.error) return { error: resAtiv.error.message }
  if (resWs.error) return { error: resWs.error.message }
  if (resRot.error) return { error: resRot.error.message }

  const { sugerirCliente, sugerirRotina } = await import('@/lib/midia-migracao')
  const clientes = ((resWs.data ?? []) as { id: string; name: string; archived: boolean }[])
    .filter(w => !w.archived && w.id !== origemWorkspaceId)
    .map(w => ({ id: w.id, nome: w.name }))
  const rotinas = ((resRot.data ?? []) as { id: string; nome: string; descricao: string | null }[])
    .map(r => ({ id: r.id, nome: r.nome, descricao: r.descricao }))
  const feitas = new Map<string, string>(
    ((resFeitas.data ?? []) as { origem_activity_id: string; activity_id: string | null }[])
      .map(f => [f.origem_activity_id, f.activity_id ?? '']))

  const candidatas: CandidataMigracao[] = ((resAtiv.data ?? []) as any[]).map(a => {
    const rot = sugerirRotina(a.title, rotinas)
    return {
      id: a.id,
      titulo: a.title,
      recorrencia: a.recurrence,
      prazo: a.due_date,
      status: a.status,
      responsaveis: (a.activity_assignees ?? [])
        .map((x: any) => x.profiles?.full_name).filter(Boolean),
      campanha: a.campaigns?.name ?? '',
      clienteSugerido: sugerirCliente(a.title, clientes),
      rotinaSugerida: rot?.id ?? null,
      sugestaoFraca: rot ? !rot.forte : false,
      migradaPara: feitas.get(a.id) ?? null,
    }
  })

  return { candidatas, clientes, rotinas }
}

/** Copia a tarefa para o cliente real. A original fica INTACTA. */
export async function migrarRotina(
  orgSlug: string, origemId: string, workspaceId: string, rotinaId: string,
) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { data, error } = await (supabase as any).rpc('midia_migrar_rotina', {
    p_origem: origemId, p_workspace: workspaceId, p_rotina: rotinaId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/migrar`)
  revalidatePath(`/${orgSlug}/midia/clientes`)
  return { id: data as string }
}

/** Arquiva a tarefa antiga — passo à parte, só depois de conferir a cópia. */
export async function arquivarOrigem(orgSlug: string, origemId: string) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { error } = await (supabase as any).rpc('midia_arquivar_origem', { p_origem: origemId })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/migrar`)
  return {}
}

/** Workspaces que ainda têm rotina de mídia morando neles (o balde e afins). */
export async function origensDeMigracao(orgSlug: string) {
  const { supabase, orgId } = await assertMidiaAccess(orgSlug)
  const sb = supabase as any
  const { data, error } = await sb
    .from('activities')
    .select('id, campaigns!inner(workspace_id, workspaces!inner(id, name, org_id))')
    .eq('campaigns.workspaces.org_id', orgId)
    .eq('archived', false)
    .not('recurrence', 'is', null)
  if (error) return { error: error.message }
  const cont = new Map<string, { id: string; nome: string; total: number }>()
  for (const a of (data ?? []) as any[]) {
    const w = a.campaigns?.workspaces
    if (!w) continue
    const atual = cont.get(w.id) ?? { id: w.id, nome: w.name, total: 0 }
    atual.total++
    cont.set(w.id, atual)
  }
  return { origens: [...cont.values()].sort((a, b) => b.total - a.total) }
}

// ── Concluir do painel ───────────────────────────────────────────────────────

/**
 * "Feito" direto no painel da mídia.
 *
 * Rotina recorrente volta para a fila com o próximo prazo; tarefa de execução
 * única fica concluída. As duas coisas saem do MESMO gesto — quem opera não
 * precisa saber qual é qual.
 *
 * A recorrência roda AQUI, síncrona, e não pelo `after()` do caminho canônico:
 * a tela precisa dizer na hora para quando a rotina voltou, e um refresh
 * disparado antes do trabalho de fundo terminar mostraria a rotina "concluída"
 * por um instante — piscada que faz a pessoa clicar de novo.
 *
 * O gate de revisão por IA não entra na conta porque ele só dispara saindo de
 * Redação/Design/Finalização, e a fila da mídia nunca está nesses status.
 */
export async function concluirTarefaMidia(orgSlug: string, activityId: string) {
  const { supabase, orgId, userId } = await assertMidiaAccess(orgSlug)
  const sb = supabase as any

  const { data: st } = await sb.from('org_status')
    .select('valor').eq('org_id', orgId).eq('papel', 'conclusao').maybeSingle()
  const concluido = (st?.valor as string) ?? 'concluido'

  const { error } = await sb.rpc('update_activity_status', {
    p_user_id: userId, p_activity_id: activityId,
    p_new_status: concluido, p_comment: '',
  })
  if (error) return { error: error.message }

  // Devolve false quando não há recorrência (ou acabaram as repetições).
  const { data: recorreu, error: e2 } = await sb.rpc('recur_activity', {
    p_user_id: userId, p_activity_id: activityId,
  })
  if (e2) return { error: e2.message }

  let novoPrazo: string | null = null
  if (recorreu) {
    const { data } = await sb.from('activities').select('due_date').eq('id', activityId).maybeSingle()
    novoPrazo = (data?.due_date as string) ?? null
  }

  after(() => dispatchPushNotificacoes().catch(() => {}))
  revalidatePath(`/${orgSlug}/midia`)
  revalidatePath(`/${orgSlug}/midia/visao-geral`)
  return { recorreu: !!recorreu, novoPrazo }
}

/**
 * O que a mídia fechou nos últimos dias — memória curta do painel, não uma
 * segunda caixa de arquivamento.
 *
 * Quem arquiva concluídas é o Rafael, em lote, na Lista (régua da casa). Criar
 * um arquivamento paralelo aqui partiria esse processo em dois lugares. O que
 * faltava era só a mídia enxergar o próprio rastro depois de clicar em Feito —
 * e poder desfazer um clique errado.
 *
 * A fonte é o HISTÓRICO (activity_history), não o status atual: é ele que sabe
 * que a tarefa veio de um status da mídia, e é o único jeito de não listar
 * conclusão de outra área.
 */
export async function concluidasRecentes(orgSlug: string, dias = 7) {
  const { supabase, orgId } = await assertMidiaAccess(orgSlug)
  const sb = supabase as any
  const { statusDaMidia } = await import('@/lib/midia-hub')
  const statuses = await statusDaMidia(sb, orgId)

  const desde = new Date(Date.now() - dias * 86400_000).toISOString()
  const { data, error } = await sb
    .from('activity_history')
    .select('id, activity_id, from_status, to_status, changed_at, profiles!changed_by(full_name), activities!activity_id(id, title, status, archived, campaign_id, campaigns!inner(id, name, workspace_id, workspaces!inner(id, name, org_id)))')
    .eq('to_status', 'concluido')
    .in('from_status', statuses)
    .gte('changed_at', desde)
    .order('changed_at', { ascending: false })
    .limit(60)
  if (error) return { error: error.message }

  const vistas = new Set<string>()
  const itens = ((data ?? []) as any[])
    .filter(h => {
      const a = h.activities
      if (!a || a.archived) return false
      if (a.campaigns?.workspaces?.org_id !== orgId) return false
      // Rotina que recorreu já voltou para a fila: não é "concluída".
      if (a.status !== 'concluido') return false
      if (vistas.has(a.id)) return false
      vistas.add(a.id)
      return true
    })
    .map(h => ({
      id: h.activities.id as string,
      titulo: h.activities.title as string,
      cliente: h.activities.campaigns?.workspaces?.name as string,
      workspaceId: h.activities.campaigns?.workspaces?.id as string,
      campaignId: h.activities.campaign_id as string,
      quando: h.changed_at as string,
      quem: (h.profiles?.full_name ?? null) as string | null,
      voltarPara: (h.from_status ?? 'midia') as string,
    }))

  return { itens }
}

/** Desfaz o "Feito" — devolve a tarefa ao status em que estava. Não arquiva nada. */
export async function reabrirTarefaMidia(orgSlug: string, activityId: string, statusDestino: string) {
  const { supabase, userId } = await assertMidiaAccess(orgSlug)
  const { error } = await (supabase as any).rpc('update_activity_status', {
    p_user_id: userId, p_activity_id: activityId,
    p_new_status: statusDestino, p_comment: '',
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia`)
  revalidatePath(`/${orgSlug}/midia/visao-geral`)
  return {}
}

// ── Agenda e ciclo do mês (migration 248) ────────────────────────────────────

export interface CoberturaRow {
  workspace_id: string; cliente: string
  rotina_id: string; rotina: string; frequencia: string
  activity_id: string | null; prazo: string | null; status: string | null
  esperado: number; feitas: number; ultima_conclusao: string | null
}

export interface AgendaRow {
  dia: string; tipo: 'prazo' | 'feito' | 'entrega' | 'pedido' | 'item'
  titulo: string; cliente: string
  activity_id: string | null; workspace_id: string | null
  campaign_id: string | null; frequencia: string | null
}

/** Cobertura + agenda do período, numa chamada só (as duas telas do ciclo). */
export async function carregarCicloMidia(orgSlug: string, ini: string, fim: string) {
  const { supabase, orgId } = await assertMidiaAccess(orgSlug)
  const sb = supabase as any
  const statusMidia = await statusDaMidia(sb, orgId)
  const [cob, age, ativ] = await Promise.all([
    sb.rpc('midia_cobertura', { p_org: orgId, p_ini: ini, p_fim: fim }),
    sb.rpc('midia_agenda', { p_org: orgId, p_ini: ini, p_fim: fim }),
    sb.from('activities')
      .select('id, title, checklist, campaign_id, campaigns!inner(workspace_id, workspaces!inner(name, org_id))')
      .eq('campaigns.workspaces.org_id', orgId).eq('archived', false).in('status', statusMidia),
  ])
  if (cob.error) return { error: cob.error.message }
  if (age.error) return { error: age.error.message }
  if (ativ.error) return { error: ativ.error.message }

  // Item datado do checklist é uma demanda própria no calendário (o post da
  // data X): pendente entra como 'item', feito no período entra como 'feito' —
  // é o "o que já foi feito" que o time pediu em 17/08.
  const itens: AgendaRow[] = []
  for (const a of (ativ.data ?? []) as any[]) {
    for (const it of resumoChecklist(a.checklist).itens) {
      if (!it.data || it.data < ini || it.data > fim) continue
      itens.push({
        dia: it.data, tipo: it.feito ? 'feito' : 'item',
        titulo: `${a.title} · ${it.texto}`, cliente: a.campaigns.workspaces.name,
        activity_id: a.id, workspace_id: a.campaigns.workspace_id,
        campaign_id: a.campaign_id, frequencia: null,
      })
    }
  }
  return {
    cobertura: (cob.data ?? []) as CoberturaRow[],
    agenda: [...((age.data ?? []) as AgendaRow[]), ...itens],
  }
}

/**
 * Desdobra um pedido em datas a partir da fila: cada linha vira item do checklist
 * da tarefa (com data quando há), somando ao que já existe. A tarefa continua UMA
 * na pauta; na fila da mídia cada item datado pendente vira linha própria. Com
 * `ajustarPrazo`, o prazo da tarefa vai para a última data quando ela passa do
 * prazo atual — é o que substitui o prazo empurrado à mão.
 */
export async function desdobrarEmDatas(
  orgSlug: string, activityId: string,
  itens: { text: string; data: string | null }[], ajustarPrazo: boolean,
) {
  const { supabase, userId } = await assertMidiaAccess(orgSlug)
  const sb = supabase as any
  const limpos = itens
    .map(i => ({ text: (i.text ?? '').trim(), data: i.data && dataValida(i.data) ? i.data : null }))
    .filter(i => i.text)
  if (!limpos.length) return { error: 'Nenhum item para adicionar.' }

  const { data: a, error } = await sb.from('activities')
    .select('checklist, due_date, start_date').eq('id', activityId).maybeSingle()
  if (error) return { error: error.message }
  if (!a) return { error: 'Tarefa não encontrada.' }

  const atual = Array.isArray(a.checklist) ? (a.checklist as any[]) : []
  const novos = limpos.map(i => ({ id: crypto.randomUUID(), text: i.text, done: false, data: i.data }))
  const { error: e2 } = await sb.rpc('set_activity_checklist', {
    p_user_id: userId, p_activity_id: activityId, p_items: [...atual, ...novos],
  })
  if (e2) return { error: e2.message }

  let novoPrazo: string | null = null
  const ultima = novos.map(n => n.data).filter(Boolean).sort().at(-1) ?? null
  if (ajustarPrazo && ultima && (!a.due_date || ultima > String(a.due_date).slice(0, 10))) {
    const { error: e3 } = await sb.rpc('update_activity_dates', {
      p_user_id: userId, p_activity_id: activityId,
      p_start_date: a.start_date ?? null, p_due_date: ultima,
    })
    if (e3) return { error: `Itens adicionados, mas o prazo não mudou: ${e3.message}` }
    novoPrazo = ultima
  }

  revalidatePath(`/${orgSlug}/midia`)
  revalidatePath(`/${orgSlug}/midia/agenda`)
  return { adicionados: novos.length, comData: novos.filter(n => n.data).length, novoPrazo }
}

/**
 * Marca um item datado do checklist como feito, a partir da fila. Lê e regrava
 * o array inteiro pela mesma RPC do detalhe (set_activity_checklist): com duas
 * pessoas marcando ao mesmo tempo, a segunda pode sobrescrever a primeira —
 * risco aceito por ora; RPC por item só se acontecer.
 */
export async function marcarItemChecklist(orgSlug: string, activityId: string, itemId: string) {
  const { supabase, userId } = await assertMidiaAccess(orgSlug)
  const sb = supabase as any
  const { data: a, error } = await sb.from('activities').select('checklist').eq('id', activityId).maybeSingle()
  if (error) return { error: error.message }
  if (!a) return { error: 'Tarefa não encontrada.' }
  const itens = Array.isArray(a.checklist) ? (a.checklist as any[]) : []
  if (!itens.some(it => it?.id === itemId)) return { error: 'Esse item já não está no checklist.' }
  const novo = itens.map(it => (it?.id === itemId ? { ...it, done: true } : it))
  const { error: e2 } = await sb.rpc('set_activity_checklist', {
    p_user_id: userId, p_activity_id: activityId, p_items: novo,
  })
  if (e2) return { error: e2.message }
  const restantes = novo.filter(it => !it?.done && typeof it?.data === 'string' && it.data).length
  revalidatePath(`/${orgSlug}/midia`)
  revalidatePath(`/${orgSlug}/midia/agenda`)
  return { restantes }
}
