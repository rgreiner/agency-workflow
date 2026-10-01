/* eslint-disable jsx-a11y/alt-text */
// DANFSe — Documento Auxiliar da NFS-e, no padrão da NT 008/2026.
//
// A Receita desligou a API que gerava este PDF (03/08/2026) e passou o encargo
// ao sistema emissor, junto com um layout padronizado: A4 retrato em página
// única, blocos na ordem (identificação, prestador, tomador, serviço, tributos,
// IBS/CBS, complementares), QR Code de no mínimo 1,52 cm apontando para a
// consulta pública nacional, chave em bloco único e marca d'água em nota
// cancelada, substituída ou de homologação.
//
// Fonte: Helvetica (embutida no react-pdf), metricamente compatível com a Arial
// que a NT cita — registrar arquivo de fonte só para isso pesaria o build.
//
// Este documento não é a nota: o documento fiscal é o XML. O rodapé diz isso
// porque quem recebe precisa saber o que guardar.

import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import type { DanfseDados } from './danfse-data'
import { chaveFormatada } from './danfse-data'

const PRETO = '#111827'
const CINZA = '#6b7280'
const LINHA = '#9ca3af'

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 36, paddingHorizontal: 28, fontSize: 8, color: PRETO, fontFamily: 'Helvetica' },

  moldura: { borderWidth: 1, borderColor: LINHA },
  topo: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: LINHA },
  topoQr: { width: 76, padding: 6, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: LINHA },
  qr: { width: 62, height: 62 },
  topoMeio: { flex: 1, padding: 8, justifyContent: 'center' },
  topoTitulo: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  topoSub: { fontSize: 7.5, color: CINZA, marginTop: 2 },
  topoDir: { width: 150, padding: 8, borderLeftWidth: 1, borderLeftColor: LINHA },

  faixa: { backgroundColor: '#f3f4f6', paddingVertical: 2.5, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: LINHA, borderTopWidth: 1, borderTopColor: LINHA },
  faixaTexto: { fontSize: 7, fontFamily: 'Helvetica-Bold', letterSpacing: 0.6, color: '#374151' },

  corpo: { paddingHorizontal: 6, paddingVertical: 5 },
  grade: { flexDirection: 'row', flexWrap: 'wrap' },
  campo: { marginBottom: 4, paddingRight: 8 },
  rotulo: { fontSize: 6.2, color: CINZA, letterSpacing: 0.4, marginBottom: 1 },
  valor: { fontSize: 8.5 },
  valorForte: { fontSize: 9, fontFamily: 'Helvetica-Bold' },

  chaveCaixa: { paddingHorizontal: 6, paddingVertical: 4, borderTopWidth: 1, borderTopColor: LINHA },
  chave: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },

  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 7, borderTopWidth: 1, borderTopColor: LINHA, backgroundColor: '#f9fafb' },
  totalRotulo: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  totalValor: { fontSize: 14, fontFamily: 'Helvetica-Bold' },

  aviso: { marginTop: 10, borderWidth: 1, borderColor: '#b45309', backgroundColor: '#fffbeb', padding: 6 },
  avisoTitulo: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#92400e' },
  avisoTexto: { fontSize: 7.5, color: '#92400e', marginTop: 2 },

  rodape: { position: 'absolute', bottom: 16, left: 28, right: 28, fontSize: 6.5, color: CINZA, textAlign: 'center', lineHeight: 1.4 },

  marca: {
    position: 'absolute', top: 300, left: 0, right: 0, textAlign: 'center',
    fontSize: 42, fontFamily: 'Helvetica-Bold', color: '#dc2626', opacity: 0.16,
    transform: 'rotate(-24deg)',
  },
})

function Campo({ rotulo, valor, largura = '100%' }: { rotulo: string; valor: string; largura?: string }) {
  return (
    <View style={[s.campo, { width: largura }]}>
      <Text style={s.rotulo}>{rotulo.toUpperCase()}</Text>
      <Text style={s.valor}>{valor || '—'}</Text>
    </View>
  )
}

function Secao({ titulo }: { titulo: string }) {
  return <View style={s.faixa}><Text style={s.faixaTexto}>{titulo.toUpperCase()}</Text></View>
}

export function DanfseDoc({ d, qrDataUrl }: { d: DanfseDados; qrDataUrl: string }) {
  const teste = d.ambiente === '2'
  // Uma marca d'água só, na ordem em que o fato manda: substituída diz mais que
  // cancelada (a substituída foi cancelada POR outra nota), e teste manda em tudo.
  const marca = teste ? 'SEM VALOR FISCAL'
    : d.substituidaPor ? 'SUBSTITUÍDA'
    : d.cancelada ? 'CANCELADA'
    : ''

  return (
    <Document title={`DANFSe ${d.numero}`} author={d.prestador.nome}>
      <Page size="A4" style={s.page}>
        {marca ? <Text style={s.marca} fixed>{marca}</Text> : null}

        <View style={s.moldura}>
          <View style={s.topo}>
            <View style={s.topoQr}>
              {/* NT 008: mínimo 1,52 cm (≈43pt). 62pt dá folga para leitura em papel. */}
              <Image src={qrDataUrl} style={s.qr} />
            </View>
            <View style={s.topoMeio}>
              <Text style={s.topoTitulo}>DANFSe</Text>
              <Text style={s.topoSub}>Documento Auxiliar da Nota Fiscal de Serviço eletrônica</Text>
              <Text style={s.topoSub}>Padrão Nacional · {d.servico.municipio}</Text>
            </View>
            <View style={s.topoDir}>
              <Campo rotulo="NFS-e nº" valor={d.numero} />
              <Campo rotulo="Emitida em" valor={d.emitidoEm} />
              <Campo rotulo="Competência" valor={d.competencia} />
            </View>
          </View>

          <View style={s.chaveCaixa}>
            <Text style={s.rotulo}>CHAVE DE ACESSO</Text>
            <Text style={s.chave}>{chaveFormatada(d.chave)}</Text>
          </View>

          <Secao titulo="Prestador de serviços" />
          <View style={s.corpo}>
            <View style={s.grade}>
              <Campo rotulo="Razão social" valor={d.prestador.nome} largura="64%" />
              <Campo rotulo="CNPJ" valor={cnpj(d.prestador.cnpj)} largura="36%" />
              <Campo rotulo="Endereço" valor={d.prestador.endereco} largura="64%" />
              <Campo rotulo="Município" valor={d.prestador.municipio} largura="22%" />
              <Campo rotulo="Telefone" valor={fone(d.prestador.fone)} largura="14%" />
            </View>
          </View>

          <Secao titulo="Tomador de serviços" />
          <View style={s.corpo}>
            <View style={s.grade}>
              <Campo rotulo="Razão social" valor={d.tomador.nome} largura="64%" />
              <Campo rotulo="CNPJ" valor={cnpj(d.tomador.cnpj)} largura="36%" />
            </View>
          </View>

          <Secao titulo="Serviço prestado" />
          <View style={s.corpo}>
            <View style={s.grade}>
              <Campo rotulo="Cód. tributação nacional" valor={d.servico.codigo} largura="26%" />
              <Campo rotulo="Descrição do código" valor={d.servico.descricaoNacional} largura="74%" />
            </View>
            <View style={s.campo}>
              <Text style={s.rotulo}>DISCRIMINAÇÃO DO SERVIÇO</Text>
              <Text style={s.valor}>{d.servico.descricao || '—'}</Text>
            </View>
            <Campo rotulo="Município de incidência do ISSQN" valor={d.servico.municipio} largura="50%" />
          </View>

          <Secao titulo="Tributos" />
          <View style={s.corpo}>
            <View style={s.grade}>
              <Campo rotulo="ISSQN" valor={d.issqn.tributacao} largura="28%" />
              <Campo rotulo="Retenção do ISSQN" valor={d.issqn.retencao} largura="28%" />
              <Campo rotulo="Tributos (Simples Nacional)" valor={d.valores.percTributos ? `${d.valores.percTributos.replace('.', ',')}%` : '—'} largura="22%" />
              <Campo rotulo="Valor aproximado" valor={d.valores.tributos} largura="22%" />
              {/* A NT 008 criou bloco próprio para IBS e CBS. Optante do Simples
                  só informa o grupo a partir de 01/2027 — dizer isso é melhor que
                  deixar o quadro mudo e parecer esquecimento. */}
              <Campo
                rotulo="IBS / CBS"
                valor={d.ibsCbs || 'Não aplicável — optante do Simples Nacional'}
                largura="100%"
              />
            </View>
          </View>

          <View style={s.total}>
            <Text style={s.totalRotulo}>VALOR TOTAL DA NFS-e</Text>
            <Text style={s.totalValor}>{d.valores.liquido || d.valores.servico}</Text>
          </View>

          <Secao titulo="Informações complementares" />
          <View style={s.corpo}>
            <Text style={{ fontSize: 7.2, color: CINZA, lineHeight: 1.45 }}>
              Série {d.serie} · DPS nº {d.nDps}{d.nDfse ? ` · Documento municipal nº ${d.nDfse}` : ''}.
              {d.valores.percTributos
                ? ` Valor aproximado dos tributos: ${d.valores.tributos} (${d.valores.percTributos.replace('.', ',')}%), conforme Lei 12.741/2012.`
                : ''}
            </Text>
          </View>
        </View>

        {teste && (
          <View style={s.aviso}>
            <Text style={s.avisoTitulo}>Nota emitida em ambiente de teste</Text>
            <Text style={s.avisoTexto}>
              Documento gerado na produção restrita da Receita. Não tem valor fiscal e não serve para cobrança.
            </Text>
          </View>
        )}
        {!teste && d.substituidaPor && (
          <View style={s.aviso}>
            <Text style={s.avisoTitulo}>Nota substituída</Text>
            <Text style={s.avisoTexto}>Substituída pela NFS-e de chave {chaveFormatada(d.substituidaPor)}.</Text>
          </View>
        )}
        {!teste && !d.substituidaPor && d.cancelada && (
          <View style={s.aviso}>
            <Text style={s.avisoTitulo}>Nota cancelada</Text>
            <Text style={s.avisoTexto}>{d.motivoCancelamento || 'Cancelada junto à Receita.'}</Text>
          </View>
        )}

        <Text style={s.rodape} fixed>
          Documento auxiliar, sem valor fiscal. O documento fiscal é o XML da NFS-e, guardado pelo emitente.{'\n'}
          Confira a autenticidade em nfse.gov.br/consultapublica com a chave de acesso acima.
        </Text>
      </Page>
    </Document>
  )
}

const cnpj = (v: string) =>
  v && v.length === 14 ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : v
const fone = (v: string) =>
  v && v.length >= 10 ? v.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : v
