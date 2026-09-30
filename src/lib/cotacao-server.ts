import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { sql } from '@/lib/db'
import { uploadRoot } from '@/lib/uploads-volume'
import type { ArquivoRef, CotacaoItem, Resposta } from '@/lib/cotacao'
export { urlCotacao } from '@/lib/cotacao'

/**
 * Lado servidor da cotação: token, arquivos privados e a leitura do convite pela
 * página pública. O fornecedor não tem sessão — a página fala com o banco pela
 * conexão direta, SEMPRE a partir do token (nunca de id vindo do browser).
 */

export const novoToken = () => randomBytes(32).toString('hex')
export const tokenValido = (t: string) => /^[0-9a-f]{64}$/.test(t)

/** Arquivos da cotação ficam fora da rota pública /uploads (que exige sessão de membro). */
const PREFIXO = 'cotacao-privado/'
const TIPOS: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', txt: 'text/plain',
  doc: 'application/msword', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip', cdr: 'application/octet-stream', ai: 'application/postscript',
}
const INLINE = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif'])
export const MAX_ARQUIVO = 25 * 1024 * 1024
export const MAX_ARQUIVOS = 6

/** Grava o arquivo em cotacao-privado/<pasta>/<uuid>.<ext>; devolve a referência ou o erro. */
export async function gravarArquivo(pasta: string, file: File): Promise<ArquivoRef | { error: string }> {
  const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
  if (!TIPOS[ext]) return { error: 'Tipo não aceito (PDF, imagem, Word, Excel, ZIP)' }
  if (file.size > MAX_ARQUIVO) return { error: 'Arquivo muito grande (máx 25MB)' }
  const chave = `${PREFIXO}${pasta}/${randomUUID()}.${ext}`
  const dest = path.join(uploadRoot(), chave)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, Buffer.from(await file.arrayBuffer()))
  return { chave, nome: file.name.slice(0, 160) }
}

/** Resposta HTTP com o arquivo; imagem/PDF abrem na tela, o resto desce como download. */
export async function responderArquivo(ref: ArquivoRef | undefined): Promise<Response> {
  const rel = ref?.chave ?? ''
  if (!rel.startsWith(PREFIXO) || rel.includes('..')) return new Response('Não encontrado', { status: 404 })
  try {
    const buf = await readFile(path.join(uploadRoot(), rel))
    const ext = rel.split('.').pop()?.toLowerCase() ?? ''
    const inline = INLINE.has(ext)
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': TIPOS[ext] ?? 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(ref?.nome || 'arquivo')}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    return new Response('Não encontrado', { status: 404 })
  }
}

export interface ConvitePublico {
  id: string
  org_id: string
  cotacao_id: string
  fornecedor_id: string
  producao_id: string
  titulo: string
  agencia: string
  cliente: string | null
  responsavel: string | null
  responsavel_email: string | null
  mensagem: string | null
  prazo_resposta: string | null
  encerrada: boolean
  itens: CotacaoItem[]
  anexos: ArquivoRef[]
  fornecedor: { nome: string; tax_id: string | null; emails: { email: string }[]; telefones: { numero: string }[] }
  resposta: Resposta | null
  resposta_anexos: ArquivoRef[]
  dados_fornecedor: DadosFornecedor | null
  respondido_em: string | null
  recusado_em: string | null
  aberto_em: string | null
}

export interface DadosFornecedor { contato: string; cnpj: string; email: string; whatsapp: string }

export async function convitePorToken(token: string): Promise<ConvitePublico | null> {
  if (!tokenValido(token)) return null
  const rows = await sql<ConvitePublico[]>`
    select cv.id, cv.org_id, cv.cotacao_id, cv.fornecedor_id, c.producao_id,
           p.titulo, o.name as agencia, w.name as cliente,
           pr.full_name as responsavel, pr.email as responsavel_email,
           c.mensagem, to_char(c.prazo_resposta, 'YYYY-MM-DD') as prazo_resposta, c.encerrada,
           c.itens, c.anexos,
           jsonb_build_object('nome', f.name, 'tax_id', f.tax_id, 'emails', f.emails, 'telefones', f.telefones) as fornecedor,
           cv.resposta, cv.resposta_anexos, cv.dados_fornecedor,
           cv.respondido_em, cv.recusado_em, cv.aberto_em
      from public.cotacao_convites cv
      join public.cotacoes c on c.id = cv.cotacao_id
      join public.producao p on p.id = c.producao_id
      join public.organizations o on o.id = cv.org_id
      join public.fornecedores f on f.id = cv.fornecedor_id
      left join public.workspaces w on w.id = p.workspace_id
      left join public.profiles pr on pr.id = coalesce(p.responsavel_id, c.created_by)
     where cv.token = ${token}
     limit 1`
  return rows[0] ?? null
}

/** Prazo vencido = depois do fim do dia do prazo (horário de Brasília). */
export function cotacaoFechada(c: Pick<ConvitePublico, 'encerrada' | 'prazo_resposta'>): boolean {
  if (c.encerrada) return true
  if (!c.prazo_resposta) return false
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  return hoje > c.prazo_resposta
}
