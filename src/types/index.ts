export type ActivityStatus =
  // Trabalho interno
  | 'briefing'
  | 'pendente_cliente'
  | 'planejamento'
  | 'insight'
  | 'redacao'
  | 'design'
  | 'edicao'
  | 'finalizacao'
  | 'revisao_interna'
  | 'validacao_atendimento'
  | 'orcamento'
  | 'producao_fornecedores'
  | 'producao_audiovisual'
  | 'validacao_midia'
  | 'midia'
  | 'social'
  // Cliente / Fornecedores
  | 'aprovacao_cliente'
  | 'implantacao_digital'
  | 'implantacao_off'
  // Encerrado
  | 'concluido'

export type ActivityPriority = 'low' | 'medium' | 'high' | 'urgent'
export type ActivityComplexity = 'simple' | 'medium' | 'complex'
export type MemberRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer'
export type OrgPlan = 'free' | 'starter' | 'pro' | 'enterprise'

export type StatusGroup = 'internal' | 'external' | 'done'

export interface StatusConfig {
  value: ActivityStatus
  label: string
  group: StatusGroup
  color: string    // Tailwind text class (default)
  bgColor: string  // Tailwind bg class (default)
  bg: string       // hex bg (used for inline styles + customization)
  text: string     // hex text (used for inline styles + customization)
}

export const STATUS_CONFIG: StatusConfig[] = [
  // Interno
  { value: 'briefing',              label: 'Briefing',                 group: 'internal', color: 'text-purple-700',  bgColor: 'bg-purple-100',  bg: '#f3e8ff', text: '#7e22ce' },
  { value: 'pendente_cliente',      label: 'Pendente do cliente',      group: 'internal', color: 'text-orange-700',  bgColor: 'bg-orange-100',  bg: '#ffedd5', text: '#c2410c' },
  { value: 'planejamento',          label: 'Planejamento',             group: 'internal', color: 'text-blue-700',    bgColor: 'bg-blue-100',    bg: '#dbeafe', text: '#1d4ed8' },
  { value: 'insight',               label: 'Insight',                  group: 'internal', color: 'text-orange-700',  bgColor: 'bg-orange-100',  bg: '#e0e7ff', text: '#4338ca' },
  { value: 'redacao',               label: 'Redação',                  group: 'internal', color: 'text-cyan-700',    bgColor: 'bg-cyan-100',    bg: '#cffafe', text: '#0e7490' },
  { value: 'design',                label: 'Design',                   group: 'internal', color: 'text-pink-700',    bgColor: 'bg-pink-100',    bg: '#fce7f3', text: '#be185d' },
  { value: 'edicao',                label: 'Edição',                   group: 'internal', color: 'text-rose-700',    bgColor: 'bg-rose-100',    bg: '#ffe4e6', text: '#be123c' },
  { value: 'finalizacao',           label: 'Finalização',              group: 'internal', color: 'text-violet-700',  bgColor: 'bg-violet-100',  bg: '#ede9fe', text: '#6d28d9' },
  { value: 'revisao_interna',       label: 'Revisão interna',          group: 'internal', color: 'text-amber-700',   bgColor: 'bg-amber-100',   bg: '#fef3c7', text: '#b45309' },
  { value: 'validacao_atendimento', label: 'Validação do atendimento', group: 'internal', color: 'text-yellow-700',  bgColor: 'bg-yellow-100',  bg: '#fefce8', text: '#854d0e' },
  { value: 'orcamento',             label: 'Orçamento',                group: 'internal', color: 'text-lime-700',    bgColor: 'bg-lime-100',    bg: '#f7fee7', text: '#4d7c0f' },
  { value: 'producao_fornecedores', label: 'Produção fornecedores',    group: 'internal', color: 'text-teal-700',    bgColor: 'bg-teal-100',    bg: '#ccfbf1', text: '#0f766e' },
  { value: 'producao_audiovisual',  label: 'Produção audiovisual',     group: 'internal', color: 'text-sky-700',     bgColor: 'bg-sky-100',     bg: '#e0f2fe', text: '#0369a1' },
  { value: 'validacao_midia',       label: 'Validação de mídia',       group: 'internal', color: 'text-blue-700',    bgColor: 'bg-blue-100',    bg: '#dbeafe', text: '#1d4ed8' },
  { value: 'midia',                 label: 'Mídia',                    group: 'internal', color: 'text-emerald-700', bgColor: 'bg-emerald-100', bg: '#d1fae5', text: '#065f46' },
  { value: 'social',                label: 'Social',                   group: 'internal', color: 'text-fuchsia-700', bgColor: 'bg-fuchsia-100', bg: '#fae8ff', text: '#86198f' },
  // Externo
  { value: 'aprovacao_cliente',     label: 'Aprovação do cliente',     group: 'external', color: 'text-orange-700',  bgColor: 'bg-orange-100',  bg: '#ffedd5', text: '#c2410c' },
  { value: 'implantacao_digital',   label: 'Implantação digital',      group: 'external', color: 'text-blue-700',    bgColor: 'bg-blue-100',    bg: '#dbeafe', text: '#1d4ed8' },
  { value: 'implantacao_off',       label: 'Implantação off/orgânico', group: 'external', color: 'text-green-700',   bgColor: 'bg-green-100',   bg: '#dcfce7', text: '#15803d' },
  // Encerrado
  { value: 'concluido',             label: 'Concluído',                group: 'done',     color: 'text-gray-700',    bgColor: 'bg-gray-100',    bg: '#f3f4f6', text: '#374151' },
]

// Merge org overrides into STATUS_CONFIG
export type StatusOverride = { value: string; label?: string; bg?: string; text?: string }

export function getMergedStatusConfig(overrides: StatusOverride[] = []): StatusConfig[] {
  if (!overrides.length) return STATUS_CONFIG
  return STATUS_CONFIG.map(s => {
    const o = overrides.find(x => x.value === s.value)
    if (!o) return s
    return { ...s, label: o.label ?? s.label, bg: o.bg ?? s.bg, text: o.text ?? s.text }
  })
}

export const PRIORITY_CONFIG = {
  low: { label: 'Baixa', color: 'text-gray-600', bgColor: 'bg-gray-100' },
  medium: { label: 'Média', color: 'text-blue-600 dark:text-blue-300', bgColor: 'bg-blue-100 dark:bg-blue-500/15' },
  high: { label: 'Alta', color: 'text-orange-600 dark:text-orange-300', bgColor: 'bg-orange-100 dark:bg-orange-500/15' },
  urgent: { label: 'Urgente', color: 'text-red-600 dark:text-red-300', bgColor: 'bg-red-100 dark:bg-red-500/15' },
}

export const COMPLEXITY_CONFIG = {
  simple: { label: 'Simples', color: 'text-green-600 dark:text-green-400' },
  medium: { label: 'Médio', color: 'text-yellow-600 dark:text-yellow-400' },
  complex: { label: 'Complexo', color: 'text-red-600 dark:text-red-400' },
}
