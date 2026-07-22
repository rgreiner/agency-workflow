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
