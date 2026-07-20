import 'server-only'
import { Resend } from 'resend'

const FROM = process.env.RESEND_FROM ?? 'Flow <onboarding@resend.dev>'

// Instancia sob demanda — NUNCA no topo do módulo (new Resend() sem chave lança,
// e derrubaria qualquer chunk que só importe este arquivo).
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  return key ? new Resend(key) : null
}

/**
 * Envio único de e-mail do Flow. Devolve { error } em vez de lançar — quem chama
 * decide o que fazer (logSystemError em fluxo interativo, ou marcar cron_runs no
 * cron). Não configurado = erro claro, não crash.
 */
export interface MailAttachment {
  filename: string
  content: Buffer
}

/** Limite prático do Resend: ~40MB no total, e base64 infla ~33%. Barramos antes
 *  de mandar pra dar erro claro em vez de 4xx opaco do provedor. */
const MAX_ANEXOS_BYTES = 25 * 1024 * 1024

export async function sendMail(opts: {
  to: string | string[]; subject: string; html: string
  attachments?: MailAttachment[]
}): Promise<{ error?: string; id?: string }> {
  const resend = getResend()
  if (!resend) return { error: 'Envio de e-mail não configurado (defina RESEND_API_KEY).' }

  const anexos = opts.attachments ?? []
  const totalBytes = anexos.reduce((s, a) => s + a.content.length, 0)
  if (totalBytes > MAX_ANEXOS_BYTES) {
    return { error: `Anexos somam ${(totalBytes / 1024 / 1024).toFixed(1)}MB — o limite é ${MAX_ANEXOS_BYTES / 1024 / 1024}MB.` }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM, to: opts.to, subject: opts.subject, html: opts.html,
      ...(anexos.length ? { attachments: anexos.map(a => ({ filename: a.filename, content: a.content })) } : {}),
    })
    if (error) return { error: error.message }
    return { id: data?.id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao enviar e-mail' }
  }
}
