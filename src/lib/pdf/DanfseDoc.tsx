/* eslint-disable jsx-a11y/alt-text */
// DANFSe v2.0 — Documento Auxiliar da NFS-e, padrão da NT 008/2026 v1.02.
//
// A Receita desligou a API que gerava este PDF em 03/08/2026 e passou o encargo
// ao sistema emissor, junto com um layout OBRIGATÓRIO (item 2.2.4: "devendo a
// disposição de campos obrigatoriamente obedecer ao disposto no respectivo
// anexo"). A lista de alterações permitidas é fechada (item 2.3) e **não inclui
// logotipo do emitente**: o logo do cabeçalho é o da NFS-e, e o canto direito é
// do município. Por isso este documento não leva a marca da agência — ela vive
// no e-mail que o acompanha, não aqui.
//
// O que a NT fixa e está implementado:
//  · retrato, A4, PÁGINA ÚNICA, margem lateral de 0,15–0,20 cm (2.2.1/2.2.2);
//  · cabeçalho: logomarca da NFS-e à esquerda, "DANFSe v2.0" ao centro,
//    município/ambiente à direita (2.4.3);
//  · QR Code ≥ 1,52 cm apontando para a consulta pública, com a legenda de três
//    linhas abaixo (2.4.3);
//  · homologação: "NFS-e SEM VALIDADE JURÍDICA" em vermelho no cabeçalho — NÃO
//    é marca d'água (observação do 2.4.3);
//  · cancelada/substituída: marca d'água diagonal, mínimo 50 pt, cinza K35 (2.5);
//  · títulos de bloco 7 pt negrito caixa alta; rótulos de campo 6 pt negrito;
//    conteúdo 7 pt; linhas de 0,5 pt e borda de página de 1 pt (2.2.3/2.4);
//  · sombreamento cinza 5% no cabeçalho, nos títulos de bloco e nos campos
//    "Emitente da NFS-e" e "Valor Líquido" (2.2.3).
//
// Onde há desvio consciente: a NT pede Arial (títulos) e Microsoft Sans Serif
// (conteúdo). Nenhuma das duas é redistribuível; o react-pdf traz Helvetica,
// metricamente compatível com Arial, que é o substituto usual. O bloco
// "Canhoto" é opcional e foi suprimido (2.3.3).

import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import type { DanfseDados } from './danfse-data'
import { LOGO_NFSE } from './logo-nfse'

const PRETO = '#000000'
const LINHA = '#000000'
const SOMBRA = '#f2f2f2'   // cinza 5%
const CINZA_K35 = '#a6a6a6'
const VERMELHO = '#e3000f' // M100/Y100

// 1 cm = 28,3465 pt. A margem é 0,15 cm e o corpo começa 0,30 cm dentro dela.
const cm = (v: number) => v * 28.3465

const s = StyleSheet.create({
  page: {
    paddingHorizontal: cm(0.15) + cm(0.3),
    paddingTop: cm(0.3),
    paddingBottom: cm(0.3),
    fontSize: 7,
    color: PRETO,
    fontFamily: 'Helvetica',
  },
  // Borda de 1 pt em volta de todo o corpo impresso.
  moldura: { borderWidth: 1, borderColor: LINHA, flexGrow: 1 },

  cabecalho: { flexDirection: 'row', alignItems: 'center', backgroundColor: SOMBRA,
               borderBottomWidth: 0.5, borderBottomColor: LINHA, minHeight: cm(1.16) },
  cabLogo: { width: cm(4.6), paddingLeft: cm(0.19), justifyContent: 'center' },
  logo: { width: cm(4.0) },
  cabCentro: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  cabTitulo: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  cabSemValidade: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: VERMELHO, marginTop: 1 },
  cabDir: { width: cm(5.09), paddingRight: cm(0.19), alignItems: 'flex-end', justifyContent: 'center' },
  cabMunicipio: { fontSize: 8 },
  cabAmbiente: { fontSize: 6 },

  // Grade: cada linha é uma faixa com divisória de 0,5 pt.
  linha: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINHA },
  celula: { paddingHorizontal: 3, paddingVertical: 2, borderRightWidth: 0.5, borderRightColor: LINHA, minWidth: 0 },
  celulaFim: { paddingHorizontal: 3, paddingVertical: 2, minWidth: 0 },
  sombreada: { backgroundColor: SOMBRA },

  rotuloBloco: { fontSize: 7, fontFamily: 'Helvetica-Bold' },
  rotulo: { fontSize: 6, fontFamily: 'Helvetica-Bold' },
  valor: { fontSize: 7 },

  qr: { width: cm(1.62), height: cm(1.62) },
  qrLegenda: { fontSize: 6, textAlign: 'center', lineHeight: 1.15, paddingHorizontal: 2, paddingTop: 2 },

  marca: {
    position: 'absolute', top: cm(12), left: 0, right: 0, textAlign: 'center',
    fontSize: 54, fontFamily: 'Helvetica-Bold', color: CINZA_K35,
    transform: 'rotate(-30deg)',
  },
})

/** Largura em fração do corpo de 20,40 cm, como a NT tabela os campos. */
const larg = (cmLargura: number) => `${(cmLargura / 20.4) * 100}%`

function Campo({ rotulo, valor, w, fim, sombreada }: {
  rotulo: string; valor: string; w: number; fim?: boolean; sombreada?: boolean
}) {
  return (
    <View style={[fim ? s.celulaFim : s.celula, { width: larg(w) }, sombreada ? s.sombreada : {}]}>
      <Text style={s.rotulo}>{rotulo}</Text>
      <Text style={s.valor}>{valor || ' '}</Text>
    </View>
  )
}

/** Título do bloco: ocupa a primeira célula da linha, como no Anexo I. */
function TituloBloco({ texto, w = 5.09 }: { texto: string; w?: number }) {
  return (
    <View style={[s.celula, s.sombreada, { width: larg(w), justifyContent: 'center' }]}>
      <Text style={s.rotuloBloco}>{texto}</Text>
    </View>
  )
}

/** Bloco suprimido, com a frase exata que a NT manda imprimir no lugar (2.3). */
function BlocoSuprimido({ texto }: { texto: string }) {
  return (
    <View style={s.linha}>
      <View style={[s.celulaFim, s.sombreada, { width: '100%' }]}>
        <Text style={s.rotuloBloco}>{texto}</Text>
      </View>
    </View>
  )
}

export function DanfseDoc({ d, qrDataUrl }: { d: DanfseDados; qrDataUrl: string }) {
  const homologacao = d.tpAmb === '2'
  // Uma marca d'água só: substituída diz mais que cancelada, porque a
  // substituída foi cancelada POR outra nota.
  const marca = d.substituidaPor ? 'SUBSTITUÍDA' : d.cancelada ? 'CANCELADA' : ''

  return (
    <Document title={`DANFSe ${d.numero}`} author={d.prestador.nome}>
      <Page size="A4" style={s.page}>
        {marca ? <Text style={s.marca} fixed>{marca}</Text> : null}

        <View style={s.moldura}>
          {/* ── Cabeçalho (2.4.3) ───────────────────────────────────────── */}
          <View style={s.cabecalho}>
            <View style={s.cabLogo}><Image src={LOGO_NFSE} style={s.logo} /></View>
            <View style={s.cabCentro}>
              <Text style={s.cabTitulo}>DANFSe v2.0</Text>
              <Text style={s.cabTitulo}>Documento Auxiliar da NFS-e</Text>
              {homologacao && <Text style={s.cabSemValidade}>NFS-e SEM VALIDADE JURÍDICA</Text>}
            </View>
            <View style={s.cabDir}>
              <Text style={s.cabMunicipio}>Município: {d.municipioEmitente}</Text>
              <Text style={s.cabAmbiente}>{d.ambienteGerador}</Text>
              <Text style={s.cabAmbiente}>{d.tipoAmbiente}</Text>
            </View>
          </View>

          {/* ── Dados da NFS-e, com o QR Code à direita ──────────────────── */}
          <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINHA }}>
            <View style={{ width: larg(15.3), borderRightWidth: 0.5, borderRightColor: LINHA }}>
              <View style={s.linha}>
                <Campo rotulo="CHAVE DE ACESSO DA NFS-e" valor={d.chave} w={15.3} fim />
              </View>
              <View style={s.linha}>
                <Campo rotulo="NÚMERO DA NFS-e" valor={d.numero} w={5.09} />
                <Campo rotulo="COMPETÊNCIA DA NFS-e" valor={d.competencia} w={5.09} />
                <Campo rotulo="DATA E HORA DA EMISSÃO DA NFS-e" valor={d.emissaoNfse} w={5.09} fim />
              </View>
              <View style={s.linha}>
                <Campo rotulo="NÚMERO DA DPS" valor={d.nDps} w={5.09} />
                <Campo rotulo="SÉRIE DA DPS" valor={d.serie} w={5.09} />
                <Campo rotulo="DATA E HORA DA EMISSÃO DA DPS" valor={d.emissaoDps} w={5.09} fim />
              </View>
              <View style={{ flexDirection: 'row' }}>
                <Campo rotulo="EMITENTE DA NFS-e" valor={d.emitenteTipo} w={5.09} sombreada />
                <Campo rotulo="SITUAÇÃO DA NFS-e" valor={d.situacao} w={5.09} />
                <Campo rotulo="FINALIDADE" valor={d.finalidade} w={5.09} fim />
              </View>
            </View>
            <View style={{ width: larg(5.09), alignItems: 'center', paddingVertical: 3 }}>
              <Image src={qrDataUrl} style={s.qr} />
              <Text style={s.qrLegenda}>
                A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR
                ou pela consulta da chave de acesso no portal nacional da NFS-e
              </Text>
            </View>
          </View>

          {/* ── Prestador ───────────────────────────────────────────────── */}
          <View style={s.linha}>
            <TituloBloco texto="PRESTADOR / FORNECEDOR" />
            <Campo rotulo="CNPJ / CPF / NIF" valor={d.prestador.documento} w={5.09} />
            <Campo rotulo="Indicador Municipal (Inscrição)" valor={d.prestador.inscricaoMunicipal} w={5.09} />
            <Campo rotulo="Telefone" valor={d.prestador.fone} w={5.09} fim />
          </View>
          <View style={s.linha}>
            <Campo rotulo="Nome / Nome Empresarial" valor={d.prestador.nome} w={10.19} />
            <Campo rotulo="Município / Sigla UF" valor={d.prestador.municipio} w={5.09} />
            <Campo rotulo="Código IBGE / CEP" valor={d.prestador.ibgeCep} w={5.09} fim />
          </View>
          <View style={s.linha}>
            <Campo rotulo="Endereço" valor={d.prestador.endereco} w={10.19} />
            <Campo rotulo="E-mail" valor={d.prestador.email} w={10.19} fim />
          </View>
          <View style={s.linha}>
            <Campo rotulo="Simples Nacional na Data de Competência" valor={d.prestador.simples} w={10.19} />
            <Campo rotulo="Regime de Apuração Tributária pelo SN" valor={d.prestador.regimeSN} w={10.19} fim />
          </View>

          {/* ── Tomador ─────────────────────────────────────────────────── */}
          {d.tomador ? (
            <>
              <View style={s.linha}>
                <TituloBloco texto="TOMADOR / ADQUIRENTE" />
                <Campo rotulo="CNPJ / CPF / NIF" valor={d.tomador.documento} w={5.09} />
                <Campo rotulo="Indicador Municipal (Inscrição)" valor={d.tomador.inscricaoMunicipal} w={5.09} />
                <Campo rotulo="Telefone" valor={d.tomador.fone} w={5.09} fim />
              </View>
              <View style={s.linha}>
                <Campo rotulo="Nome / Nome Empresarial" valor={d.tomador.nome} w={10.19} />
                <Campo rotulo="Município / Sigla UF" valor={d.tomador.municipio} w={5.09} />
                <Campo rotulo="Código IBGE / CEP" valor={d.tomador.ibgeCep} w={5.09} fim />
              </View>
              <View style={s.linha}>
                <Campo rotulo="Endereço" valor={d.tomador.endereco} w={10.19} />
                <Campo rotulo="E-mail" valor={d.tomador.email} w={10.19} fim />
              </View>
            </>
          ) : (
            <BlocoSuprimido texto="TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e" />
          )}

          {/* Suprimidos conforme 2.3.1 e 2.3.2, com a frase exata da NT. */}
          <BlocoSuprimido texto="O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO" />
          <BlocoSuprimido texto="INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e" />

          {/* ── Serviço prestado ────────────────────────────────────────── */}
          <View style={s.linha}>
            <TituloBloco texto="SERVIÇO PRESTADO" />
            <Campo rotulo="Local da Prestação / Sigla UF" valor={d.servico.local} w={5.09} />
            <Campo
              rotulo="Código de Tributação Nacional / Descrição"
              valor={[d.servico.codigo, d.servico.descricaoCodigo].filter(Boolean).join(' — ')}
              w={10.19} fim
            />
          </View>
          <View style={s.linha}>
            <Campo rotulo="Descrição do Serviço" valor={d.servico.descricao} w={20.4} fim />
          </View>

          {/* ── Tributação municipal (ISSQN) ────────────────────────────── */}
          {d.issqn ? (
            <>
              <View style={s.linha}>
                <TituloBloco texto="TRIBUTAÇÃO MUNICIPAL (ISSQN)" />
                <Campo rotulo="Tipo de Tributação do ISSQN" valor={d.issqn.tipoTributacao} w={5.09} />
                <Campo rotulo="Município de Incidência do ISSQN" valor={d.issqn.municipioIncidencia} w={5.09} />
                <Campo rotulo="Regime Especial de Tributação" valor={d.issqn.regimeEspecial} w={5.09} fim />
              </View>
              <View style={s.linha}>
                <Campo rotulo="BC ISSQN" valor={d.issqn.bc} w={6.8} />
                <Campo rotulo="Retenção do ISSQN" valor={d.issqn.retencao} w={6.8} />
                <Campo rotulo="ISSQN Apurado" valor={d.issqn.apurado} w={6.8} fim />
              </View>
            </>
          ) : (
            <BlocoSuprimido texto="TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN" />
          )}

          {/* ── Tributação federal ──────────────────────────────────────── */}
          <View style={s.linha}>
            <TituloBloco texto="TRIBUTAÇÃO FEDERAL" />
            <Campo rotulo="PIS" valor={d.federal.pis} w={3.82} />
            <Campo rotulo="COFINS" valor={d.federal.cofins} w={3.82} />
            <Campo rotulo="IRRF" valor={d.federal.irrf} w={3.82} />
            <Campo rotulo="CSLL" valor={d.federal.csll} w={3.82} fim />
          </View>

          {/* ── IBS / CBS ───────────────────────────────────────────────── */}
          <View style={s.linha}>
            <TituloBloco texto="TRIBUTAÇÃO IBS / CBS" />
            <Campo
              rotulo="Situação"
              valor={d.ibsCbs || 'Não informado — optante do Simples Nacional (exigível a partir de 01/2027)'}
              w={15.31} fim
            />
          </View>

          {/* ── Valor total ─────────────────────────────────────────────── */}
          <View style={s.linha}>
            <Campo rotulo="VALOR LÍQUIDO DA NFS-e + IBS/CBS" valor={d.total} w={20.4} fim sombreada />
          </View>

          {/* ── Informações complementares ──────────────────────────────── */}
          <View style={{ flexDirection: 'row', flexGrow: 1 }}>
            <View style={[s.celulaFim, { width: '100%', minHeight: cm(1.4) }]}>
              <Text style={s.rotulo}>INFORMAÇÕES COMPLEMENTARES</Text>
              <Text style={s.valor}>{d.complementares}</Text>
              {d.substituidaPor
                ? <Text style={s.valor}>NFS-e substituída pela chave {d.substituidaPor}.</Text>
                : d.cancelada
                  ? <Text style={s.valor}>NFS-e cancelada. {d.motivoCancelamento}</Text>
                  : null}
            </View>
          </View>
        </View>
      </Page>
    </Document>
  )
}
