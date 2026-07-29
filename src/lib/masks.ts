/** Máscaras de input pt-BR. Formatam ao digitar; guardam o valor já formatado. */

/** CPF: 000.000.000-00 (limita a 11 dígitos). */
export function maskCPF(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

/** Telefone BR: (00) 0000-0000 fixo ou (00) 00000-0000 celular. */
export function maskPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 10) {
    return d
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2')
  }
  return d
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2')
}
