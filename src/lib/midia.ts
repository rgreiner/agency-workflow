// Opções e rótulos do documento de Mídia (compartilhado entre form e listas).

export const MIDIA_TIPO_OPTIONS = [
  { value: 'impressa_jornal', label: 'Mídia Impressa - Jornal' },
  { value: 'impressa_revista', label: 'Mídia Impressa - Revista' },
  { value: 'eletronica', label: 'Mídia Eletrônica' },
  { value: 'externa', label: 'Mídia Externa' },
  { value: 'digital', label: 'Mídia Digital' },
  { value: 'outros', label: 'Outros' },
]

// 5 modos de faturamento. O que vai pro Financeiro é a comissão da agência;
// o modo define quem paga essa comissão (cliente x veículo). Ver memória regras-faturamento-midia.
export const MIDIA_FATURAMENTO_OPTIONS = [
  { value: 'valor_bruto', label: 'Valor Bruto' },
  { value: 'valor_bruto_comissao_cliente', label: 'Valor Bruto com Comissão Cliente' },
  { value: 'liquido_contra_cliente', label: 'Valor Líquido contra o Cliente' },
  { value: 'liquido_contra_cliente_ac_agencia', label: 'Valor Líquido contra o Cliente A/C Agência' },
  { value: 'liquido_contra_agencia', label: 'Valor Líquido contra a Agência' },
]

// "quem paga a comissão da agência" por modo de faturamento.
// valor_bruto → veículo (confirmado pela tela de Faturamento: lançamento "Desconto
// Padrão Agência" contra o veículo). As variações de "líquido contra o cliente"
// ainda serão confirmadas com um documento preenchido.
export const FATURAMENTO_PAGADOR: Record<string, 'cliente' | 'veiculo'> = {
  valor_bruto: 'veiculo',
  valor_bruto_comissao_cliente: 'cliente',
  liquido_contra_cliente: 'cliente',
  liquido_contra_cliente_ac_agencia: 'cliente',
  liquido_contra_agencia: 'veiculo',
}

export const MIDIA_PRAZO_OPTIONS = [
  { value: 'a_vista', label: 'À vista' },
  { value: '10_dfm', label: '10 DFM' },
  { value: '15_dfm', label: '15 DFM' },
  { value: '20_dfm', label: '20 DFM' },
  { value: '30_dfm', label: '30 DFM' },
  { value: 'dias_direto', label: 'Dias Direto' },
  { value: 'parcelado', label: 'Parcelado' },
]

export const MIDIA_ABRANGENCIA_OPTIONS = [
  { value: 'local', label: 'Local' },
  { value: 'regional', label: 'Regional' },
  { value: 'estadual', label: 'Estadual' },
  { value: 'nacional', label: 'Nacional' },
  { value: 'internacional', label: 'Internacional' },
]

// Estado unificado do handoff pro Financeiro: 'faturar' (= A Faturar, liberado →
// aparece na conferência) → 'faturado' (conferido, lançado no fluxo de caixa).
export const MIDIA_SITUACAO_OPTIONS = [
  { value: 'em_aberto', label: 'Em Aberto' },
  { value: 'aprovado', label: 'Aprovado' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'faturar', label: 'A Faturar' },
  { value: 'faturado', label: 'Faturado' },
]

// Situações que TIRAM o documento da aba "Ativos" (viram "como se fosse arquivado").
// PP/Fee/Mídia: liberado pro faturamento (faturar/faturado) ou cancelado.
export const SITUACOES_FORA = ['faturar', 'faturado', 'cancelado']
// Orçamento/Proposta: só saem quando faturado ou cancelado (o 'a faturar' segue visível).
export const SITUACOES_FORA_PROPOSTA = ['faturado', 'cancelado']

/**
 * Aplica na query de listagem o filtro da aba:
 *  - Ativos (archivedView=false): tudo que NÃO está em `fora` e não foi arquivado.
 *  - Arquivados (archivedView=true): arquivados manualmente OU nas situações `fora`
 *    (saem da tela "como se fosse arquivado", mas continuam consultáveis).
 */
export function filtrarPorAba<T>(q: T, archivedView: boolean, fora: string[] = SITUACOES_FORA): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyQ = q as any
  const lista = `(${fora.join(',')})`
  return (archivedView
    ? anyQ.or(`archived.eq.true,situacao.in.${lista}`)
    : anyQ.eq('archived', false).not('situacao', 'in', lista)) as T
}

// Fee: aprovar libera direto pro Financeiro (estado 'faturar' = A Faturar).
export const FEE_SITUACAO_OPTIONS = [
  { value: 'em_aberto', label: 'Em Aberto' },
  { value: 'faturar', label: 'A Faturar' },
  { value: 'cancelado', label: 'Cancelado' },
]

// Cores das pílulas de situação (hex inline — segue o padrão do app).
export const MIDIA_SITUACAO_COLORS: Record<string, { bg: string; text: string }> = {
  em_aberto: { bg: '#fef9c3', text: '#854d0e' },
  aprovado:  { bg: '#dcfce7', text: '#15803d' },
  cancelado: { bg: '#fee2e2', text: '#b91c1c' },
  faturar:   { bg: '#dbeafe', text: '#1d4ed8' },
  faturado:  { bg: '#e0e7ff', text: '#4338ca' },
}

export function labelOf(options: { value: string; label: string }[], value: string | null | undefined) {
  if (!value) return '—'
  return options.find(o => o.value === value)?.label ?? value
}

export function formatBRL(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0)
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (sem conversão de fuso). */
export function formatDateBR(d?: string | null): string {
  if (!d) return '—'
  const [y, mo, da] = d.slice(0, 10).split('-')
  return da && mo && y ? `${da}/${mo}/${y}` : '—'
}

/** Converte string "1.234,56" / "1234.56" em número. */
export function parseMoney(input: string): number {
  const s = (input ?? '').trim().replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return isNaN(n) ? 0 : n
}
