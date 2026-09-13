/**
 * Título padrão da casa: "AAMMDD - Veículo - Formato - Objetivo - Título da demanda".
 * Compor e decompor moram aqui pra o form de criação (client) e a página que
 * pré-preenche a duplicação (server) falarem a mesma língua.
 *
 * As listas vêm do CADASTRO da org (migration 285, Configurações → Pauta). O que
 * está aqui embaixo é só o fallback de org sem cadastro — mesmo desenho que o
 * `useStatusConfig` usa pros status.
 *
 * Por que essas opções e não as antigas: levantamento de 13/09/2026 sobre as 399
 * tarefas em produção. 9 dos 13 veículos e 7 dos 12 formatos da lista antiga
 * NUNCA tinham sido usados; "Meta" (38 usos) já era como a equipe fala de
 * Facebook e Instagram (0 cada); "Google Ads" tinha 0 uso enquanto "google"
 * digitado tinha 5. E o Objetivo nasceu porque conversão/captação/remarketing
 * (43 usos, todos dos últimos 90 dias) vinham se disfarçando de Formato.
 */
export const PAUTA_PADRAO = {
  veiculo: ['Meta', 'Google', 'Site', 'WhatsApp', 'YouTube', 'Outdoor', 'Impresso'],
  formato: [
    'Carrossel', 'Post', 'Vídeo', 'Reels', 'Card', 'Motion', 'Arte estática',
    'Identidade Visual', 'Stories', 'Apresentação', 'Página dupla', 'Placa', 'PDF',
  ],
  objetivo: ['Conversão', 'Captação', 'Remarketing', 'Search'],
} as const

/** As três listas como o resto do app as consome (cadastro da org ou fallback). */
export interface PautaListas {
  veiculo: string[]
  formato: string[]
  objetivo: string[]
}

export const PAUTA_LISTAS_PADRAO: PautaListas = {
  veiculo: [...PAUTA_PADRAO.veiculo],
  formato: [...PAUTA_PADRAO.formato],
  objetivo: [...PAUTA_PADRAO.objetivo],
}

/** Comparação de opção: sem caixa, sem espaço sobrando. */
const mesma = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
export const conhecido = (lista: readonly string[], v: string) =>
  !!v && lista.some(x => mesma(x, v))

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Data local em YYYY-MM-DD (não UTC: à noite o toISOString já é amanhã). */
export function hojeISO(): string {
  return ymd(new Date())
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + 'T00:00')
  d.setDate(d.getDate() + dias)
  return ymd(d)
}

/** YYYY-MM-DD → AAMMDD (prefixo do título). */
export function prefixoDaData(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1].slice(2)}${m[2]}${m[3]}` : ''
}

export interface TituloPartes {
  date: string
  veiculo?: string
  formato?: string
  objetivo?: string
  titulo: string
}

/**
 * Monta o título. Campo vazio simplesmente não entra — veículo é opcional
 * (decisão de 13/09/2026: 34% das tarefas são rotina administrativa e não têm
 * peça nenhuma; exigir veículo nelas só gerava lixo).
 *
 * Objeto e não posicional de propósito: com quatro campos opcionais na mesma
 * ordem, trocar dois de lugar por engano não daria erro de tipo.
 */
export function composedTitle({ date, veiculo, formato, objetivo, titulo }: TituloPartes): string {
  return [date, veiculo, formato, objetivo, titulo]
    .map(p => (p ?? '').trim())
    .filter(Boolean)
    .join(' - ')
}

export interface TituloDecomposto {
  veiculo: string
  formato: string
  objetivo: string
  titulo: string
}

/**
 * Decompõe um título existente (pra duplicar), sem a data.
 *
 * Continua POSICIONAL nos dois primeiros campos — é o que mantém compatibilidade
 * com os títulos antigos, cujos valores podem nem existir mais no cadastro (a
 * migration 285 tirou Instagram, TikTok, TV... da lista). O objetivo, esse sim, é
 * reconhecido por PERTENCIMENTO: é campo novo, então só existe onde foi de fato
 * escolhido, e assim título de 4 partes do layout antigo ("… - Formato - Título
 * com hífen") não vira objetivo por acidente.
 *
 * Com 2 segmentos o 1º é formato só se a lista de formatos o conhece e a de
 * veículos não — senão é veículo.
 */
export function decomporTitulo(title: string, listas: PautaListas = PAUTA_LISTAS_PADRAO): TituloDecomposto {
  const vazio: TituloDecomposto = { veiculo: '', formato: '', objetivo: '', titulo: '' }
  const partes = title.split(' - ').map(s => s.trim()).filter(Boolean)
  if (/^\d{6}$/.test(partes[0] ?? '')) partes.shift()

  if (partes.length === 0) return vazio
  if (partes.length === 1) return { ...vazio, titulo: partes[0] }
  if (partes.length === 2) {
    const [a, b] = partes
    const ehFormato = conhecido(listas.formato, a) && !conhecido(listas.veiculo, a)
    return ehFormato ? { ...vazio, formato: a, titulo: b } : { ...vazio, veiculo: a, titulo: b }
  }

  const [veiculo, formato, ...resto] = partes
  // Só assume objetivo se ainda sobrar título depois dele: "Meta - Post - Conversão"
  // é uma demanda chamada "Conversão", não um objetivo sem nome.
  if (resto.length >= 2 && conhecido(listas.objetivo, resto[0])) {
    return { veiculo, formato, objetivo: resto[0], titulo: resto.slice(1).join(' - ') }
  }
  return { veiculo, formato, objetivo: '', titulo: resto.join(' - ') }
}

/** Linha do cadastro de opções da pauta (migration 285). */
export interface OrgPautaOpcaoRow {
  id: string
  campo: 'veiculo' | 'formato' | 'objetivo'
  valor: string
  ordem: number
}

/**
 * Agrupa o cadastro nas três listas, preservando a ordem que veio do banco.
 *
 * Só cai no padrão quando NÃO HÁ cadastro nenhum (org que nunca rodou a 285).
 * Campo com lista vazia de propósito continua vazio — o admin que apagou todos
 * os objetivos não quer os quatro de fábrica de volta na cara dele.
 */
export function pautaListasDe(rows: readonly { campo: string; valor: string }[] | null | undefined): PautaListas {
  if (!rows?.length) return PAUTA_LISTAS_PADRAO
  const g: PautaListas = { veiculo: [], formato: [], objetivo: [] }
  for (const r of rows) {
    if (r.campo === 'veiculo' || r.campo === 'formato' || r.campo === 'objetivo') g[r.campo].push(r.valor)
  }
  return g
}
