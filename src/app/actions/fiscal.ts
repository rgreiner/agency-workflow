'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import {
  salvarCertificado, certificadoPublico, removerCertificado, definirAmbiente,
  type CertificadoPublico,
} from '@/lib/fiscal/certificado'
import { testarConexao } from '@/lib/fiscal/nfse-conexao'

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
  if (!m || !['owner', 'admin'].includes(m.role)) return { error: 'Só administradores mexem no certificado digital.' }
  return { orgId: org.id, userId: user.id }
}

/**
 * Recebe o .pfx em base64 (o arquivo é pequeno, e assim não precisa de rota de
 * upload nem de passar pelo volume: o certificado nunca toca o disco do servidor
 * em claro).
 */
export async function enviarCertificado(orgSlug: string, dados: { nome: string; base64: string; senha: string }):
  Promise<{ info?: CertificadoPublico; error?: string }> {
  const a = await orgAdmin(orgSlug)
  if ('error' in a) return { error: a.error }
  if (!dados.base64) return { error: 'Arquivo ausente.' }
  if (!dados.senha) return { error: 'Informe a senha do certificado.' }

  const bytes = Buffer.from(dados.base64, 'base64')
  if (bytes.length === 0) return { error: 'Arquivo vazio.' }
  if (bytes.length > 512 * 1024) return { error: 'Arquivo grande demais para um certificado A1 (máx. 512 KB).' }

  const r = await salvarCertificado(a.orgId, a.userId, { bytes, nome: dados.nome, senha: dados.senha })
  if (!r.ok) return { error: r.erro }
  revalidatePath(`/${orgSlug}/settings/fiscal`)
  return { info: r.info }
}

export async function lerCertificado(orgSlug: string): Promise<{ info: CertificadoPublico | null; error?: string }> {
  const a = await orgAdmin(orgSlug)
  if ('error' in a) return { info: null, error: a.error }
  return { info: await certificadoPublico(a.orgId) }
}

export async function excluirCertificado(orgSlug: string) {
  const a = await orgAdmin(orgSlug)
  if ('error' in a) return { error: a.error }
  await removerCertificado(a.orgId)
  revalidatePath(`/${orgSlug}/settings/fiscal`)
  return {}
}

export async function trocarAmbienteFiscal(orgSlug: string, ambiente: 'restrita' | 'producao') {
  const a = await orgAdmin(orgSlug)
  if ('error' in a) return { error: a.error }
  await definirAmbiente(a.orgId, ambiente)
  revalidatePath(`/${orgSlug}/settings/fiscal`)
  return {}
}

/** Bate na Receita com o certificado e diz em qual dos "nãos" a gente está. */
export async function testarReceita(orgSlug: string) {
  const a = await orgAdmin(orgSlug)
  if ('error' in a) return { error: a.error }
  return await testarConexao(a.orgId)
}
