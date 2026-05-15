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
  color: string
  bgColor: string
}

export const STATUS_CONFIG: StatusConfig[] = [
  // Interno
  { value: 'briefing', label: 'Briefing', group: 'internal', color: 'text-purple-700', bgColor: 'bg-purple-100' },
  { value: 'pendente_cliente', label: 'Pendente do cliente', group: 'internal', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  { value: 'planejamento', label: 'Planejamento', group: 'internal', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  { value: 'insight', label: 'Insight', group: 'internal', color: 'text-indigo-700', bgColor: 'bg-indigo-100' },
  { value: 'redacao', label: 'Redação', group: 'internal', color: 'text-cyan-700', bgColor: 'bg-cyan-100' },
  { value: 'design', label: 'Design', group: 'internal', color: 'text-pink-700', bgColor: 'bg-pink-100' },
  { value: 'edicao', label: 'Edição', group: 'internal', color: 'text-rose-700', bgColor: 'bg-rose-100' },
  { value: 'finalizacao', label: 'Finalização', group: 'internal', color: 'text-violet-700', bgColor: 'bg-violet-100' },
  { value: 'revisao_interna', label: 'Revisão interna', group: 'internal', color: 'text-amber-700', bgColor: 'bg-amber-100' },
  { value: 'validacao_atendimento', label: 'Validação do atendimento', group: 'internal', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  { value: 'orcamento', label: 'Orçamento', group: 'internal', color: 'text-lime-700', bgColor: 'bg-lime-100' },
  { value: 'producao_fornecedores', label: 'Produção fornecedores', group: 'internal', color: 'text-teal-700', bgColor: 'bg-teal-100' },
  { value: 'producao_audiovisual', label: 'Produção audiovisual', group: 'internal', color: 'text-sky-700', bgColor: 'bg-sky-100' },
  { value: 'validacao_midia', label: 'Validação de mídia', group: 'internal', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  { value: 'midia', label: 'Mídia', group: 'internal', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
  { value: 'social', label: 'Social', group: 'internal', color: 'text-fuchsia-700', bgColor: 'bg-fuchsia-100' },
  // Externo
  { value: 'aprovacao_cliente', label: 'Aprovação do cliente', group: 'external', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  { value: 'implantacao_digital', label: 'Implantação digital', group: 'external', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  { value: 'implantacao_off', label: 'Implantação off/orgânico', group: 'external', color: 'text-green-700', bgColor: 'bg-green-100' },
  // Encerrado
  { value: 'concluido', label: 'Concluído', group: 'done', color: 'text-gray-700', bgColor: 'bg-gray-100' },
]

export const PRIORITY_CONFIG = {
  low: { label: 'Baixa', color: 'text-gray-600', bgColor: 'bg-gray-100' },
  medium: { label: 'Média', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  high: { label: 'Alta', color: 'text-orange-600', bgColor: 'bg-orange-100' },
  urgent: { label: 'Urgente', color: 'text-red-600', bgColor: 'bg-red-100' },
}

export const COMPLEXITY_CONFIG = {
  simple: { label: 'Simples', color: 'text-green-600' },
  medium: { label: 'Médio', color: 'text-yellow-600' },
  complex: { label: 'Complexo', color: 'text-red-600' },
}
