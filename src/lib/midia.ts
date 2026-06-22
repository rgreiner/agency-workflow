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
export const FATURAMENTO_PAGADOR: Record<string, 'cliente' | 'veiculo'> = {
  valor_bruto: 'cliente',
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

export const MIDIA_SITUACAO_OPTIONS = [
  { value: 'em_aberto', label: 'Em Aberto' },
  { value: 'aprovado', label: 'Aprovado' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'faturar', label: 'Faturar' },
  { value: 'faturado', label: 'Faturado' },
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

/** Converte string "1.234,56" / "1234.56" em número. */
export function parseMoney(input: string): number {
  const s = (input ?? '').trim().replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return isNaN(n) ? 0 : n
}
