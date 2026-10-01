/**
 * Quem recebe a nota fiscal da agência.
 *
 * Módulo puro (client e server) de propósito: o rótulo é usado na tela e a
 * lista é montada no servidor, e arquivo `'use server'` **só pode exportar
 * função async** — um `export const` ali derruba o módulo inteiro no build.
 * Já aconteceu duas vezes neste projeto.
 *
 * A agência emite para três cadastros diferentes, e qual deles depende do que
 * está sendo cobrado:
 *   · Fee e Job            → CLIENTE (workspaces)
 *   · comissão de mídia    → VEÍCULO
 *   · comissão de produção → FORNECEDOR
 */

export type TipoTomador = 'cliente' | 'fornecedor' | 'veiculo'

export const ROTULO_TOMADOR: Record<TipoTomador, string> = {
  cliente: 'Cliente', fornecedor: 'Fornecedor', veiculo: 'Veículo',
}

/** Quem pode receber a nota. Sem CNPJ no cadastro não entra: sem CNPJ não há nota. */
export interface Tomador {
  tipo: TipoTomador
  id: string
  nome: string
  razao: string | null
  cnpj: string
}

/**
 * O CNPJ fecha nos dígitos verificadores?
 *
 * A emissão conferia só o comprimento, e 14 dígitos errados passam. Descoberto
 * na atualização em massa dos cadastros (01/10): oito tinham CNPJ inválido —
 * TV Tarobá e Portal Catve entre eles, que são veículos faturados. A Receita
 * recusaria a nota, mas com uma mensagem dela, depois do envio; aqui a recusa
 * vem antes, dizendo onde está o erro.
 */
export function cnpjValido(valor: string): boolean {
  const c = String(valor ?? '').replace(/\D/g, '')
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false
  const dv = (base: string, pesos: number[]) => {
    const soma = base.split('').reduce((t, d, i) => t + Number(d) * pesos[i], 0)
    const r = soma % 11
    return String(r < 2 ? 0 : 11 - r)
  }
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  return c[12] === dv(c.slice(0, 12), p1) && c[13] === dv(c.slice(0, 13), p2)
}
