import 'server-only'
import { createSecureContext } from 'node:tls'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { cifrar, decifrar } from '@/lib/ai/segredo'

const exec = promisify(execFile)

/**
 * Certificado digital e-CNPJ (A1) da organização — o que autentica a agência na
 * Receita para emitir NFS-e (mig. 309).
 *
 * Guardado cifrado e lido só pela conexão direta (role flow_auth), como a chave
 * de IA. Quem alcança este arquivo emite nota em nome da agência.
 *
 * ⚠️ Armadilha do A1 brasileiro: quase todo .pfx de AC do ICP-Brasil vem com
 * criptografia legada (RC2-40/3DES), que o OpenSSL 3 — o do Node 22 — se recusa
 * a abrir, com um "unsupported" que parece senha errada. Por isso, quando o Node
 * não abre, o arquivo é RECONVERTIDO para algoritmo moderno no upload e guardado
 * já convertido. Sem isso, a emissão morre no primeiro handshake.
 */

export interface CertificadoPublico {
  nomeArquivo: string | null
  titular: string | null
  cnpj: string | null
  validoDe: string | null
  validoAte: string | null
  /** Dias até vencer (negativo = vencido). null quando não deu para ler a validade. */
  diasRestantes: number | null
  ambiente: 'restrita' | 'producao'
  atualizadoEm: string | null
  /** Está no banco mas não abre (o segredo do servidor mudou). */
  ilegivel: boolean
}

async function db() {
  return (await import('@/lib/db')).sql
}

/** Abre o .pfx com a senha. Erro = senha errada, arquivo inválido ou cifra legada. */
function abre(pfx: Buffer, senha: string): boolean {
  try {
    createSecureContext({ pfx, passphrase: senha })
    return true
  } catch {
    return false
  }
}

/**
 * Converte um .pfx legado para algoritmo moderno, mantendo a mesma senha.
 * Devolve null quando nem assim abre (aí é senha errada mesmo).
 */
async function converteLegado(pfx: Buffer, senha: string): Promise<Buffer | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'cert-'))
  const entrada = path.join(dir, 'in.pfx')
  const pem = path.join(dir, 'meio.pem')
  const saida = path.join(dir, 'out.pfx')
  try {
    await writeFile(entrada, pfx)
    const env = { ...process.env, CERT_PASS: senha }
    // -legacy liga o provider antigo do OpenSSL 3 só para LER o arquivo.
    // A senha vai por env: em argv ela apareceria na lista de processos.
    await exec('openssl', ['pkcs12', '-legacy', '-in', entrada, '-nodes', '-out', pem, '-passin', 'env:CERT_PASS'], { env })
    await exec('openssl', ['pkcs12', '-export', '-in', pem, '-out', saida, '-passout', 'env:CERT_PASS'], { env })
    const novo = await readFile(saida)
    return abre(novo, senha) ? novo : null
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Titular, CNPJ e validade — em claro no banco, para a tela avisar do vencimento. */
async function metadados(pfx: Buffer, senha: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'certm-'))
  const arq = path.join(dir, 'c.pfx')
  try {
    await writeFile(arq, pfx)
    const env = { ...process.env, CERT_PASS: senha }
    const { stdout: pem } = await exec('openssl',
      ['pkcs12', '-in', arq, '-nokeys', '-clcerts', '-passin', 'env:CERT_PASS'], { env, maxBuffer: 4 << 20 })
    const { X509Certificate } = await import('node:crypto')
    const x = new X509Certificate(pem)
    // O CN do e-CNPJ vem "RAZAO SOCIAL:00000000000000" — o CNPJ é o rabo.
    const cn = /CN=([^\n,/]+)/.exec(x.subject)?.[1]?.trim() ?? null
    const cnpj = cn && /:(\d{14})$/.exec(cn)?.[1] ? /:(\d{14})$/.exec(cn)![1] : null
    return {
      titular: cn ? cn.replace(/:(\d{14})$/, '').trim() : null,
      cnpj,
      validoDe: new Date(x.validFrom).toISOString(),
      validoAte: new Date(x.validTo).toISOString(),
    }
  } catch {
    // Sem metadados o certificado ainda serve; o que se perde é o aviso de vencimento.
    return { titular: null, cnpj: null, validoDe: null, validoAte: null }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function salvarCertificado(
  orgId: string, userId: string,
  arquivo: { bytes: Buffer; nome: string; senha: string },
): Promise<{ ok: true; info: CertificadoPublico } | { ok: false; erro: string }> {
  let pfx = arquivo.bytes
  if (!abre(pfx, arquivo.senha)) {
    const convertido = await converteLegado(pfx, arquivo.senha)
    if (!convertido) {
      return { ok: false, erro: 'Não foi possível abrir o certificado. Confira a senha e se o arquivo é .pfx ou .p12 (A1).' }
    }
    pfx = convertido
  }

  const meta = await metadados(pfx, arquivo.senha)
  const sql = await db()
  await sql`
    insert into org_certificado (org_id, arquivo_enc, senha_enc, nome_arquivo, titular, cnpj, valido_de, valido_ate, updated_at, updated_by)
    values (${orgId}, ${cifrar(pfx.toString('base64'))}, ${cifrar(arquivo.senha)}, ${arquivo.nome},
            ${meta.titular}, ${meta.cnpj}, ${meta.validoDe}, ${meta.validoAte}, now(), ${userId})
    on conflict (org_id) do update set
      arquivo_enc = excluded.arquivo_enc, senha_enc = excluded.senha_enc, nome_arquivo = excluded.nome_arquivo,
      titular = excluded.titular, cnpj = excluded.cnpj, valido_de = excluded.valido_de,
      valido_ate = excluded.valido_ate, updated_at = now(), updated_by = excluded.updated_by`

  const info = await certificadoPublico(orgId)
  return { ok: true, info: info! }
}

export async function certificadoPublico(orgId: string): Promise<CertificadoPublico | null> {
  const sql = await db()
  const rows = await sql`select * from org_certificado where org_id = ${orgId} limit 1`
  const r = rows[0]
  if (!r) return null
  const ate = r.valido_ate ? new Date(r.valido_ate) : null
  return {
    nomeArquivo: r.nome_arquivo ?? null,
    titular: r.titular ?? null,
    cnpj: r.cnpj ?? null,
    validoDe: r.valido_de ? new Date(r.valido_de).toISOString() : null,
    validoAte: ate ? ate.toISOString() : null,
    diasRestantes: ate ? Math.ceil((ate.getTime() - Date.now()) / 86400000) : null,
    ambiente: r.ambiente === 'producao' ? 'producao' : 'restrita',
    atualizadoEm: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    ilegivel: !decifrar(r.arquivo_enc),
  }
}

/** Material para o mTLS e para assinar. Uso interno — nunca sai numa resposta. */
export async function certificadoParaUso(orgId: string): Promise<{ pfx: Buffer; senha: string; ambiente: 'restrita' | 'producao' } | null> {
  const sql = await db()
  const rows = await sql`select arquivo_enc, senha_enc, ambiente from org_certificado where org_id = ${orgId} limit 1`
  const r = rows[0]
  if (!r) return null
  const b64 = decifrar(r.arquivo_enc)
  const senha = decifrar(r.senha_enc)
  if (!b64 || senha === null) return null
  return { pfx: Buffer.from(b64, 'base64'), senha, ambiente: r.ambiente === 'producao' ? 'producao' : 'restrita' }
}

export async function definirAmbiente(orgId: string, ambiente: 'restrita' | 'producao') {
  const sql = await db()
  await sql`update org_certificado set ambiente = ${ambiente}, updated_at = now() where org_id = ${orgId}`
}

export async function removerCertificado(orgId: string) {
  const sql = await db()
  await sql`delete from org_certificado where org_id = ${orgId}`
}
