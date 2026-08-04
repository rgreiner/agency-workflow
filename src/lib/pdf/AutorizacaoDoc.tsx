/* eslint-disable jsx-a11y/alt-text */
// Relatório de Autorização — o PDF que vai ao financeiro do cliente junto com
// as NFs e os check-ins de mídia.
//
// Paisagem, e não A4 retrato como os outros documentos: são listas largas
// (documento, título, parceiro, prazo, valor, período) e no retrato o título
// quebraria em três linhas. Por isso este não usa o FolhaA4 do kit — o resto
// (cabeçalho, rodapé, moeda, datas) é o mesmo.

import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { brl, dataBR, agoraBR, CINZA, CINZA_CLARO, PRETO } from './kit'
import type { AutorizacaoData, AutorizacaoLinha } from './autorizacao-data'

const t = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 40, paddingHorizontal: 34, fontSize: 8.5, color: PRETO, fontFamily: 'Helvetica' },
  cabecalho: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 1, borderBottomColor: '#d1d5db', paddingBottom: 10 },
  logo: { height: 34, objectFit: 'contain' },
  agencia: { textAlign: 'right', fontSize: 7.5, color: CINZA, lineHeight: 1.4 },
  agenciaNome: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827' },

  titulo: { fontSize: 15, marginTop: 14, color: '#111827' },
  subtitulo: { fontSize: 9, color: CINZA, marginTop: 3, marginBottom: 12 },

  secao: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: '#111827', marginTop: 12, marginBottom: 5 },
  secaoVazia: { fontSize: 8.5, color: CINZA_CLARO, marginBottom: 8 },

  cabLinha: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#d1d5db', paddingBottom: 4, marginBottom: 2 },
  cabTexto: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: CINZA },
  linha: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f3f4f6', paddingVertical: 4 },

  cDoc: { width: 52 },
  cTitulo: { flex: 1, paddingRight: 8 },
  cParceiro: { width: 108 },
  cPrazo: { width: 54 },
  cValor: { width: 78, textAlign: 'right' },
  cPeriodo: { width: 108, textAlign: 'right' },

  doc: { fontFamily: 'Helvetica-Bold', fontSize: 8 },
  fraco: { color: CINZA },

  totalLinha: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#d1d5db', paddingTop: 5, marginTop: 1 },
  totalRotulo: { flex: 1, textAlign: 'right', paddingRight: 8, color: CINZA },
  totalValor: { width: 78, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  totalPeriodo: { width: 108 },

  geral: { flexDirection: 'row', marginTop: 16, borderTopWidth: 2, borderTopColor: '#111827', paddingTop: 7 },
  geralRotulo: { flex: 1, textAlign: 'right', paddingRight: 8, fontFamily: 'Helvetica-Bold', fontSize: 10 },
  geralValor: { width: 78, textAlign: 'right', fontFamily: 'Helvetica-Bold', fontSize: 10 },
  geralPeriodo: { width: 108 },

  nota: { marginTop: 20, fontSize: 7.5, color: CINZA, lineHeight: 1.5, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 8 },

  rodape: { position: 'absolute', bottom: 20, left: 34, right: 34, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: CINZA_CLARO, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 6 },
})

function Secao({ titulo, vazio }: { titulo: string; vazio?: string }) {
  return (
    <>
      <Text style={t.secao}>{titulo}</Text>
      {vazio ? <Text style={t.secaoVazia}>{vazio}</Text> : null}
    </>
  )
}

function Tabela({ linhas, total, colPeriodo, rotuloPeriodo }: {
  linhas: AutorizacaoLinha[]; total: number; colPeriodo: 'veiculacao' | 'emissao'; rotuloPeriodo: string
}) {
  return (
    <View>
      <View style={t.cabLinha}>
        <Text style={[t.cabTexto, t.cDoc]}>Doc.</Text>
        <Text style={[t.cabTexto, t.cTitulo]}>Título</Text>
        <Text style={[t.cabTexto, t.cParceiro]}>{colPeriodo === 'veiculacao' ? 'Veículo' : 'Fornecedor'}</Text>
        <Text style={[t.cabTexto, t.cPrazo]}>Prazo</Text>
        <Text style={[t.cabTexto, t.cValor]}>Investimento</Text>
        <Text style={[t.cabTexto, t.cPeriodo]}>{rotuloPeriodo}</Text>
      </View>
      {linhas.map(l => (
        <View key={l.id} style={t.linha} wrap={false}>
          <Text style={[t.doc, t.cDoc]}>{l.doc}</Text>
          <Text style={t.cTitulo}>{l.titulo}</Text>
          <Text style={[t.cParceiro, t.fraco]}>{l.parceiro}</Text>
          <Text style={[t.cPrazo, t.fraco]}>{l.prazo}</Text>
          <Text style={t.cValor}>{brl(l.valor)}</Text>
          <Text style={[t.cPeriodo, t.fraco]}>
            {colPeriodo === 'veiculacao'
              ? `${dataBR(l.primeira)} a ${dataBR(l.ultima)}`
              : dataBR(l.emissao)}
          </Text>
        </View>
      ))}
      <View style={t.totalLinha}>
        <Text style={t.totalRotulo}>Subtotal</Text>
        <Text style={t.totalValor}>{brl(total)}</Text>
        <Text style={t.totalPeriodo} />
      </View>
    </View>
  )
}

export function AutorizacaoDoc({ d }: { d: AutorizacaoData }) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={t.page}>
        <View style={t.cabecalho}>
          {d.logoUrl ? <Image src={d.logoUrl} style={t.logo} /> : <View />}
          <View style={t.agencia}>
            <Text style={t.agenciaNome}>{d.agencia.nome}</Text>
            <Text>{d.agencia.razao}</Text>
            <Text>{d.agencia.endereco}</Text>
            <Text>{d.agencia.cnpjFone}</Text>
          </View>
        </View>

        <Text style={t.titulo}>Relatório de Autorização</Text>
        <Text style={t.subtitulo}>{d.cliente}  ·  {d.competenciaLabel}</Text>

        <Secao titulo="Mídias veiculadas no mês"
          vazio={d.midias.length === 0 ? 'Nenhuma mídia faturada nesta competência.' : undefined} />
        {d.midias.length > 0 && (
          <Tabela linhas={d.midias} total={d.totalMidia} colPeriodo="veiculacao" rotuloPeriodo="Veiculação" />
        )}

        <Secao titulo="Produções emitidas no mês"
          vazio={d.producoes.length === 0 ? 'Nenhuma produção faturada nesta competência.' : undefined} />
        {d.producoes.length > 0 && (
          <Tabela linhas={d.producoes} total={d.totalProducao} colPeriodo="emissao" rotuloPeriodo="Emissão" />
        )}

        <View style={t.geral}>
          <Text style={t.geralRotulo}>Total do mês</Text>
          <Text style={t.geralValor}>{brl(d.total)}</Text>
          <Text style={t.geralPeriodo} />
        </View>

        {/* O relatório existe para isto: é a régua do que pode ser pago. */}
        <Text style={t.nota}>
          Esta relação contém os documentos autorizados por {d.agencia.nome} e faturados na
          competência de {d.competenciaLabel}. Notas fiscais que não correspondam a um documento
          desta lista devem ser confirmadas com a agência antes do pagamento. A mídia entra pelo
          período de veiculação e a produção pela data de emissão.
        </Text>

        <View style={t.rodape} fixed>
          <Text>{d.cliente}  ·  Relatório de Autorização  ·  {d.competenciaLabel}</Text>
          <Text render={({ pageNumber, totalPages }) => `Gerado em ${agoraBR()}  ·  ${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
