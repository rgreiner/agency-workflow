import 'server-only'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * DPS (Declaração de Prestação de Serviços) — o documento que o Flow manda para a
 * Receita e volta como NFS-e.
 *
 * Tudo aqui foi provado emitindo de verdade em produção restrita (30/09/2026,
 * chave 41048082217531601000123000000000000126090884913152). O validador da
 * Receita devolve o motivo exato de cada recusa, e cada regra abaixo custou um
 * erro — não mexer sem reproduzir contra a produção restrita.
 */

export interface DadosDps {
  /** CNPJ do prestador, só dígitos. */
  cnpjPrestador: string
  cnpjTomador: string
  nomeTomador: string
  /** Município de emissão e de prestação (IBGE). */
  codMunicipio: string
  serie: string
  numero: number
  valor: number
  descricao: string
  codigoServico: string
  percSimples: number
  tribIssqn: number
  tpRetIssqn: number
  /** 1 = produção, 2 = produção restrita. */
  ambiente: 1 | 2
  competencia?: string
}

const so = (t: string) => String(t ?? '').replace(/\D/g, '')
const esc = (t: string) => String(t ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!))

/**
 * Agora no fuso de Brasília. Gerar em UTC e carimbar "-03:00" manda a data três
 * horas para o futuro, e a Receita recusa com E0008 ("data de emissão posterior
 * à data do processamento"). Um minuto a menos cobre relógio fora de passo.
 */
function agoraBrasilia(): { dhEmi: string; dia: string } {
  const t = Date.now() - 3 * 3600_000
  return {
    dhEmi: new Date(t - 60_000).toISOString().replace(/\.\d+Z$/, '-03:00'),
    dia: new Date(t).toISOString().slice(0, 10),
  }
}

/** Id da DPS: 45 caracteres, posicional. */
export function idDps(d: Pick<DadosDps, 'codMunicipio' | 'cnpjPrestador' | 'serie' | 'numero'>): string {
  return 'DPS' + d.codMunicipio.padStart(7, '0') + '2' + so(d.cnpjPrestador).padStart(14, '0')
    + d.serie.padStart(5, '0') + String(d.numero).padStart(15, '0')
}

export function montarDps(d: DadosDps): { xml: string; id: string } {
  const id = idDps(d)
  const { dhEmi, dia } = agoraBrasilia()
  const competencia = d.competencia || dia
  const valor = d.valor.toFixed(2)

  // A ordem dos elementos é a do schema: trocar a ordem derruba com E1235.
  // Para ME/EPP: opSimpNac=3, regApTribSN obrigatório (E0166) e o grupo totTrib
  // leva pTotTribSN — indTotTrib é proibido (E0712).
  const xml = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">'
    + `<infDPS Id="${id}">`
    + `<tpAmb>${d.ambiente}</tpAmb><dhEmi>${dhEmi}</dhEmi><verAplic>Flow-1.0</verAplic>`
    + `<serie>${esc(d.serie)}</serie><nDPS>${d.numero}</nDPS><dCompet>${competencia}</dCompet>`
    + `<tpEmit>1</tpEmit><cLocEmi>${d.codMunicipio}</cLocEmi>`
    + `<prest><CNPJ>${so(d.cnpjPrestador)}</CNPJ>`
    + '<regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>'
    + `<toma><CNPJ>${so(d.cnpjTomador)}</CNPJ><xNome>${esc(d.nomeTomador).slice(0, 150)}</xNome></toma>`
    + `<serv><locPrest><cLocPrestacao>${d.codMunicipio}</cLocPrestacao></locPrest>`
    + `<cServ><cTribNac>${esc(d.codigoServico)}</cTribNac><xDescServ>${esc(d.descricao).slice(0, 2000)}</xDescServ></cServ></serv>`
    + `<valores><vServPrest><vServ>${valor}</vServ></vServPrest>`
    + `<trib><tribMun><tribISSQN>${d.tribIssqn}</tribISSQN><tpRetISSQN>${d.tpRetIssqn}</tpRetISSQN></tribMun>`
    + `<totTrib><pTotTribSN>${d.percSimples.toFixed(2)}</pTotTribSN></totTrib></trib></valores>`
    + '</infDPS></DPS>'

  return { xml, id }
}

/** Chave privada e certificado em PEM, tirados do .pfx. */
export async function chavesDoPfx(pfx: Buffer, senha: string): Promise<{ key: string; certB64: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sig-'))
  const arq = path.join(dir, 'c.pfx')
  try {
    await writeFile(arq, pfx)
    const env = { ...process.env, CERT_PASS: senha }
    const { stdout: keyPem } = await exec('openssl', ['pkcs12', '-in', arq, '-nocerts', '-nodes', '-passin', 'env:CERT_PASS'], { env, maxBuffer: 8 << 20 })
    const { stdout: certPem } = await exec('openssl', ['pkcs12', '-in', arq, '-nokeys', '-clcerts', '-passin', 'env:CERT_PASS'], { env, maxBuffer: 8 << 20 })
    const i = keyPem.indexOf('-----BEGIN PRIVATE KEY')
    const cert = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(certPem)
    if (i < 0 || !cert) throw new Error('Certificado sem chave ou sem certificado legível.')
    return { key: keyPem.slice(i), certB64: cert[1].replace(/\s+/g, '') }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Assinatura XMLDSIG enveloped sobre infDPS. Duas armadilhas, as duas fatais e as
 * duas invisíveis — o erro é sempre o mesmo E0714 genérico:
 *
 *  1. O digest é calculado sobre infDPS COM o xmlns herdado do pai. O C14N
 *     materializa o namespace no nó assinado; assinar `<infDPS Id=...>` enquanto
 *     a Receita confere `<infDPS xmlns=... Id=...>` nunca bate.
 *  2. Nada de tag vazia auto-fechada dentro do SignedInfo: o C14N expande
 *     `<Transform .../>` em `<Transform ...></Transform>`. Assinando a forma
 *     curta, a Receita recalcula sobre a longa e a assinatura morre.
 *
 * Por isso este XML é montado à mão, com as tags já expandidas: o que é assinado
 * é byte a byte o que vai no arquivo.
 */
export function assinarDps(xml: string, id: string, key: string, certB64: string): string {
  const NS = 'http://www.sped.fazenda.gov.br/nfse'
  const ini = xml.indexOf('<infDPS ')
  const fim = xml.indexOf('</infDPS>') + '</infDPS>'.length
  if (ini < 0 || fim < ini) throw new Error('XML da DPS sem infDPS.')
  const canon = xml.slice(ini, fim).replace('<infDPS ', `<infDPS xmlns="${NS}" `)
  const digest = crypto.createHash('sha1').update(canon, 'utf8').digest('base64')

  const signedInfo = '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">'
    + '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>'
    + '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>'
    + `<Reference URI="#${id}"><Transforms>`
    + '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>'
    + '<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform>'
    + '</Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod>'
    + `<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`

  const valor = crypto.createSign('RSA-SHA1').update(signedInfo, 'utf8').sign(key, 'base64')
  const assinatura = '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">' + signedInfo
    + `<SignatureValue>${valor}</SignatureValue>`
    + `<KeyInfo><X509Data><X509Certificate>${certB64}</X509Certificate></X509Data></KeyInfo></Signature>`

  return xml.replace('</DPS>', assinatura + '</DPS>')
}

export const empacotar = (xml: string) => zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64')
export const desempacotar = (b64: string) => zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')
