/* eslint-disable jsx-a11y/alt-text */
// Peças compartilhadas dos documentos em PDF (@react-pdf/renderer).
//
// Nada de Tailwind aqui: react-pdf tem seu próprio subconjunto de estilos. As
// medidas espelham o documento que a agência já enviava (A4, ~16mm de margem,
// corpo 9pt), pra PI/PP saírem iguais ao que o veículo está acostumado a ver.
// Fonte Helvetica (embutida na lib) — cobre a acentuação do português sem
// registrar arquivo de fonte, o que manteria o PDF leve e o build sem assets.

import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'

export const CINZA = '#4b5563'
export const CINZA_CLARO = '#9ca3af'
export const PRETO = '#1f2937'
export const LINHA = '#e5e7eb'

export const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 46, paddingHorizontal: 45, fontSize: 9, color: PRETO, fontFamily: 'Helvetica' },

  cabecalho: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 1, borderBottomColor: '#d1d5db', paddingBottom: 12 },
  logo: { height: 40, objectFit: 'contain' },
  agencia: { textAlign: 'right', fontSize: 8, color: CINZA, lineHeight: 1.4 },
  agenciaNome: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: '#111827' },

  titulo: { fontSize: 17, marginTop: 16, marginBottom: 14, color: '#111827' },

  linha: { flexDirection: 'row', marginBottom: 5 },
  linhaLabel: { width: 74, textAlign: 'right', marginRight: 10, color: CINZA_CLARO, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  linhaValor: { flex: 1 },
  forte: { fontFamily: 'Helvetica-Bold', color: '#111827' },
  fraco: { color: CINZA, fontSize: 8, lineHeight: 1.45 },

  paresGrade: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, marginBottom: 12 },
  parCelula: { width: '50%', flexDirection: 'row', marginBottom: 4 },

  secaoBarra: { borderLeftWidth: 2, borderLeftColor: '#9ca3af', paddingLeft: 6, marginBottom: 6, marginTop: 4 },
  secaoTitulo: { fontSize: 11, color: CINZA },

  colunas: { flexDirection: 'row' },
  colEsq: { width: '48%', paddingRight: 12 },
  colDir: { width: '52%' },

  tabLinha: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#f3f4f6', paddingVertical: 3.5 },
  tabLabel: { color: CINZA_CLARO },
  tabValor: { textAlign: 'right' },

  item: { marginBottom: 3 },
  destaque: { backgroundColor: '#fef08a', fontFamily: 'Helvetica-Bold' },

  assinaturas: { flexDirection: 'row', marginTop: 46 },
  assinatura: { width: '50%', paddingHorizontal: 14, alignItems: 'center' },
  assinaturaLinha: { borderTopWidth: 1, borderTopColor: '#9ca3af', paddingTop: 4, width: '100%', textAlign: 'center', color: CINZA },

  rodape: {
    position: 'absolute', bottom: 24, left: 45, right: 45,
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: '#d1d5db', paddingTop: 5, fontSize: 7, color: CINZA_CLARO,
  },
})

export interface Agencia { nome: string; razao: string; endereco: string; cnpjFone: string; cidade: string }

export function Cabecalho({ agencia, logoUrl }: { agencia: Agencia; logoUrl: string | null }) {
  return (
    <View style={s.cabecalho}>
      {/* Logo por URL: o react-pdf busca e embute. Sem logo, o documento sai
          igual — só sem a marca, nunca quebrado. */}
      {logoUrl ? <Image src={logoUrl} style={s.logo} /> : <View />}
      <View style={s.agencia}>
        <Text style={s.agenciaNome}>{agencia.nome}</Text>
        <Text>{agencia.razao}</Text>
        <Text>{agencia.endereco}</Text>
        <Text>{agencia.cnpjFone}</Text>
      </View>
    </View>
  )
}

export function Linha({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.linha}>
      <Text style={s.linhaLabel}>{label}</Text>
      <View style={s.linhaValor}>{children}</View>
    </View>
  )
}

export function Secao({ titulo }: { titulo: string }) {
  return <View style={s.secaoBarra}><Text style={s.secaoTitulo}>{titulo}</Text></View>
}

export function TabLinha({ label, valor, forte }: { label: string; valor: string; forte?: boolean }) {
  return (
    <View style={s.tabLinha}>
      <Text style={s.tabLabel}>{label}</Text>
      <Text style={[s.tabValor, ...(forte ? [s.forte] : [])]}>{valor}</Text>
    </View>
  )
}

export function Assinaturas({ esquerda, direita }: { esquerda: string; direita: string }) {
  return (
    <View style={s.assinaturas}>
      <View style={s.assinatura}><Text style={s.assinaturaLinha}>{esquerda}</Text></View>
      <View style={s.assinatura}><Text style={s.assinaturaLinha}>{direita}</Text></View>
    </View>
  )
}

/** Rodapé fixo com identificação e paginação — `fixed` repete em toda página. */
export function Rodape({ identificacao, geradoEm }: { identificacao: string; geradoEm: string }) {
  return (
    <View style={s.rodape} fixed>
      <Text>{identificacao}</Text>
      <Text render={({ pageNumber, totalPages }) => `Gerado em ${geradoEm}  ·  ${pageNumber}/${totalPages}`} />
    </View>
  )
}

export function FolhaA4({ children }: { children: React.ReactNode }) {
  return <Document><Page size="A4" style={s.page}>{children}</Page></Document>
}

export const brl = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
export const agoraBR = () => new Date().toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})
