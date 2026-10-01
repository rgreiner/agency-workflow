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
