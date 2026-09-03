/**
 * Os status deixaram de ser fixos (migration 168): cada org cadastra os seus em
 * Configurações → Aparência. A união abaixo é a SEMENTE (o que toda org nasce
 * tendo) e serve de autocomplete; `(string & {})` deixa entrar status novos.
 * Os valores com papel de sistema — briefing, redacao, design, finalizacao,
 * aprovacao_cliente, concluido — existem sempre: o banco não deixa excluir.
 */
export type ActivityStatus = SeedStatus | (string & {})

export type SeedStatus =
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
  color: string    // Tailwind text class — só a semente tem; status novo vem ''
  bgColor: string  // Tailwind bg class — idem. Prefira sempre bg/text (hex).
  bg: string       // hex bg (used for inline styles + customization)
  text: string     // hex text (used for inline styles + customization)
  papel?: string | null  // inicial | conclusao | aprovacao_cliente | gate_* → não excluível
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

/** Linha de `org_status` (migration 168) — o cadastro de status da organização. */
export interface OrgStatusRow {
  valor: string
  label: string
  grupo: string
  bg: string
  txt: string
  ordem: number
  papel: string | null
}

/**
 * Monta a config de status a partir do cadastro da org. As classes Tailwind
 * (`color`/`bgColor`) só existem para os status da semente — status criado pela
 * org usa o hex, como todo o resto do app já faz.
 */
export function buildStatusConfig(rows: OrgStatusRow[] = []): StatusConfig[] {
  if (!rows.length) return STATUS_CONFIG
  return rows.map(r => {
    const seed = STATUS_CONFIG.find(s => s.value === r.valor)
    return {
      value: r.valor,
      label: r.label,
      group: (r.grupo === 'external' || r.grupo === 'done' ? r.grupo : 'internal') as StatusGroup,
      color: seed?.color ?? '',
      bgColor: seed?.bgColor ?? '',
      bg: r.bg,
      text: r.txt,
      papel: r.papel,
    }
  })
}

// `preenchido` = bandeira sólida. A Lista já usava essa régua (urgente/alta
// cheias, média/baixa vazadas); trazer para a config faz as outras telas
// mostrarem a MESMA coisa em vez de reinventar por tela.
// Bandeiras (02/09/2026): verde = Normal (o `medium` do banco, default de toda
// tarefa), amarela = Alta, vermelha = Urgente. `low` ("Baixa") ficou fora dos
// seletores — 3 tarefas em 380 usavam — mas segue válida onde já está gravada.
// `preenchido` = bandeira cheia nas listas (só as que pedem atenção).
export const PRIORITY_CONFIG = {
  low: { label: 'Baixa', color: 'text-gray-500 dark:text-gray-400', bgColor: 'bg-gray-100 dark:bg-gray-500/15', preenchido: false },
  medium: { label: 'Normal', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-100 dark:bg-green-500/15', preenchido: false },
  high: { label: 'Alta', color: 'text-amber-500 dark:text-amber-400', bgColor: 'bg-amber-100 dark:bg-amber-500/15', preenchido: true },
  urgent: { label: 'Urgente', color: 'text-red-600 dark:text-red-300', bgColor: 'bg-red-100 dark:bg-red-500/15', preenchido: true },
}

export const COMPLEXITY_CONFIG = {
  simple: { label: 'Simples', color: 'text-green-600 dark:text-green-400' },
  medium: { label: 'Médio', color: 'text-yellow-600 dark:text-yellow-400' },
  complex: { label: 'Complexo', color: 'text-red-600 dark:text-red-400' },
}
