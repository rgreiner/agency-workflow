'use server'

// Ações do Hub de Mídia (migration 234). Toda escrita passa por RPC com guard
// `midia_can` — a tela nunca escreve direto nas tabelas.

import { revalidatePath } from 'next/cache'
import { assertMidiaAccess } from '@/lib/midia-hub'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Liga a operação de mídia num cliente (cria a campanha de operação do ano). */
export async function ativarClienteMidia(orgSlug: string, workspaceId: string, ano?: number) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { data, error } = await (supabase as any)
    .rpc('midia_ativar_cliente', { p_workspace_id: workspaceId, p_ano: ano ?? null })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/clientes`)
  revalidatePath(`/${orgSlug}/midia`)
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
  formato?: string | null
  prazoEnvio?: string | null
  activityId?: string | null
  campaignId?: string | null
  observacao?: string | null
}

/** Cria ou edita a entrega. O prazo aqui é o da MÍDIA — nunca toca o da tarefa. */
export async function salvarEntrega(orgSlug: string, e: EntregaInput) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { data, error } = await (supabase as any).rpc('midia_entrega_salvar', {
    p_id: e.id || null,
    p_workspace_id: e.workspaceId,
    p_titulo: e.titulo,
    p_veiculo: e.veiculo || null,
    p_formato: e.formato || null,
    p_prazo_envio: e.prazoEnvio || null,
    p_activity_id: e.activityId || null,
    p_campaign_id: e.campaignId || null,
    p_observacao: e.observacao || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/entregas`)
  revalidatePath(`/${orgSlug}/midia`)
  return { id: data as string }
}

/** 'liberado' = material enviado ao veículo. Reversível. */
export async function mudarSituacaoEntrega(orgSlug: string, id: string, situacao: 'aguardando' | 'liberado' | 'cancelado') {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { error } = await (supabase as any).rpc('midia_entrega_situacao', { p_id: id, p_situacao: situacao })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/entregas`)
  revalidatePath(`/${orgSlug}/midia`)
  return {}
}

export async function excluirEntrega(orgSlug: string, id: string) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { error } = await (supabase as any).rpc('midia_entrega_excluir', { p_id: id })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midia/entregas`)
  return {}
}

/** Tarefas ativas do cliente, para vincular a entrega à peça da criação. */
export async function tarefasDoCliente(orgSlug: string, workspaceId: string) {
  const { supabase } = await assertMidiaAccess(orgSlug)
  const { data, error } = await (supabase as any)
    .from('activities')
    .select('id, title, status, due_date, campaign_id, campaigns!inner(id, name, workspace_id)')
    .eq('campaigns.workspace_id', workspaceId)
    .eq('archived', false)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(300)
  if (error) return { error: error.message }
  return {
    tarefas: (data ?? []).map((a: any) => ({
      id: a.id as string, titulo: a.title as string, status: a.status as string,
      prazo: (a.due_date ?? null) as string | null,
      campanha: (a.campaigns?.name ?? '') as string,
      campaignId: a.campaign_id as string,
    })),
  }
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
