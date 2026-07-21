// Numeração de documentos por série (PP 1897, MX 1626, Fee 64...).
// A série é gravada no banco (coluna `serie` em producao/midias). Aqui só formatamos.
// Ver migration 115_doc_series.sql e memória numeracao-documentos-serie.

/** "PP 1897". Sem série (ex.: orçamento interno) cai no fallback "nº 3". */
export function docNumero(serie: string | null | undefined, numero: number | null | undefined): string {
  if (numero == null) return '—'
  if (serie) return `${serie} ${numero}`
  return `nº ${numero}`
}

/** Rótulo curto da série pra chips/badges. */
export const SERIE_LABELS: Record<string, string> = {
  PP: 'Pedido de Produção',
  PR: 'Projeto/Proposta',
  FEE: 'Fee',
  MX: 'Mídia Externa',
  ME: 'Mídia Eletrônica',
  MI: 'Mídia Impressa',
  MS: 'Mídia Digital/Social',
  MD: 'Mídia CGN/Portais',
}

// Séries de mídia oferecidas quando o tipo é "digital" (as demais saem do tipo).
// Escolher a série na mão saiu em 21/07/2026: a série vem do TIPO da mídia
// (migration 136). Simplificada = MS (Google, Meta, carro de som);
// Digital = MD (CGN e portais). Antes as duas moravam na aba Digitais e o
// padrão era MS, então uma mídia de portal queimava número da sequência do
// Google/Meta sem ninguém perceber.
