import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { brCode } from './brcode'

/**
 * Pix da org para a régua de cobrança, com cache por org dentro do disparo.
 *
 * O cron percorre um aviso por título e todos são da mesma org — buscar a
 * configuração a cada título seria uma consulta por e-mail enviado.
 *
 * Fica FORA do `cobranca_payload` de propósito: aquela RPC é quem decide quem
 * cobrar (os três portões da régua), e mexer nela para carregar dado de
 * apresentação é risco sem necessidade.
 */
export interface PixOrg { chave: string; nome: string; cidade: string }

export function criarBuscadorPix(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
): (orgId: string) => Promise<PixOrg | null> {
  const cache = new Map<string, PixOrg | null>()
  return async (orgId: string) => {
    if (cache.has(orgId)) return cache.get(orgId) ?? null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).from('org_settings')
      .select('pix_chave, pix_nome, pix_cidade').eq('org_id', orgId).maybeSingle()
    const pix: PixOrg | null = data?.pix_chave
      ? { chave: data.pix_chave, nome: data.pix_nome ?? '', cidade: data.pix_cidade ?? '' }
      : null
    cache.set(orgId, pix)
    return pix
  }
}

/**
 * Código de um título. Devolve vazio quando a org não tem Pix cadastrado ou
 * quando o valor não é positivo — cobrança sem valor manda o cliente digitar,
 * que é justamente o que o código evita.
 *
 * Nunca derruba o envio: cobrança que não sai por causa do Pix é pior do que
 * cobrança sem Pix.
 */
export function pixDoTitulo(pix: PixOrg | null, valor: number, txid?: string): string {
  if (!pix?.chave || !(valor > 0)) return ''
  try {
    return brCode({ chave: pix.chave, nome: pix.nome, cidade: pix.cidade, valor, txid })
  } catch {
    return ''
  }
}
