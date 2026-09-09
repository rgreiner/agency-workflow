/**
 * Telefone brasileiro como a agência digita (ver amostra de prod em 09/09/2026:
 * "45988244585", "(45) 3035-1390", "45 9104-9032", "17 3571.1460", "+55 45 …"):
 * o que importa é o número de dígitos, não a máscara.
 *
 *   10 = DDD + fixo (8)   |  11 = DDD + celular (9)
 *   12/13 = com o 55 na frente  |  8/9 = sem DDD (não dá pra ligar de fora)
 *
 * Celular antigo (DDD + 8 dígitos começando em 6–9) ganha o 9 na frente — o
 * WhatsApp só acha o número no formato atual.
 */
export const somenteDigitos = (s: string) => (s ?? '').replace(/\D/g, '')

/** DDD + número nacional (10 ou 11 dígitos), ou null quando não dá pra saber o DDD. */
export function telefoneNacional(numero: string): string | null {
  let d = somenteDigitos(numero)
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length === 10 && /^[6-9]/.test(d.slice(2))) d = d.slice(0, 2) + '9' + d.slice(2)
  return d.length === 10 || d.length === 11 ? d : null
}

/** Link de conversa no WhatsApp (wa.me exige só dígitos, com o país). */
export function linkWhatsApp(numero: string): string | null {
  const n = telefoneNacional(numero)
  return n ? `https://wa.me/55${n}` : null
}

/** "(45) 99988-2445" / "(45) 3035-1390"; o que não reconhece volta como veio. */
export function fmtTelefone(numero: string): string {
  const n = telefoneNacional(numero)
  if (!n) return (numero ?? '').trim()
  const ddd = n.slice(0, 2), resto = n.slice(2)
  return resto.length === 9
    ? `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5)}`
    : `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}`
}

/** CNPJ/CPF só com dígitos → com máscara; qualquer outra coisa volta como veio. */
export function fmtCpfCnpj(doc: string | null | undefined): string {
  const d = somenteDigitos(doc ?? '')
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  return (doc ?? '').trim()
}
