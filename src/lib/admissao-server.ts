import 'server-only'
import { randomBytes } from 'node:crypto'
import { sql } from '@/lib/db'

/**
 * Lado servidor da contratação. O candidato não tem sessão: a página pública
 * fala com o banco pela conexão direta (flow_auth), SEMPRE a partir do token —
 * nunca de um id vindo do browser. Mesmo caminho da cotação (mig. 311).
 */

export const novoToken = () => randomBytes(32).toString('hex')
export const tokenValido = (t: string) => /^[0-9a-f]{64}$/.test(t)

export interface DocPedido { tipo: string; label: string; obrigatorio?: boolean }
export interface DocEnviado { id: string; tipo: string; nome: string | null }

export interface PropostaPublica {
  id: string
  nome: string
  cargo: string | null
  carta: string | null
  agencia: string
  org_slug: string
  status: string
  expira_em: string | null
  aceita_em: string | null
  recusada_em: string | null
  data_inicio: string | null
  salario: string | null
  ficha: Record<string, unknown> | null
  ficha_em: string | null
  exame_em: string | null
  exame_local: string | null
  exame_horarios: string | null
  exame_observacao: string | null
  documentos_pedidos: DocPedido[]
  documentos: DocEnviado[]
}

export async function admissaoPorToken(token: string): Promise<PropostaPublica | null> {
  if (!tokenValido(token)) return null
  const rows = await sql`select rh_admissao_por_token(${token}) as v` as { v: PropostaPublica | null }[]
  return rows[0]?.v ?? null
}

/** Link vencido: a proposta continua legível, mas não aceita resposta. */
export function propostaVencida(p: PropostaPublica, hoje: string): boolean {
  return !!p.expira_em && !p.aceita_em && !p.recusada_em && hoje > p.expira_em
}

/** Pasta dos anexos do candidato no volume (fora de /uploads, que pede sessão). */
export const PREFIXO_ADMISSAO = 'admissao-privado'
