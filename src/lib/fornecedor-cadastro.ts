/**
 * Link para o FORNECEDOR atualizar o próprio cadastro (mig. 388) — a Flávia manda,
 * ele preenche sem conta. Mesmo modelo do link de cotação: o token é a credencial
 * e o banco é alcançado pela conexão direta (flow_auth) via funções definer.
 */
import { sql } from '@/lib/db'

export const tokenValido = (t: string) => /^[0-9a-f]{64}$/.test(t)

export interface CadastroResposta {
  razao: string
  cnpj: string
  tipo: string
  tags: string[]
  comercial: { nome: string; email: string; whatsapp: string }
  financeiro: { nome: string; email: string; whatsapp: string }
  cidade: string
  uf: string
  atende: string
  obs: string
}

export interface ConviteCadastro {
  id: string
  org_id: string
  fornecedor_id: string
  agencia: string
  respondido_em: string | null
  resposta: CadastroResposta | null
  fornecedor: {
    nome: string; razao: string | null; tax_id: string | null; tipo: string | null; tags: string[]
    emails: { tipo?: string; email?: string }[]
    telefones: { tipo?: string; numero?: string }[]
    enderecos: { tipo?: string; logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; uf?: string; cep?: string }[]
  }
  tipos: string[]
}

export async function cadastroPorToken(token: string): Promise<ConviteCadastro | null> {
  if (!tokenValido(token)) return null
  const rows = await sql<{ v: ConviteCadastro | null }[]>`select fornecedor_cadastro_por_token(${token}) as v`
  return rows[0]?.v ?? null
}
