import 'server-only'

/**
 * Leitura do XML autorizado da NFS-e para montar o DANFSe, no padrão da
 * **NT 008/2026 v1.02** (14/07/2026).
 *
 * Por que o Flow gera o PDF: a API de geração do DANFSe da Receita foi
 * SOBRESTADA em 03/08/2026 pela própria NT, que passou a responsabilidade — e um
 * layout obrigatório — para o sistema emissor. Medido em 01/10/2026: `sefin`
 * responde 501 e `adn` responde 404 em todos os caminhos de danfse. Não é
 * configuração nossa, é a API desligada.
 *
 * O DANFSe NÃO é o documento fiscal: o documento é o XML, guardado em
 * `nota_fiscal.xml_gz_b64`. Este PDF é a representação gráfica que vai ao
 * cliente junto do boleto.
 *
 * As descrições dos códigos (tpEmit, opSimpNac, tribISSQN…) são as do leiaute
 * oficial, copiadas dos XSD v1.01 — a NT manda imprimir a descrição, não o
 * número, e paráfrase nossa não é descrição oficial.
 */

const tag = (xml: string, t: string): string => {
  const m = new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml)
  return m ? m[1].trim() : ''
}

/**
 * Recorta o conteúdo de um bloco pelo nome.
 *
 * ⚠️ A abertura casa COM ATRIBUTOS. Procurar `<infDPS>` literal não acha nada:
 * no documento real a tag é `<infDPS Id="DPS4104...">`. Esse detalhe gerou um
 * DANFSe inteiro com tomador, série e valores VAZIOS — o PDF saía bonito, só
 * que com meia nota dentro. Por isso o render é testado contra XML autorizado
 * de verdade, nunca contra exemplo escrito à mão.
 *
 * Fecha no primeiro `</nome>`: serve porque nenhum bloco deste schema aninha
 * outro de mesmo nome.
 */
function bloco(xml: string, nome: string): string {
  const m = new RegExp(`<${nome}(\\s[^>]*)?>`).exec(xml)
  if (!m) return ''
  const i = m.index + m[0].length
  const f = xml.indexOf(`</${nome}>`, i)
  return f < 0 ? '' : xml.slice(i, f)
}

// ── Descrições do leiaute (XSD v1.01) ───────────────────────────────────────
const TP_EMIT: Record<string, string> = { '1': 'Prestador', '2': 'Tomador', '3': 'Intermediário' }
const TP_AMB: Record<string, string> = { '1': 'Produção', '2': 'Homologação' }
const AMB_GER: Record<string, string> = { '1': 'Prefeitura', '2': 'Sistema Nacional da NFS-e' }
const OP_SIMPLES: Record<string, string> = {
  '1': 'Não Optante',
  '2': 'Optante - Microempreendedor Individual (MEI)',
  '3': 'Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)',
}
const REG_SN: Record<string, string> = {
  '1': 'Regime de apuração dos tributos federais e municipal pelo SN',
  '2': 'Regime de apuração dos tributos federais pelo SN e ISSQN por fora do SN',
  '3': 'Regime de apuração dos tributos federais e municipal por fora do SN',
}
const TRIB_ISSQN: Record<string, string> = {
  '1': 'Operação tributável', '2': 'Imunidade', '3': 'Exportação de serviço', '4': 'Não Incidência',
}
const RET_ISSQN: Record<string, string> = {
  '1': 'Não Retido', '2': 'Retido pelo Tomador', '3': 'Retido pelo Intermediário',
}
/** Finalidade só existe dentro do grupo IBSCBS; sem o grupo, o campo fica vazio. */
const FIN_NFSE: Record<string, string> = { '0': 'NFS-e regular' }
const REG_ESP: Record<string, string> = {
  '0': 'Nenhum', '1': 'Ato Cooperado (Cooperativa)', '2': 'Estimativa', '3': 'Microempresa Municipal',
  '4': 'Notário ou Registrador', '5': 'Profissional Autônomo', '6': 'Sociedade de Profissionais', '9': 'Outros',
}

/** A NT manda cortar com reticências; o campo tem largura fixa no formulário. */
const corta = (t: string, max: number) => (t.length > max ? t.slice(0, max - 3).trimEnd() + '...' : t)

export interface Parte {
  nome: string
  documento: string
  inscricaoMunicipal: string
  fone: string
  email: string
  endereco: string
  municipio: string
  ibgeCep: string
}

export interface DanfseDados {
  chave: string
  numero: string
  serie: string
  nDps: string
  nDfse: string
  emissaoNfse: string
  emissaoDps: string
  competencia: string
  /** 1 = produção, 2 = homologação (produção restrita). */
  tpAmb: string
  tipoAmbiente: string
  ambienteGerador: string
  /** Código cru do ambiente gerador — é o que o DANFSe oficial imprime. */
  codAmbienteGerador: string
  municipioEmitente: string
  emitenteTipo: string
  situacao: string
  finalidade: string
  prestador: Parte & { simples: string; regimeSN: string }
  tomador: Parte | null
  servico: { local: string; codigo: string; nbs: string; descricaoCodigo: string; descricao: string }
  issqn: {
    tipoTributacao: string; municipioIncidencia: string; regimeEspecial: string
    bc: string; aliquota: string; retencao: string; apurado: string
  } | null
  federal: { pis: string; cofins: string; irrf: string; csll: string; cp: string }
  /**
   * Valores de IBS e CBS calculados PELA RECEITA e devolvidos na nota. Null
   * quando o grupo não foi enviado — que é o caso até a org ligar a Reforma.
   */
  ibsCbs: {
    bc: string
    ibsUf: { perc: string; valor: string }
    ibsMun: { perc: string; valor: string }
    cbs: { perc: string; valor: string }
    total: string
  } | null
  /** Bloco de totais, na divisão que a NT dá ao quadro final. */
  totais: {
    operacao: string
    descontoIncondicionado: string
    descontoCondicionado: string
    retencoes: string
    liquido: string
    ibsCbs: string
    liquidoComIbsCbs: string
  }
  complementares: string
  cancelada: boolean
  motivoCancelamento: string
  substituidaPor: string
}

const dataHora = (iso: string) => {
  if (!iso) return ''
  const [d, h] = iso.split('T')
  const [a, m, dia] = d.split('-')
  return h ? `${dia}/${m}/${a} ${h.slice(0, 8)}` : `${dia}/${m}/${a}`
}
const dataCurta = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

const moeda = (v: string) =>
  v ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''

const cep = (v: string) => v.replace(/^(\d{5})(\d{3})$/, '$1-$2')

const pct = (v: string) => (v ? `${Number(v).toFixed(2).replace('.', ',')}%` : '')

/** Soma dos valores de IBS e CBS, para o quadro de totais. */
function somaIbsCbs(ibs: NonNullable<DanfseDados['ibsCbs']>): string {
  const n = (v: string) => Number(v.replace(/[^\d,-]/g, '').replace(',', '.')) || 0
  return (n(ibs.ibsUf.valor) + n(ibs.ibsMun.valor) + n(ibs.cbs.valor)).toFixed(2)
}

export const formataDoc = (v: string) =>
  v.length === 14 ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  : v.length === 11 ? v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  : v

export const formataFone = (v: string) =>
  v.length >= 10 ? v.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : v

/** Nome e documento de prestador/tomador, que têm a MESMA estrutura no XML. */
function leParte(bl: string, municipioFallback = ''): Parte {
  const end = bloco(bl, 'end') || bloco(bl, 'enderNac')
  const nac = bloco(end, 'endNac') || end
  const rua = [tag(end, 'xLgr'), tag(end, 'nro'), tag(end, 'xCpl'), tag(end, 'xBairro')]
    .filter(Boolean).join(', ')
  const cMun = tag(nac, 'cMun')
  return {
    nome: corta(tag(bl, 'xNome'), 80),
    documento: formataDoc(tag(bl, 'CNPJ') || tag(bl, 'CPF') || tag(bl, 'NIF')),
    inscricaoMunicipal: tag(bl, 'IM'),
    fone: formataFone(tag(bl, 'fone')),
    email: tag(bl, 'email'),
    endereco: corta(rua, 80),
    municipio: tag(bl, 'xMun') || municipioFallback,
    ibgeCep: [cMun, cep(tag(nac, 'CEP'))].filter(Boolean).join(' / '),
  }
}

export function lerDanfse(xml: string, extra: {
  cancelada?: boolean
  motivoCancelamento?: string | null
  substituidaPor?: string | null
}): DanfseDados {
  const inf = bloco(xml, 'infNFSe') || xml
  const emit = bloco(inf, 'emit')
  const dps = bloco(inf, 'infDPS')
  const prestDps = bloco(dps, 'prest')
  const tomaDps = bloco(dps, 'toma')
  const serv = bloco(dps, 'serv')
  const valDps = bloco(dps, 'valores')
  const trib = bloco(valDps, 'trib')
  const tribMun = bloco(trib, 'tribMun')
  const tribFed = bloco(trib, 'tribFed')

  const uf = tag(bloco(emit, 'enderNac'), 'UF')
  const municipioEmi = [tag(inf, 'xLocEmi'), uf].filter(Boolean).join(' - ')

  // O prestador vem dos DOIS lados: nome e endereço o Sistema Nacional devolve
  // em `emit` (cadastro oficial); regime tributário só existe na DPS.
  const prestador = {
    ...leParte(emit, tag(inf, 'xLocEmi')),
    municipio: municipioEmi,
    inscricaoMunicipal: tag(prestDps, 'IM') || tag(emit, 'IM'),
    simples: OP_SIMPLES[tag(bloco(prestDps, 'regTrib'), 'opSimpNac')] ?? '',
    regimeSN: REG_SN[tag(bloco(prestDps, 'regTrib'), 'regApTribSN')] ?? '',
  }
  if (!prestador.documento) prestador.documento = formataDoc(tag(emit, 'CNPJ'))

  const tomador = tomaDps ? leParte(tomaDps) : null

  const valNfse = bloco(inf, 'valores')
  const ibs = leIbsCbs(inf)
  const vServ = tag(bloco(valDps, 'vServPrest'), 'vServ')
  const perc = tag(bloco(trib, 'totTrib'), 'pTotTribSN')
  const tributos = vServ && perc ? moeda(String((Number(vServ) * Number(perc)) / 100)) : ''

  // A nota traz os tributos de dois jeitos: o percentual do Simples
  // (`pTotTribSN`) ou os valores por esfera (`vTotTribFed/Est/Mun`). O DANFSe do
  // governo imprime por esfera quando existem — é mais informativo que o percentual.
  const porEsfera = bloco(bloco(trib, 'totTrib'), 'vTotTrib')
  const lei12741 = porEsfera
    ? `Totais aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: ${moeda(tag(porEsfera, 'vTotTribFed'))};`
      + ` Estaduais: ${moeda(tag(porEsfera, 'vTotTribEst'))}; Municipais: ${moeda(tag(porEsfera, 'vTotTribMun'))};`
    : perc
      ? `Totais aproximados dos Tributos cfe. Lei nº 12.741/2012: ${tributos} (${perc.replace('.', ',')}%).`
      : ''

  const complementares = [
    tag(inf, 'nDFSe') ? `Documento municipal nº ${tag(inf, 'nDFSe')}.` : '',
    lei12741,
    tag(bloco(valDps, 'infoCompl'), 'xInfComp'),
  ].filter(Boolean).join(' ')

  return {
    // Do XML inteiro: `inf` já é o CONTEÚDO de infNFSe, sem o atributo Id.
    // A NT manda imprimir a chave SEM o prefixo "NFS".
    chave: /<infNFSe[^>]*Id="NFS(\d+)"/.exec(xml)?.[1] ?? '',
    numero: tag(inf, 'nNFSe'),
    serie: tag(dps, 'serie'),
    nDps: tag(dps, 'nDPS'),
    nDfse: tag(inf, 'nDFSe'),
    emissaoNfse: dataHora(tag(inf, 'dhProc')),
    emissaoDps: dataHora(tag(dps, 'dhEmi')),
    competencia: dataCurta(tag(dps, 'dCompet')),
    tpAmb: tag(dps, 'tpAmb') || tag(inf, 'ambGer'),
    tipoAmbiente: TP_AMB[tag(dps, 'tpAmb')] ?? '',
    ambienteGerador: AMB_GER[tag(inf, 'ambGer')] ?? '',
    codAmbienteGerador: tag(inf, 'ambGer'),
    municipioEmitente: municipioEmi,
    emitenteTipo: TP_EMIT[tag(dps, 'tpEmit')] ?? '',
    situacao: tag(inf, 'cStat') === '100' ? 'NFS-e Gerada' : tag(inf, 'cStat'),
    finalidade: FIN_NFSE[tag(bloco(dps, 'IBSCBS'), 'finNFSe')] ?? '',
    prestador,
    tomador,
    servico: {
      local: [tag(inf, 'xLocPrestacao'), uf].filter(Boolean).join(' / '),
      codigo: tag(bloco(serv, 'cServ'), 'cTribNac'),
      nbs: tag(bloco(serv, 'cServ'), 'cNBS'),
      descricaoCodigo: tag(inf, 'xTribNac'),
      descricao: corta(tag(bloco(serv, 'cServ'), 'xDescServ'), 1300),
    },
    issqn: tribMun ? {
      tipoTributacao: TRIB_ISSQN[tag(tribMun, 'tribISSQN')] ?? '',
      municipioIncidencia: [tag(inf, 'xLocIncid'), uf].filter(Boolean).join(' / '),
      regimeEspecial: REG_ESP[tag(bloco(prestDps, 'regTrib'), 'regEspTrib')] ?? '',
      // Base, alíquota e ISSQN apurado quem calcula é o sistema: estão em
      // `infNFSe/valores`, não na DPS que mandamos.
      bc: moeda(tag(valNfse, 'vBC') || vServ),
      aliquota: pct(tag(valNfse, 'pAliqAplic') || tag(tribMun, 'pAliq')),
      retencao: RET_ISSQN[tag(tribMun, 'tpRetISSQN')] ?? '',
      apurado: moeda(tag(valNfse, 'vISSQN')),
    } : null,
    federal: {
      pis: moeda(tag(tribFed, 'vPis')),
      cofins: moeda(tag(tribFed, 'vCofins')),
      irrf: moeda(tag(tribFed, 'vRetIRRF')),
      csll: moeda(tag(tribFed, 'vRetCSLL')),
      cp: moeda(tag(tribFed, 'vRetCP')),
    },
    ibsCbs: ibs,
    totais: {
      operacao: moeda(vServ),
      descontoIncondicionado: moeda(tag(valDps, 'vDescIncond')),
      descontoCondicionado: moeda(tag(valDps, 'vDescCond')),
      retencoes: moeda(tag(valNfse, 'vTotalRet')),
      liquido: moeda(tag(valNfse, 'vLiq') || vServ),
      ibsCbs: ibs ? moeda(String(somaIbsCbs(ibs))) : '',
      liquidoComIbsCbs: ibs?.total || moeda(tag(valNfse, 'vLiq') || vServ),
    },
    complementares,
    cancelada: !!extra.cancelada,
    motivoCancelamento: extra.motivoCancelamento ?? '',
    substituidaPor: extra.substituidaPor ?? '',
  }
}

/**
 * Grupo IBS/CBS da NFS-e autorizada.
 *
 * Lido de `infNFSe`, não da DPS: as alíquotas e os valores são CALCULADOS pela
 * Receita a partir da classificação que enviamos — o emitente nunca manda
 * percentual. Em 2026 voltam 0,10% de IBS estadual e 0,90% de CBS, informativos.
 */
function leIbsCbs(inf: string): DanfseDados['ibsCbs'] {
  const g = bloco(inf, 'IBSCBS')
  if (!g) return null
  const val = bloco(g, 'valores')
  const tot = bloco(g, 'totCIBS')
  const gIBS = bloco(tot, 'gIBS')
  const pct = (v: string) => (v ? `${Number(v).toFixed(2).replace('.', ',')}%` : '')
  return {
    bc: moeda(tag(val, 'vBC')),
    ibsUf: { perc: pct(tag(bloco(val, 'uf'), 'pIBSUF')), valor: moeda(tag(bloco(gIBS, 'gIBSUFTot'), 'vIBSUF')) },
    ibsMun: { perc: pct(tag(bloco(val, 'mun'), 'pIBSMun')), valor: moeda(tag(bloco(gIBS, 'gIBSMunTot'), 'vIBSMun')) },
    cbs: { perc: pct(tag(bloco(val, 'fed'), 'pCBS')), valor: moeda(tag(bloco(tot, 'gCBS'), 'vCBS')) },
    total: moeda(tag(tot, 'vTotNF')),
  }
}

/** Link da consulta pública — é para ele que o QR Code aponta (NT 008, item 2.4.3). */
export function linkConsulta(chave: string): string {
  return `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${chave}`
}
