import 'server-only'
import https from 'node:https'
import { certificadoParaUso } from './certificado'

/**
 * Conexão com o Sistema Nacional da NFS-e (Emissor Nacional da Receita).
 *
 * A API exige mTLS: o certificado e-CNPJ da agência é a credencial do próprio
 * canal, não um token no cabeçalho. Medido do VPS em 29/09/2026, SEM certificado:
 * `sefin.producaorestrita` devolve 403 e `adn` derruba o handshake — os dois
 * confirmam que o caminho de rede existe e que o que falta é o certificado.
 *
 * Ambiente começa em `restrita` (homologação): nota emitida em produção é ato
 * público e não se desfaz sem processo.
 */

export const HOSTS = {
  restrita:  { sefin: 'sefin.producaorestrita.nfse.gov.br', adn: 'adn.producaorestrita.nfse.gov.br' },
  producao:  { sefin: 'sefin.nfse.gov.br',                  adn: 'adn.nfse.gov.br' },
} as const

export interface RespostaNfse {
  status: number
  corpo: string
  /** Falha de rede/TLS — não chegou a haver resposta HTTP. */
  erroRede?: string
}

/** Uma chamada autenticada pelo certificado da org. */
export async function chamarNfse(orgId: string, opts: {
  host?: 'sefin' | 'adn'
  caminho: string
  metodo?: 'GET' | 'POST'
  corpo?: string
  timeoutMs?: number
}): Promise<RespostaNfse | { erro: 'SEM_CERTIFICADO' }> {
  const cert = await certificadoParaUso(orgId)
  if (!cert) return { erro: 'SEM_CERTIFICADO' }

  const host = HOSTS[cert.ambiente][opts.host ?? 'sefin']
  return new Promise<RespostaNfse>(resolve => {
    const req = https.request(
      {
        host,
        port: 443,
        path: opts.caminho,
        method: opts.metodo ?? 'GET',
        pfx: cert.pfx,
        passphrase: cert.senha,
        timeout: opts.timeoutMs ?? 30_000,
        headers: opts.corpo
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(opts.corpo) }
          : {},
      },
      res => {
        let dados = ''
        res.setEncoding('utf8')
        res.on('data', p => { if (dados.length < 200_000) dados += p })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: dados }))
      },
    )
    // Erro de TLS aqui quase sempre é o certificado: expirado, senha trocada,
    // cadeia incompleta ou CNPJ sem credenciamento no ambiente.
    req.on('error', e => resolve({ status: 0, corpo: '', erroRede: `${(e as NodeJS.ErrnoException).code ?? ''} ${e.message}`.trim() }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, corpo: '', erroRede: 'TIMEOUT' }) })
    if (opts.corpo) req.write(opts.corpo)
    req.end()
  })
}

/**
 * Diagnóstico do canal: o handshake fecha com este certificado?
 *
 * Distingue os três "nãos" que parecem iguais na tela:
 *  · certificado não abre  → senha/arquivo;
 *  · TLS cai no handshake  → certificado recusado pela Receita (vencido, cadeia, credenciamento);
 *  · responde 401/403      → canal OK, falta autorização do CNPJ no ambiente.
 */
export async function testarConexao(orgId: string): Promise<{ ok: boolean; mensagem: string; detalhe: string }> {
  const cert = await certificadoParaUso(orgId)
  if (!cert) return { ok: false, mensagem: 'Nenhum certificado cadastrado.', detalhe: '' }

  const r = await chamarNfse(orgId, { caminho: '/', timeoutMs: 20_000 })
  if ('erro' in r) return { ok: false, mensagem: 'Nenhum certificado cadastrado.', detalhe: '' }

  const ambiente = cert.ambiente === 'producao' ? 'produção' : 'produção restrita'
  if (r.erroRede) {
    return {
      ok: false,
      mensagem: `O servidor da Receita recusou a conexão em ${ambiente}. Costuma ser certificado vencido, senha trocada ou CNPJ ainda não habilitado no ambiente.`,
      detalhe: r.erroRede,
    }
  }
  // Qualquer resposta HTTP já prova que o handshake com o certificado fechou.
  const ok = r.status > 0 && r.status < 500
  return {
    ok,
    mensagem: ok
      ? `Conexão estabelecida com a Receita em ${ambiente} (HTTP ${r.status}). O certificado foi aceito no handshake.`
      : `A Receita respondeu HTTP ${r.status} em ${ambiente}.`,
    detalhe: r.corpo.slice(0, 300),
  }
}
