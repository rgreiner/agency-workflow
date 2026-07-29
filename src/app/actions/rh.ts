'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

export interface ColaboradorInput {
  nome: string
  cpf?: string | null
  email?: string | null
  telefone?: string | null
  cargo?: string | null
  tipo_vinculo?: string | null
  data_admissao?: string | null
  data_demissao?: string | null
  status?: string | null
  gestor_id?: string | null
  salario_atual?: string | null
  observacao?: string | null
  membro_user_id?: string | null
}

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string }
}

/** Cria (id null) ou edita um colaborador. Retorna o id. */
export async function salvarColaborador(orgSlug: string, id: string | null, data: ColaboradorInput) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: novoId, error } = await (c.supabase as any).rpc('rh_upsert_colaborador', {
    p_org_id: c.orgId, p_id: id, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh`)
  if (id) revalidatePath(`/${orgSlug}/rh/${id}`)
  return { id: novoId as string }
}

export async function setColaboradorArquivado(orgSlug: string, id: string, arquivado: boolean) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_set_colaborador_arquivado', { p_id: id, p_arquivado: arquivado })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh`)
}

export interface JornadaInput {
  entrada?: string; intervalo_ini?: string; intervalo_fim?: string; saida?: string
  flex_min?: number; dias_semana?: number[]
}

/** Salva a jornada: padrão da org (colaboradorId null) ou override por pessoa. */
export async function salvarJornada(orgSlug: string, colaboradorId: string | null, data: JornadaInput) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_upsert_jornada', {
    p_org_id: c.orgId, p_colaborador_id: colaboradorId, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ponto`)
  if (colaboradorId) revalidatePath(`/${orgSlug}/rh/${colaboradorId}`)
  return { ok: true }
}

/** Remove o override de uma pessoa → volta a herdar a jornada padrão da org. */
export async function resetarJornada(orgSlug: string, colaboradorId: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_reset_jornada', { p_colaborador_id: colaboradorId })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/${colaboradorId}`)
  return { ok: true }
}

/** Lista os documentos de um colaborador (sob demanda, p/ a modal na listagem). RLS filtra por rh_can. */
export async function listarDocumentos(orgSlug: string, colaboradorId: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any)
    .from('rh_documento')
    .select('id, tipo, nome, competencia, created_at')
    .eq('colaborador_id', colaboradorId)
    .order('created_at', { ascending: false })
  if (error) return { error: error.message }
  return { documentos: (data ?? []) as { id: string; tipo: string; nome: string | null; competencia: string | null; created_at: string }[] }
}

/** Registra um documento já enviado (chave vinda de /api/rh/upload). */
export async function adicionarDocumento(
  orgSlug: string, colaboradorId: string,
  doc: { tipo: string; nome: string; chave: string; competencia?: string | null },
) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_add_documento', {
    p_colaborador_id: colaboradorId, p_data: doc,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/${colaboradorId}`)
}

export async function excluirDocumento(orgSlug: string, colaboradorId: string, docId: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_delete_documento', { p_id: docId })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/${colaboradorId}`)
}

/** Importa uma competência de folha (linhas já extraídas e conferidas na tela).
 *  competencia = 'AAAA-MM'. Casa por CPF e cria quem falta (autoCriar). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function importarFolha(orgSlug: string, competencia: string, linhas: any[], autoCriar = true) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const comp = /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : null
  if (!comp) return { error: 'Competência inválida (use AAAA-MM)' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_importar_folha', {
    p_org_id: c.orgId, p_competencia: comp, p_linhas: linhas, p_auto_criar: autoCriar,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/folha`)
  revalidatePath(`/${orgSlug}/rh`)
  return { resultado: data as { linhas: number; criados: number; casados: number } }
}

export interface PlanoPessoa {
  colaborador_id: string | null; nome: string; liquido: number
  status: 'vinculado' | 'achado' | 'novo'
  lancamento_id: string | null; lanc_valor: number | null; lanc_venc: string | null; lanc_situacao: string | null
}
export interface FolhaPlano {
  competencia: string
  salarios: PlanoPessoa[]
  socios: { nome: string }[]
}

/** Plano de conciliação da competência: por pessoa, com o lançamento candidato (read-only). */
export async function carregarPlanoFolha(orgSlug: string, competencia: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const comp = /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : null
  if (!comp) return { error: 'Competência inválida' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_folha_plano', {
    p_org_id: c.orgId, p_competencia: comp,
  })
  if (error) return { error: error.message }
  return { plano: data as FolhaPlano }
}

export interface AplicarSalario {
  colaborador_id: string | null; nome: string
  acao: 'vincular' | 'criar' | 'ignorar'
  lancamento_id?: string | null; valor?: number; venc?: string
}

/** Aplica a conciliação: salários por pessoa (vincular/criar) + guias INSS/FGTS. */
export async function aplicarFolhaFinanceiro(orgSlug: string, i: {
  competencia: string; salarios: AplicarSalario[]
  inss: number; vencInss: string; fgts: number; vencFgts: string
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const comp = /^\d{4}-\d{2}$/.test(i.competencia) ? `${i.competencia}-01` : null
  if (!comp) return { error: 'Competência inválida' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_folha_aplicar', {
    p_org_id: c.orgId, p_competencia: comp, p_salarios: i.salarios,
    p_inss: i.inss || 0, p_venc_inss: i.vencInss || null,
    p_fgts: i.fgts || 0, p_venc_fgts: i.vencFgts || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/folha`)
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  return { resultado: data as { vinculados: number; criados: number; guias: number } }
}

// gerarLancamentosFolha (consolidado "Salários") foi substituído por
// carregarPlanoFolha + aplicarFolhaFinanceiro — agora é 1 lançamento POR PESSOA,
// sócios sem salário e vínculo ao lançamento manual existente (migration 161).
