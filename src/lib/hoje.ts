/** Data de hoje (YYYY-MM-DD) no fuso do Brasil (BRT, UTC-3). Fora de componente
 *  de propósito: chamar Date.now() no render dispara a regra de pureza do React. */
export function hojeBRT(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}
