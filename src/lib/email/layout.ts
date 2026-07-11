import 'server-only'

/**
 * Template base dos e-mails do Flow (header laranja + card + footer). Todo e-mail
 * novo monta o corpo e passa por aqui, pra ficar consistente. HTML inline (é o que
 * clientes de e-mail entendem).
 */
export interface EmailLayoutOpts {
  /** Título grande dentro do card. */
  heading: string
  /** Parágrafos do corpo (HTML simples permitido). */
  bodyHtml: string
  /** Botão principal (opcional). */
  cta?: { label: string; url: string }
  /** Linha discreta no rodapé (opcional). */
  footerNote?: string
  /** Rótulo do header (default "Flow"). */
  brand?: string
}

const ORANGE = '#ea580c'

export function emailLayout({ heading, bodyHtml, cta, footerNote, brand = 'Flow' }: EmailLayoutOpts): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 40px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e5e7eb; overflow: hidden;">
    <div style="background: ${ORANGE}; padding: 24px 32px; text-align: center;">
      <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase;">${brand}</p>
    </div>
    <div style="padding: 32px;">
      <h1 style="font-size: 22px; font-weight: 700; color: #111827; margin: 0 0 12px;">${heading}</h1>
      <div style="color: #4b5563; font-size: 15px; line-height: 1.55;">${bodyHtml}</div>
      ${cta ? `<a href="${cta.url}" style="display: block; margin-top: 24px; background: ${ORANGE}; color: #ffffff; text-decoration: none; text-align: center; padding: 14px 24px; border-radius: 10px; font-weight: 600; font-size: 15px;">${cta.label}</a>` : ''}
    </div>
    <div style="border-top: 1px solid #f3f4f6; padding: 16px 32px;">
      <p style="color: #9ca3af; font-size: 11px; margin: 0; text-align: center;">${footerNote ?? 'Enviado automaticamente pelo Flow · One a One'}</p>
    </div>
  </div>
</body>
</html>`
}
