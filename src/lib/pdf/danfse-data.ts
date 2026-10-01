import 'server-only'

/**
 * Leitura do XML autorizado da NFS-e para montar o DANFSe.
 *
 * Por que o Flow gera o PDF: a API de geração do DANFSe da Receita foi
 * SOBRESTADA em 03/08/2026 pela NT 008/2026, que passou a responsabilidade (e um
 * layout padronizado) para o sistema emissor. Medido em 01/10/2026: `sefin`
 * responde 501 e `adn` responde 404 em todos os caminhos de danfse. Não é
 * configuração nossa, é a API desligada — não adianta procurar endpoint.
 *
 * O DANFSe NÃO é o documento fiscal: o documento é o XML, que fica guardado em
 * `nota_fiscal.xml_gz_b64`. Este PDF é a representação gráfica que se envia ao
 * cliente junto do boleto.
 */

/** O conteúdo de uma tag, dentro de um trecho. */
const tag = (xml: string, t: string): string => {
  const m = new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml)
  return m ? m[1].trim() : ''
}

/**
 * Recorta o conteúdo de um bloco pelo nome. Indispensável aqui: o XML da NFS-e
 * repete `CNPJ` e `xNome` no emitente e no tomador, e `valores` aparece duas
 * vezes (NFS-e e DPS). Ler a tag solta devolve a primeira ocorrência, que quase
 * nunca é a que se quer.
 *
 * ⚠️ A abertura casa COM ATRIBUTOS. Procurar `<infDPS>` literal não acha nada:
 * no documento real a tag é `<infDPS Id="DPS4104...">`, e o mesmo vale para
 * `<DPS versao="1.00">`. Esse detalhe esvaziou tomador, serviço, série e
 * competência no primeiro DANFSe gerado — o PDF saía inteiro, só que com meia
 * nota dentro. Por isso o render é testado contra o XML autorizado de verdade.
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

export interface DanfseDados {
  chave: string
  numero: string
  serie: string
  nDps: string
  /** Número do documento na numeração do município. */
  nDfse: string
  emitidoEm: string
  competencia: string
  /** 1 = produção, 2 = produção restrita (nota de teste). */
  ambiente: string
  prestador: { nome: string; cnpj: string; endereco: string; municipio: string; fone: string }
  tomador: { nome: string; cnpj: string }
  servico: { codigo: string; descricaoNacional: string; descricao: string; municipio: string }
  valores: { servico: string; liquido: string; percTributos: string; tributos: string }
  issqn: { tributacao: string; retencao: string }
  /** Vazio enquanto o grupo IBSCBS não é exigido (optante do Simples, até 2027). */
  ibsCbs: string
  cancelada: boolean
  motivoCancelamento: string
  substituidaPor: string
}

const data = (iso: string) => {
  if (!iso) return ''
  const [d, h] = iso.split('T')
  const [a, m, dia] = d.split('-')
  return h ? `${dia}/${m}/${a} ${h.slice(0, 5)}` : `${dia}/${m}/${a}`
}

const moeda = (v: string) =>
  v ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''

export function lerDanfse(xml: string, extra: {
  cancelada?: boolean
  motivoCancelamento?: string | null
  substituidaPor?: string | null
}): DanfseDados {
  const inf = bloco(xml, 'infNFSe') || xml
  const emit = bloco(inf, 'emit')
  const ender = bloco(emit, 'enderNac')
  const dps = bloco(inf, 'infDPS')
  const toma = bloco(dps, 'toma')
  const serv = bloco(dps, 'serv')
  const valDps = bloco(dps, 'valores')
  const trib = bloco(valDps, 'trib')

  const vServ = tag(bloco(valDps, 'vServPrest'), 'vServ')
  const perc = tag(bloco(trib, 'totTrib'), 'pTotTribSN')
  const tributos = vServ && perc ? moeda(String((Number(vServ) * Number(perc)) / 100)) : ''

  const rua = [tag(ender, 'xLgr'), tag(ender, 'nro')].filter(Boolean).join(', ')
  const bairro = tag(ender, 'xBairro')
  const cep = tag(ender, 'CEP').replace(/^(\d{5})(\d{3})$/, '$1-$2')

  return {
    // Do XML inteiro: `inf` já é o CONTEÚDO de infNFSe, sem o atributo Id.
    chave: /<infNFSe[^>]*Id="NFS(\d+)"/.exec(xml)?.[1] ?? '',
    numero: tag(inf, 'nNFSe'),
    serie: tag(dps, 'serie'),
    nDps: tag(dps, 'nDPS'),
    nDfse: tag(inf, 'nDFSe'),
    emitidoEm: data(tag(dps, 'dhEmi') || tag(inf, 'dhProc')),
    competencia: data(tag(dps, 'dCompet')),
    ambiente: tag(inf, 'ambGer') || tag(dps, 'tpAmb'),
    prestador: {
      nome: tag(emit, 'xNome'),
      cnpj: tag(emit, 'CNPJ'),
      endereco: [rua, bairro, cep].filter(Boolean).join(' · '),
      municipio: [tag(inf, 'xLocEmi'), tag(ender, 'UF')].filter(Boolean).join('/'),
      fone: tag(emit, 'fone'),
    },
    tomador: { nome: tag(toma, 'xNome'), cnpj: tag(toma, 'CNPJ') },
    servico: {
      codigo: tag(bloco(serv, 'cServ'), 'cTribNac'),
      descricaoNacional: tag(inf, 'xTribNac'),
      descricao: tag(bloco(serv, 'cServ'), 'xDescServ'),
      municipio: tag(inf, 'xLocPrestacao') || tag(inf, 'xLocIncid'),
    },
    valores: {
      servico: moeda(vServ),
      liquido: moeda(tag(bloco(inf, 'valores'), 'vLiq') || vServ),
      percTributos: perc,
      tributos,
    },
    issqn: {
      tributacao: tag(bloco(trib, 'tribMun'), 'tribISSQN') === '1' ? 'Operação tributável' : 'Ver XML',
      retencao: tag(bloco(trib, 'tribMun'), 'tpRetISSQN') === '1' ? 'Não retido' : 'Retido pelo tomador',
    },
    ibsCbs: bloco(dps, 'IBSCBS') ? 'Informado no XML' : '',
    cancelada: !!extra.cancelada,
    motivoCancelamento: extra.motivoCancelamento ?? '',
    substituidaPor: extra.substituidaPor ?? '',
  }
}

/** Link da consulta pública nacional — é para ele que o QR Code aponta (NT 008). */
export function linkConsulta(chave: string): string {
  return `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${chave}`
}

/** A chave em blocos de 4, como a NT 008 manda imprimir. */
export function chaveFormatada(chave: string): string {
  return (chave.match(/.{1,4}/g) ?? []).join(' ')
}
