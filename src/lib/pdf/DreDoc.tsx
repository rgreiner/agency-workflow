// DRE mensal em PDF — para mandar à contabilidade ou ao banco.
// Só o REALIZADO (regime de caixa): é o número que se apresenta a terceiro; o
// previsto é ferramenta de gestão e fica no Excel, numa aba própria.
import { Document, Page, Text, View } from '@react-pdf/renderer'
import { s, PRETO, CINZA, CINZA_CLARO, LINHA, Cabecalho, Rodape, agoraBR, type Agencia } from './kit'
import { rotuloDre, type DreLinhaCalc } from '../dre-calculo'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const mesCurto = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`
const num = (v: number) => (Math.abs(v) < 0.005 ? '–' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

function Cel({ children, forte, cor }: { children: string; forte?: boolean; cor?: string }) {
  return <Text style={{ width: 62, fontSize: 7.5, textAlign: 'right', color: cor ?? PRETO, fontFamily: forte ? 'Helvetica-Bold' : 'Helvetica' }}>{children}</Text>
}

export interface DreDocDados {
  meses: string[]
  linhas: DreLinhaCalc[]
  /** O último mês ainda não fechou. */
  parcial: boolean
}

export function DreDoc({ d, agencia, logoUrl }: { d: DreDocDados; agencia: Agencia; logoUrl: string | null }) {
  const total = (vr: Record<string, number>) => d.meses.reduce((a, m) => a + (vr[m] ?? 0), 0)
  const temFora = d.linhas.some(l => l.fora)

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Cabecalho agencia={agencia} logoUrl={logoUrl} />
        <Text style={{ ...s.titulo, marginTop: 10, marginBottom: 2 }}>Demonstração do Resultado (DRE)</Text>
        <Text style={{ fontSize: 8, color: CINZA, marginBottom: 10 }}>
          {mesCurto(d.meses[0])} a {mesCurto(d.meses[d.meses.length - 1])} · realizado, regime de caixa · valores em R$
          {d.parcial ? ` · ${mesCurto(d.meses[d.meses.length - 1])} parcial (mês em andamento)` : ''}
        </Text>

        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: PRETO, paddingBottom: 3 }} fixed>
          <Text style={{ flex: 1, fontSize: 7.5, fontFamily: 'Helvetica-Bold' }}>Linha</Text>
          {d.meses.map(m => <Cel key={m} forte>{mesCurto(m)}</Cel>)}
          <Cel forte>Total</Cel>
        </View>

        {d.linhas.map((r, i) => {
          const k = r.line.kind
          const fundo = k === 'grupo' ? '#f3f4f6' : undefined
          const forte = k === 'grupo' || k === 'total'
          const recuo = k === 'sub' ? (r.line.code.split('.').length > 2 ? 16 : 8) : k === 'folha' ? (r.line.sub.split('.').length > 2 ? 24 : 16) : 0
          const cor = (v: number) => (v < 0 ? '#b91c1c' : k === 'sub' || k === 'folha' ? CINZA : PRETO)
          const t = total(r.vr)
          return (
            <View key={i} wrap={false} style={{
              flexDirection: 'row', paddingVertical: k === 'folha' ? 2 : 3, backgroundColor: fundo,
              borderTopWidth: k === 'total' ? 0.8 : 0, borderBottomWidth: k === 'total' ? 0 : 0.4,
              borderColor: k === 'total' ? PRETO : LINHA, marginBottom: k === 'total' ? 4 : 0,
            }}>
              <Text style={{ flex: 1, fontSize: 7.5, paddingLeft: recuo + 2, color: k === 'folha' ? CINZA : PRETO,
                fontFamily: forte ? 'Helvetica-Bold' : 'Helvetica' }}>{rotuloDre(r.line)}</Text>
              {d.meses.map(m => <Cel key={m} forte={forte} cor={cor(r.vr[m] ?? 0)}>{num(r.vr[m] ?? 0)}</Cel>)}
              <Cel forte cor={cor(t)}>{num(t)}</Cel>
            </View>
          )
        })}

        {temFora && (
          <Text style={{ fontSize: 7, color: CINZA_CLARO, marginTop: 6 }}>
            O grupo 99 reúne lançamentos com categoria ainda não classificada na estrutura contábil.
          </Text>
        )}
        <Rodape identificacao={`${agencia.nome} · DRE`} geradoEm={agoraBR()} />
      </Page>
    </Document>
  )
}
