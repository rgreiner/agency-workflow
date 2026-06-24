/** Garante esquema http(s) num link colado sem protocolo. */
export const ensureHttp = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`)

/** Domínio (sem www) de uma URL; '' se inválida. */
export function domainOf(u: string): string {
  try {
    return new URL(ensureHttp(u)).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
