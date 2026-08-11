'use server'

import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { buscarUsuarioPorEmail } from '@/lib/auth/usuarios'
import { conferirSenha } from '@/lib/auth/password'
import { TERMO_TEXTO } from '@/lib/rh/termo'

/**
 * Assinatura eletrônica AVANÇADA (Lei 14.063/2020 art. 4º II) — não é ICP-Brasil.
 * O que sustenta o valor probatório:
 *  · controle exclusivo → reautenticação por SENHA no ato (não basta estar logado)
 *  · integridade        → hash SHA-256 do snapshot canônico, congelado junto
 *  · momento            → hora do SERVIDOR (a do cliente é manipulável)
 *  · prova              → IP + user-agent + trilha do ciclo
 * O acordo prévio vem do termo de adesão (MP 2.200-2/2001 art. 10 §2º).
 */

/** Hash canônico: chaves ordenadas, para o mesmo conteúdo gerar sempre o mesmo hash. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
}
export async function hashDe(conteudo: unknown): Promise<string> {
  return createHash('sha256').update(canonical(conteudo)).digest('hex')
}

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string, user }
}

/** Confere a senha do usuário logado (ato deliberado de assinatura). */
async function reautenticar(email: string, senha: string): Promise<boolean> {
  if (!senha) return false
  const u = await buscarUsuarioPorEmail(email)
  if (!u?.senha_hash) return false
  return conferirSenha(senha, u.senha_hash)
}

async function origem() {
  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null
  return { ip, ua: h.get('user-agent') }
}

/** Assina o termo de adesão (uma vez por pessoa). */
export async function assinarTermo(orgSlug: string, colaboradorId: string, senha: string, codigo: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  if (!await reautenticar(c.user.email, senha)) return { error: 'Senha incorreta.' }
  // 2º fator: código enviado ao e-mail PESSOAL (fora do alcance do empregador).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: okOtp, error: eOtp } = await (c.supabase as any).rpc('rh_otp_validar', {
    p_colaborador_id: colaboradorId, p_finalidade: 'assinar_termo', p_codigo: codigo,
  })
  if (eOtp) return { error: eOtp.message }
  if (!okOtp) return { error: 'Código incorreto.' }

  const { ip, ua } = await origem()
  const hash = await hashDe({ termo: TERMO_TEXTO })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_assinar_termo', {
    p_colaborador_id: colaboradorId, p_hash: hash, p_texto: TERMO_TEXTO, p_ip: ip, p_ua: ua,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/ponto`)
  return { ok: true }
}

/** Assina o espelho de uma competência. papel: 'colaborador' (exige senha) | 'empresa'. */
export async function assinarEspelho(
  orgSlug: string, colaboradorId: string, competencia: string,
  papel: 'colaborador' | 'empresa', senha: string, codigo?: string,
) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  if (!await reautenticar(c.user.email, senha)) return { error: 'Senha incorreta.' }
  const comp = /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : null
  if (!comp) return { error: 'Competência inválida' }

  if (papel === 'colaborador') {
    // Toda divergência do ciclo precisa de ciência, e nenhum pedido de explicação
    // pode estar em aberto — senão "conferi e concordo" não significaria nada.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pend } = await (c.supabase as any).rpc('rh_ciencia_pendente', {
      p_colaborador_id: colaboradorId, p_competencia: comp,
    })
    const p = pend as { pendentes: unknown[]; explicacoes_abertas: number } | null
    if (p?.pendentes?.length) return { error: `Dê ciência das ${p.pendentes.length} divergência(s) do período antes de assinar.` }
    if (p?.explicacoes_abertas) return { error: `Você pediu ${p.explicacoes_abertas} explicação(ões) ainda sem resposta do RH.` }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: okOtp, error: eOtp } = await (c.supabase as any).rpc('rh_otp_validar', {
      p_colaborador_id: colaboradorId, p_finalidade: 'assinar_espelho', p_codigo: codigo ?? '',
    })
    if (eOtp) return { error: eOtp.message }
    if (!okOtp) return { error: 'Código incorreto.' }
  }

  // O snapshot vem do SERVIDOR no momento da assinatura — nunca do cliente,
  // senão daria para assinar um conteúdo diferente do que está no banco.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: esp, error: e1 } = await (c.supabase as any).rpc('rh_espelho', {
    p_org_id: c.orgId, p_colaborador_id: colaboradorId, p_competencia: comp,
  })
  if (e1) return { error: e1.message }

  const { ip, ua } = await origem()
  const hash = await hashDe(esp)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_assinar_espelho', {
    p_colaborador_id: colaboradorId, p_competencia: comp, p_hash: hash,
    p_conteudo: esp, p_papel: papel, p_ip: ip, p_ua: ua,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/ponto`)
  revalidatePath(`/${orgSlug}/rh/espelho/${colaboradorId}`)
  return { ok: true, hash: (data as { hash: string })?.hash }
}

/** RH reabre o ciclo assinado (invalida a assinatura, não apaga). */
export async function reabrirCiclo(orgSlug: string, colaboradorId: string, competencia: string, motivo: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const comp = /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : null
  if (!comp) return { error: 'Competência inválida' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_reabrir_ciclo', {
    p_colaborador_id: colaboradorId, p_competencia: comp, p_motivo: motivo,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/espelho/${colaboradorId}`)
  return { ok: true }
}

export interface Assinaturas {
  termo: { assinado_em: string; hash: string } | null
  espelho: { papel: string; hash: string; assinado_em: string; por: string | null; ip: string | null }[]
  historico: { papel: string; assinado_em: string; invalidada_em: string; motivo: string | null }[]
}

export async function carregarAssinaturas(orgSlug: string, colaboradorId: string, competencia: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const comp = /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : null
  if (!comp) return { error: 'Competência inválida' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_assinaturas', {
    p_colaborador_id: colaboradorId, p_competencia: comp,
  })
  if (error) return { error: error.message }
  return { assinaturas: data as Assinaturas }
}
