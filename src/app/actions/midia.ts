'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

const FIELDS = [
  'workspace_id', 'campaign_id', 'veiculo_id', 'tipo', 'serie', 'titulo', 'emissao', 'job',
  'aut_veiculo', 'codigo_identificador', 'nota_fiscal', 'pecas', 'praca', 'abrangencia',
  'valor', 'desconto_pct', 'faturamento', 'prazo', 'data_base', 'dias_agencia',
  'primeira_veiculacao', 'ultima_veiculacao', 'contato', 'responsavel_id', 'situacao',
  'observacao', 'texto_legal',
] as const

function readMidiaData(formData: FormData) {
  const data: Record<string, string> = {}
  for (const f of FIELDS) data[f] = ((formData.get(f) as string) ?? '').trim()
  return data
}

/** Detalhe específico do tipo (inserções/peças/períodos/anúncio) chega como JSON. */
function readDetalhe(formData: FormData): unknown {
  try { return JSON.parse((formData.get('detalhe') as string) || '{}') } catch { return {} }
}

export async function createMidia(orgSlug: string, formData: FormData) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const data = readMidiaData(formData)
  const redirectTo = ((formData.get('redirect_to') as string) ?? '').trim()
  if (!data.workspace_id) return { error: 'Cliente obrigatório' }
  if (!data.veiculo_id) return { error: 'Veículo obrigatório' }
  if (!data.titulo) return { error: 'Título obrigatório' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  const payload = { ...data, detalhe: readDetalhe(formData) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('create_midia', {
    p_user_id: user.id, p_org_id: org.id, p_data: payload,
  })
  if (error) return { error: error.message }

  redirect(redirectTo || `/${orgSlug}/midias/simplificada`)
}

export async function updateMidia(orgSlug: string, midiaId: string, formData: FormData) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const data = readMidiaData(formData)
  const redirectTo = ((formData.get('redirect_to') as string) ?? '').trim()
  if (!data.titulo) return { error: 'Título obrigatório' }

  const payload = { ...data, detalhe: readDetalhe(formData) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('update_midia', {
    p_user_id: user.id, p_midia_id: midiaId, p_data: payload,
  })
  if (error) return { error: error.message }
  const dest = redirectTo || `/${orgSlug}/midias/simplificada`
  revalidatePath(dest)
  redirect(dest)
}

export async function setMidiaSituacao(orgSlug: string, midiaId: string, situacao: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_midia_situacao', {
    p_user_id: user.id, p_midia_id: midiaId, p_situacao: situacao,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midias/simplificada`)
}

/**
 * Duplica a mídia. Muito do trabalho é repetitivo (mesmo cliente, veículo,
 * localizações e valores, só muda a bisemana), então copiar é o caminho normal.
 *
 * A cópia SEMPRE nasce 'em_aberto' e sem número/NF, mesmo vindo de uma aprovada
 * ou faturada: número de documento é sequencial por série e nota fiscal pertence
 * ao original — herdar qualquer um dos dois criaria documento duplicado no
 * financeiro. O número novo é queimado pela create_midia na hora de gravar.
 */
export async function duplicarMidia(orgSlug: string, midiaId: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: m, error: readErr } = await sb.from('midias').select('*').eq('id', midiaId).single()
  if (readErr || !m) return { error: 'Mídia não encontrada' }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  const hoje = new Date().toISOString().slice(0, 10)
  const payload = {
    tipo: m.tipo,
    workspace_id: m.workspace_id ?? '', campaign_id: m.campaign_id ?? '', veiculo_id: m.veiculo_id ?? '',
    titulo: `${m.titulo ?? ''} (cópia)`.trim(),
    emissao: hoje,
    job: m.job ?? '', aut_veiculo: m.aut_veiculo ?? '',
    codigo_identificador: m.codigo_identificador ?? '',
    nota_fiscal: '',                       // pertence ao original
    pecas: m.pecas ?? '', praca: m.praca ?? '', abrangencia: m.abrangencia ?? '',
    valor: String(m.valor ?? 0), desconto_pct: String(m.desconto_pct ?? 20),
    faturamento: m.faturamento ?? '', prazo: m.prazo ?? '',
    data_base: m.data_base ?? '', dias_agencia: String(m.dias_agencia ?? 7),
    primeira_veiculacao: m.primeira_veiculacao ?? '', ultima_veiculacao: m.ultima_veiculacao ?? '',
    contato: m.contato ?? '', responsavel_id: m.responsavel_id ?? '',
    situacao: 'em_aberto',                 // decisão do Rafael: cópia sempre recomeça
    observacao: m.observacao ?? '', texto_legal: m.texto_legal ?? '',
    detalhe: m.detalhe ?? {},              // bisemana, período, localizações, produção
  }

  const { data: novoId, error } = await sb.rpc('create_midia', {
    p_user_id: user.id, p_org_id: org.id, p_data: payload,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midias/externas`)
  revalidatePath(`/${orgSlug}/midias/simplificada`)
  return { ok: true, id: novoId as string }
}

export async function setMidiaArchived(orgSlug: string, midiaId: string, archived: boolean) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('set_midia_archived', {
    p_user_id: user.id, p_midia_id: midiaId, p_archived: archived,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/midias/simplificada`)
}
