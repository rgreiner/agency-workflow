'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { lerRevisaoConfig, salvarRevisaoConfig } from '@/lib/ai/revisao-config'
import { reviewText, mensagemErroRevisao } from '@/lib/ai/review'
import { modeloValido, type RevisaoEtapas, type RevisaoProvider } from '@/lib/ai/revisao-modelos'

/** org da URL + confere que a pessoa é owner/admin dela. */
async function orgAdmin(orgSlug: string): Promise<{ orgId: string; userId: string } | { error: string }> {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any)
    .from('organization_members').select('role').eq('org_id', org.id).eq('user_id', user.id).single() as { data: { role: string } | null }
  if (!m || !['owner', 'admin'].includes(m.role)) return { error: 'Só administradores alteram a Revisão IA.' }
  return { orgId: org.id, userId: user.id }
}

/** Salva a config. `apiKey` undefined mantém a chave; '' remove. */
export async function salvarRevisaoIA(orgSlug: string, dados: {
  enabled: boolean
  stages: RevisaoEtapas
  provider: RevisaoProvider
  model: string
  apiKey?: string
}): Promise<{ error?: string }> {
  const auth = await orgAdmin(orgSlug)
  if ('error' in auth) return auth
  const provider: RevisaoProvider = dados.provider === 'gemini' ? 'gemini' : 'anthropic'
  try {
    await salvarRevisaoConfig(auth.orgId, auth.userId, { ...dados, provider, model: modeloValido(provider, dados.model) })
  } catch (e) {
    console.error('[revisao-ia] salvar falhou', e)
    return { error: 'Não consegui salvar a configuração.' }
  }
  revalidatePath(`/${orgSlug}/settings/revisao`)
  return {}
}

/** Revisa uma frase com erro conhecido usando a config SALVA — prova chave + modelo. */
export async function testarRevisaoIA(orgSlug: string): Promise<{ ok?: string; error?: string }> {
  const auth = await orgAdmin(orgSlug)
  if ('error' in auth) return auth
  const cfg = await lerRevisaoConfig(auth.orgId)
  if (cfg.keyIlegivel) return { error: 'A chave salva não pôde ser lida (o segredo do servidor mudou). Cadastre a chave de novo.' }
  try {
    const r = await reviewText(cfg, 'A sua caza é bonita.')
    const e = r.errors[0]
    return { ok: e ? `Funcionou (${r.model}): Erro "${e.trecho}" - ${e.correcao}` : `A chave funciona (${r.model}), mas o modelo não apontou o erro de teste.` }
  } catch (e) {
    console.error('[revisao-ia] teste falhou', e)
    return { error: mensagemErroRevisao(e, cfg.provider) }
  }
}
