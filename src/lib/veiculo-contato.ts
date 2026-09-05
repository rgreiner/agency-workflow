/**
 * Contato do veículo em uma linha, a partir dos jsonb do cadastro (`veiculos`):
 * `emails: [{tipo, email}]` e `telefones: [{tipo, numero}]`. Primeiro e-mail e
 * primeiro telefone preenchidos; null quando o cadastro não tem nenhum. Pura, para
 * servir tanto o servidor (fila, cadastro) quanto o cliente (modal).
 */
export function contatoDoVeiculo(emails: unknown, telefones: unknown): string | null {
  const primeiro = (lista: unknown, campo: string): string | null => {
    if (!Array.isArray(lista)) return null
    for (const it of lista as Record<string, unknown>[]) {
      const v = String(it?.[campo] ?? '').trim()
      if (v) return v
    }
    return null
  }
  const partes = [primeiro(emails, 'email'), primeiro(telefones, 'numero')].filter(Boolean) as string[]
  return partes.length ? partes.join(' · ') : null
}
