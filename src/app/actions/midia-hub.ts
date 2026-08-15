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
