/**
 * Catálogo de provedores/modelos da Revisão IA — compartilhado entre a tela de
 * Configurações (client) e o servidor. Sem segredo aqui.
 *
 * O custo é a estimativa medida em 26/09/2026 para ~350 revisões/mês (volume de
 * agosto, se TODA saída de etapa fosse revisada). Com o botão sob demanda tende a
 * ser menos. Preços oficiais de 09/2026; o Gemini Flash dobra em 01/2027.
 */
export type RevisaoProvider = 'anthropic' | 'gemini'
export type RevisaoEtapa = 'redacao' | 'design' | 'finalizacao'
export type RevisaoEtapas = Record<RevisaoEtapa, boolean>

export const ETAPAS: { key: RevisaoEtapa; label: string; desc: string }[] = [
  { key: 'redacao',     label: 'Redação',     desc: 'Revisa o texto do Doc de Redação.' },
  { key: 'design',      label: 'Design',      desc: 'Revisa o texto das peças do Preview e confere com o texto aprovado da Redação.' },
  { key: 'finalizacao', label: 'Finalização', desc: 'Revisa o texto do arquivo final (imagem/PDF).' },
]

export const PROVEDORES: {
  value: RevisaoProvider
  label: string
  keyHint: string
  modelos: { value: string; label: string; custo: string }[]
}[] = [
  {
    value: 'anthropic',
    label: 'Claude (Anthropic)',
    keyHint: 'sk-ant-…  —  console.anthropic.com → API Keys',
    modelos: [
      { value: 'claude-opus-5',    label: 'Claude Opus 5',    custo: '≈ US$ 35–45/mês' },
      { value: 'claude-sonnet-5',  label: 'Claude Sonnet 5',  custo: '≈ US$ 12–18/mês' },
      { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', custo: '≈ US$ 3/mês' },
    ],
  },
  {
    value: 'gemini',
    label: 'Gemini (Google)',
    keyHint: 'AIza…  —  aistudio.google.com → Get API key',
    modelos: [
      { value: 'gemini-flash-latest',      label: 'Gemini Flash (mais recente)',      custo: '≈ US$ 3/mês' },
      { value: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite (mais recente)', custo: '≈ US$ 0,60/mês' },
    ],
  },
]

export const DEFAULT_ETAPAS: RevisaoEtapas = { redacao: true, design: true, finalizacao: true }

export function modeloPadrao(p: RevisaoProvider): string {
  return PROVEDORES.find(x => x.value === p)!.modelos[0].value
}

export function modeloValido(p: RevisaoProvider, m: string | null | undefined): string {
  const lista = PROVEDORES.find(x => x.value === p)!.modelos
  return m && lista.some(x => x.value === m) ? m : lista[0].value
}

/** Status que têm Revisão IA (o valor do status é a própria etapa). */
export function etapaRevisavel(status: string): RevisaoEtapa | null {
  return status === 'redacao' || status === 'design' || status === 'finalizacao' ? status : null
}
