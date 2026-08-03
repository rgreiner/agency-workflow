'use server'

import { randomInt } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { sendMail } from '@/lib/email/send'
import { revalidatePath } from 'next/cache'

/**
 * Código de uso único enviado ao E-MAIL PESSOAL do colaborador.
 *
 * Por que pessoal e não corporativo: o e-mail da empresa está no Workspace que o
 * próprio empregador administra — ele reseta a senha da conta. Como 2º fator isso
 * não vale nada, porque quem pode resetar a senha do Flow também pode ler o e-mail
 * corporativo. O fator só é independente se estiver FORA do alcance do empregador.
 */

const DOMINIOS_DA_EMPRESA = ['oneaone.com.br', 'amexcom.com.br']

function ehCorporativo(email: string): boolean {
  const d = email.toLowerCase().split('@')[1] ?? ''
  return DOMINIOS_DA_EMPRESA.includes(d)
}

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string, user }
}

/** Dispara o código. Para 'verificar_email' o destino vem do parâmetro; nas demais
 *  finalidades usa o e-mail pessoal já verificado na ficha. */
export async function enviarCodigo(
  orgSlug: string, colaboradorId: string,
  finalidade: 'verificar_email' | 'assinar_espelho' | 'assinar_termo',
  emailNovo?: string,
) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: colab } = await (c.supabase as any)
    .from('rh_colaborador').select('id, email_pessoal, email_pessoal_verificado_em')
    .eq('id', colaboradorId).maybeSingle()
  if (!colab) return { error: 'Ficha não encontrada' }

  let destino: string
  if (finalidade === 'verificar_email') {
    destino = (emailNovo ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destino)) return { error: 'E-mail inválido.' }
    if (ehCorporativo(destino)) {
      return { error: 'Use um e-mail pessoal (Gmail, Outlook…). O e-mail da empresa é administrado pelo empregador, então não serve como segundo fator.' }
    }
  } else {
    if (!colab.email_pessoal || !colab.email_pessoal_verificado_em) {
      return { error: 'Cadastre e verifique seu e-mail pessoal antes de assinar.' }
    }
    destino = colab.email_pessoal
  }

  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_otp_criar', {
    p_colaborador_id: colaboradorId, p_finalidade: finalidade, p_codigo: codigo, p_destino: destino,
  })
  if (error) return { error: error.message }

  const assunto = finalidade === 'verificar_email' ? 'Confirme seu e-mail pessoal' : 'Código para assinar seu ponto'
  try {
    await sendMail({
      to: destino,
      subject: `${assunto} — código ${codigo}`,
      html: `<p>Seu código é:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:4px;font-family:monospace">${codigo}</p>
<p>Vale por 10 minutos e só pode ser usado uma vez.</p>
<p style="color:#666;font-size:13px">Se não foi você que pediu, ignore este e-mail e avise o RH —
alguém pode estar tentando assinar um documento no seu nome.</p>`,
    })
  } catch (e) {
    return { error: e instanceof Error ? `Falha ao enviar o e-mail: ${e.message}` : 'Falha ao enviar o e-mail' }
  }

  // Nunca devolve o código; só onde foi parar (mascarado).
  const [u, d] = destino.split('@')
  return { ok: true, destino: `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}` }
}

/** Confirma o e-mail pessoal com o código recebido. */
export async function confirmarEmailPessoal(orgSlug: string, colaboradorId: string, email: string, codigo: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ok, error } = await (c.supabase as any).rpc('rh_otp_validar', {
    p_colaborador_id: colaboradorId, p_finalidade: 'verificar_email', p_codigo: codigo,
  })
  if (error) return { error: error.message }
  if (!ok) return { error: 'Código incorreto.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: e2 } = await (c.supabase as any).rpc('rh_confirmar_email_pessoal', {
    p_colaborador_id: colaboradorId, p_email: email,
  })
  if (e2) return { error: e2.message }
  revalidatePath(`/${orgSlug}/ponto/espelho`)
  return { ok: true }
}
