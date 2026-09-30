'use server'

/**
 * Atas de reunião (mig. 306). Escrita passa pela RLS: só quem gerencia o portal
 * (Atendimento ou owner/admin — portal_pode_gerir) grava; a IA não grava nada,
 * só devolve a proposta pro form.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { organizarAta, type AtaOrganizada } from '@/lib/ai/ata'
import { iaDaOrg } from '@/lib/ai/provedor'
import { mensagemErroRevisao } from '@/lib/ai/review'
import { logSystemError } from '@/lib/system-error'
import type { Reuniao, TarefaVinculavel, OrcamentoVinculavel } from '@/lib/reunioes'
import { ORCAMENTO_SITUACAO_LABELS } from '@/lib/midia'
import { docNumero } from '@/lib/doc-series'

type Resultado<T> = ({ ok: true } & T) | { ok: false; error: string }

async function orgDoWorkspace(workspaceId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('workspaces').select('org_id').eq('id', workspaceId).maybeSingle()
  return (data?.org_id as string | undefined) ?? null
}

function rotas(orgSlug: string, workspaceId: string, id?: string) {
  revalidatePath(`/${orgSlug}/workspaces/${workspaceId}/reunioes`)
  if (id) revalidatePath(`/${orgSlug}/workspaces/${workspaceId}/reunioes/${id}`)
}

export async function salvarReuniao(
  orgSlug: string, workspaceId: string, dados: Reuniao,
): Promise<Resultado<{ id: string; passoIds: string[] }>> {
  const user = await getUsuario()
  if (!user) return { ok: false, error: 'Sessão expirada. Entre de novo.' }
  const titulo = dados.titulo.trim()
  if (!titulo) return { ok: false, error: 'Dê um título para a reunião.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.realizadaEm)) return { ok: false, error: 'Data da reunião inválida.' }
  const orgId = await orgDoWorkspace(workspaceId)
  if (!orgId) return { ok: false, error: 'Cliente não encontrado.' }

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const linha = {
    titulo,
    realizada_em: dados.realizadaEm,
    campaign_id: dados.campaignId || null,
    participantes: dados.participantes.trim() || null,
    notas: dados.notas.trim() || null,
    transcricao: dados.transcricao.trim() || null,
    resumo: dados.resumo.trim() || null,
    publicada: dados.publicada,
    updated_at: new Date().toISOString(),
  }

  let id = dados.id
  if (id) {
    const { data: atual } = await sb.from('reunioes').select('publicada').eq('id', id).maybeSingle()
    if (!atual) return { ok: false, error: 'Ata não encontrada.' }
    const publicadaEm = dados.publicada && !atual.publicada ? { publicada_em: new Date().toISOString() } : {}
    const { data: upd, error } = await sb.from('reunioes').update({ ...linha, ...publicadaEm })
      .eq('id', id).select('id')
    if (error) return { ok: false, error: error.message }
    // RLS nega update em silêncio (0 linhas) — quem não é do Atendimento cai aqui.
    if (!upd?.length) return { ok: false, error: 'Só o Atendimento (ou admin) edita atas.' }
  } else {
    const { data: ins, error } = await sb.from('reunioes').insert({
      ...linha, org_id: orgId, workspace_id: workspaceId, created_by: user.id,
      publicada_em: dados.publicada ? new Date().toISOString() : null,
    }).select('id').single()
    if (error) {
      return { ok: false, error: error.code === '42501' ? 'Só o Atendimento (ou admin) cria atas.' : error.message }
    }
    id = ins.id as string
  }

  // Passos: some o que saiu da lista; os que ficam só mudam texto/ordem — o
  // vínculo com a tarefa (activity_id) é gravado pelo createActivity, nunca aqui.
  const manter = dados.passos.map(p => p.id).filter((x): x is string => !!x)
  let del = sb.from('reuniao_passos').delete().eq('reuniao_id', id)
  if (manter.length) del = del.not('id', 'in', `(${manter.join(',')})`)
  const { error: delErr } = await del
  if (delErr) return { ok: false, error: delErr.message }

  const passoIds: string[] = []
  for (const [ordem, p] of dados.passos.entries()) {
    const texto = p.texto.trim()
    if (!texto) { passoIds.push(''); continue }
    const campos = {
      texto, ordem,
      responsavel: p.responsavel === 'cliente' ? 'cliente' : 'agencia',
      rascunho: p.responsavel === 'cliente' ? null : (p.rascunho.trim() || null),
    }
    if (p.id) {
      const { error } = await sb.from('reuniao_passos').update(campos).eq('id', p.id).eq('reuniao_id', id)
      if (error) return { ok: false, error: error.message }
      passoIds.push(p.id)
    } else {
      const { data, error } = await sb.from('reuniao_passos')
        .insert({ ...campos, reuniao_id: id, org_id: orgId }).select('id').single()
      if (error) return { ok: false, error: error.message }
      passoIds.push(data.id as string)
    }
  }

  rotas(orgSlug, workspaceId, id!)
  return { ok: true, id: id!, passoIds }
}

export async function excluirReuniao(
  orgSlug: string, workspaceId: string, id: string,
): Promise<Resultado<object>> {
  const user = await getUsuario()
  if (!user) return { ok: false, error: 'Sessão expirada. Entre de novo.' }
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from('reunioes').delete().eq('id', id).select('id')
  if (error) return { ok: false, error: error.message }
  if (!data?.length) return { ok: false, error: 'Só o Atendimento (ou admin) exclui atas.' }
  rotas(orgSlug, workspaceId)
  return { ok: true }
}

/** IA lê notas + transcrição e PROPÕE resumo e passos. Não grava. */
export async function organizarReuniao(
  workspaceId: string, notas: string, transcricao: string,
): Promise<Resultado<{ ata: AtaOrganizada }>> {
  const user = await getUsuario()
  if (!user) return { ok: false, error: 'Sessão expirada. Entre de novo.' }
  if (!notas.trim() && !transcricao.trim()) return { ok: false, error: 'Cole as notas ou a transcrição primeiro.' }

  const cfg = await iaDaOrg(await orgDoWorkspace(workspaceId))
  const provider = cfg?.apiKey ? cfg.provider : 'gemini'
  try {
    const ata = await organizarAta(notas, transcricao, cfg)
    if (!ata) return { ok: false, error: 'IA não configurada. Um administrador cadastra a chave em Configurações → Revisão IA.' }
    if (!ata.resumo && !ata.passos.length) return { ok: false, error: 'A IA não devolveu a ata. Tente de novo.' }
    return { ok: true, ata }
  } catch (error) {
    const supabase = await createClient()
    await logSystemError(supabase, { userId: user.id, context: 'ai:ata', error })
    return { ok: false, error: mensagemErroRevisao(error, provider, 'Não foi possível organizar a ata agora.') }
  }
}

/** Tarefas do cliente pra vincular a um passo (busca pelo título; ativas primeiro). */
export async function buscarTarefasCliente(
  workspaceId: string, busca: string,
): Promise<Resultado<{ tarefas: TarefaVinculavel[] }>> {
  const user = await getUsuario()
  if (!user) return { ok: false, error: 'Sessão expirada. Entre de novo.' }
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any).from('activities')
    .select('id, title, status, archived, campaign_id, campaigns!inner(name, workspace_id)')
    .eq('campaigns.workspace_id', workspaceId)
    .order('archived', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(20)
  // Cada palavra tem de aparecer no título, em qualquer ordem ("lacre mockup").
  for (const termo of busca.trim().split(/\s+/).filter(Boolean).slice(0, 5)) {
    q = q.ilike('title', `%${termo.replace(/[%_,()]/g, ' ')}%`)
  }
  const { data, error } = await q
  if (error) return { ok: false, error: error.message }
  type Row = { id: string; title: string; status: string; archived: boolean; campaign_id: string; campaigns: { name: string } }
  return {
    ok: true,
    tarefas: ((data ?? []) as Row[]).map(a => ({
      id: a.id, titulo: a.title, status: a.status, arquivada: a.archived,
      campaignId: a.campaign_id, campanha: a.campaigns?.name ?? '',
    })),
  }
}

/** Orçamentos do cliente pra vincular a um passo (título ou número). */
export async function buscarOrcamentosCliente(
  workspaceId: string, busca: string,
): Promise<Resultado<{ orcamentos: OrcamentoVinculavel[] }>> {
  const user = await getUsuario()
  if (!user) return { ok: false, error: 'Sessão expirada. Entre de novo.' }
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any).from('producao')
    .select('id, numero, serie, titulo, situacao, valor')
    .eq('workspace_id', workspaceId).eq('tipo', 'orcamento')
    .order('numero', { ascending: false })
    .limit(20)
  const termo = busca.trim()
  if (/^\d+$/.test(termo)) q = q.eq('numero', Number(termo))
  else for (const t of termo.split(/\s+/).filter(Boolean).slice(0, 5)) {
    q = q.ilike('titulo', `%${t.replace(/[%_,()]/g, ' ')}%`)
  }
  const { data, error } = await q
  if (error) return { ok: false, error: error.message }
  const rotulo = Object.fromEntries(ORCAMENTO_SITUACAO_LABELS.map(o => [o.value, o.label]))
  type Row = { id: string; numero: number | null; serie: string | null; titulo: string; situacao: string; valor: number | string }
  return {
    ok: true,
    orcamentos: ((data ?? []) as Row[]).map(o => ({
      id: o.id, numero: docNumero(o.serie, o.numero), titulo: o.titulo,
      situacao: rotulo[o.situacao] ?? o.situacao, valor: Number(o.valor ?? 0),
    })),
  }
}

/**
 * Desfecho de um passo salvo: tarefa existente, orçamento ou "feito" (consulta
 * que não vai pra pauta). Só mexe nos campos passados; null solta o vínculo.
 */
export async function ajustarPasso(
  orgSlug: string, workspaceId: string, reuniaoId: string, passoId: string,
  patch: { activityId?: string | null; producaoId?: string | null; feito?: boolean },
): Promise<Resultado<object>> {
  const user = await getUsuario()
  if (!user) return { ok: false, error: 'Sessão expirada. Entre de novo.' }
  const campos: Record<string, unknown> = {}
  if (patch.activityId !== undefined) campos.activity_id = patch.activityId
  if (patch.producaoId !== undefined) campos.producao_id = patch.producaoId
  if (patch.feito !== undefined) {
    campos.feito_em = patch.feito ? new Date().toISOString() : null
    campos.feito_por = patch.feito ? user.id : null
  }
  if (!Object.keys(campos).length) return { ok: true }
  const supabase = await createClient()
  // A RLS (mig. 306/307) só aceita tarefa/orçamento do MESMO cliente da ata.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from('reuniao_passos')
    .update(campos).eq('id', passoId).eq('reuniao_id', reuniaoId).select('id')
  if (error) return { ok: false, error: error.code === '42501' ? 'Isso não é deste cliente.' : error.message }
  if (!data?.length) return { ok: false, error: 'Só o Atendimento (ou admin) altera os passos.' }
  rotas(orgSlug, workspaceId, reuniaoId)
  return { ok: true }
}
