import 'server-only'
import { emailLayout } from './layout'

/**
 * E-mail que leva um documento de RH para a pessoa. Vai sempre para o e-mail
 * PESSOAL verificado — o corporativo está sob controle do admin (que reseta
 * senha e administra a caixa), então não serve como canal privado. Mesma razão
 * do OTP da assinatura do espelho.
 */
const esc = (s: string) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const ROTULO: Record<string, string> = {
  holerite: 'Holerite', aso: 'ASO', contrato: 'Contrato', admissao: 'Documento de admissão',
  rescisao: 'Rescisão', atestado: 'Atestado', rg: 'Documento pessoal', outro: 'Documento',
}

export function rotuloDocumento(tipo: string | null): string {
  return ROTULO[tipo ?? 'outro'] ?? 'Documento'
}

/** 'AAAA-MM-DD' → 'agosto de 2026'. */
function competenciaLonga(iso: string | null): string | null {
  if (!iso) return null
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  const [y, m] = iso.split('-')
  const mi = Number(m) - 1
  return mi >= 0 && mi < 12 ? `${meses[mi]} de ${y}` : null
}

export function htmlDocumentoRh(o: {
  orgName: string; pessoa: string; tipo: string | null; competencia: string | null; arquivo: string
}): string {
  const rotulo = rotuloDocumento(o.tipo)
  const comp = competenciaLonga(o.competencia)
  const body =
    `<p style="margin:0 0 12px;">Olá, ${esc(o.pessoa.split(' ')[0] || o.pessoa)} —</p>` +
    `<p style="margin:0 0 14px;">Segue em anexo ${comp ? `seu ${rotulo.toLowerCase()} de <strong>${esc(comp)}</strong>` : `seu documento: <strong>${esc(rotulo)}</strong>`}.</p>` +
    `<p style="font-size:13px;color:#374151;background:#f6f6f4;border-radius:10px;padding:12px 14px;margin:0 0 14px;">
       <strong>${esc(o.arquivo)}</strong>
     </p>` +
    `<p style="margin:0;color:#6b7280;font-size:13px;">
       Enviado para o seu e-mail pessoal de propósito: é o canal que não passa pela administração da empresa.
       Qualquer divergência, responda esta mensagem ou fale com o RH.
     </p>`
  return emailLayout({
    heading: comp ? `${rotulo} — ${comp}` : rotulo,
    bodyHtml: body,
    footerNote: `${esc(o.orgName)} · documento de RH`,
  })
}
