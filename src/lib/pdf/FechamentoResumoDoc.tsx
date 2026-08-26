// Resumo do fechamento do ponto (banco de horas): a TABELA que a contabilidade
// pediu — uma linha por pessoa, colunas do relatório clássico — no lugar do
// espelho detalhado no e-mail (o detalhado segue disponível na tela).
import { Text, View } from '@react-pdf/renderer'
import { s, PRETO, CINZA, CINZA_CLARO, LINHA, FolhaA4, Cabecalho, Rodape, agoraBR, type Agencia } from './kit'

export interface FechResumoLinha {
  nome: string; cpf: string | null
  ini: string; fim: string
  hn_min: number; he50_min: number; he100_min: number
  faltas_min: number; total_min: number; quitacao_min: number
}
export interface FechResumoDados {
  ini: string; fim: string; competencia: string   // YYYY-MM
  linhas: FechResumoLinha[]
}

const hm = (m: number) => `${m < 0 ? '-' : ''}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, '0')}`
const dBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

const col = { nome: 150, cpf: 78, per: 82 }

function Cel({ w, children, alinha, forte, cor }: {
  w?: number; children: React.ReactNode; alinha?: 'right'; forte?: boolean; cor?: string
}) {
  return (
    <Text style={{ width: w, flex: w ? undefined : 1, fontSize: 8, textAlign: alinha, paddingRight: 4,
      color: cor ?? PRETO, fontFamily: forte ? 'Helvetica-Bold' : 'Helvetica' }}>{children}</Text>
  )
}

export function FechamentoResumoDoc({ d, agencia, logoUrl }: { d: FechResumoDados; agencia: Agencia; logoUrl: string | null }) {
  const tot = d.linhas.reduce((a, l) => ({
    hn: a.hn + l.hn_min, h50: a.h50 + l.he50_min, h100: a.h100 + l.he100_min,
    faltas: a.faltas + l.faltas_min, total: a.total + l.total_min, quit: a.quit + l.quitacao_min,
  }), { hn: 0, h50: 0, h100: 0, faltas: 0, total: 0, quit: 0 })

  return (
    <FolhaA4>
      <Cabecalho agencia={agencia} logoUrl={logoUrl} />

      <Text style={{ ...s.titulo, marginTop: 10 }}>FECHAMENTO DO PONTO — BANCO DE HORAS</Text>
      <Text style={{ fontSize: 8, color: CINZA, marginBottom: 10 }}>
        Período {dBR(d.ini)} a {dBR(d.fim)} · competência {d.competencia.split('-').reverse().join('/')}
      </Text>

      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: PRETO, paddingBottom: 3 }}>
        <Cel w={col.nome} forte>Colaborador</Cel>
        <Cel w={col.cpf} forte>Matrícula (CPF)</Cel>
        <Cel w={col.per} forte>Período</Cel>
        <Cel alinha="right" forte>H.N.</Cel>
        <Cel alinha="right" forte>H.E.50</Cel>
        <Cel alinha="right" forte>H.E.100</Cel>
        <Cel alinha="right" forte>Faltas</Cel>
        <Cel alinha="right" forte>H. Totais</Cel>
        <Cel alinha="right" forte>Quitação Banco</Cel>
      </View>

      {d.linhas.map((l, i) => (
        <View key={i} wrap={false}
          style={{ flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.5, borderColor: LINHA }}>
          <Cel w={col.nome}>{l.nome}</Cel>
          <Cel w={col.cpf} cor={CINZA}>{l.cpf ?? '—'}</Cel>
          <Cel w={col.per} cor={CINZA_CLARO}>{`${l.ini.slice(8, 10)}/${l.ini.slice(5, 7)}–${l.fim.slice(8, 10)}/${l.fim.slice(5, 7)}`}</Cel>
          <Cel alinha="right">{hm(l.hn_min)}</Cel>
          <Cel alinha="right" cor={CINZA}>{hm(l.he50_min)}</Cel>
          <Cel alinha="right" cor={CINZA}>{hm(l.he100_min)}</Cel>
          <Cel alinha="right" cor={l.faltas_min > 0 ? PRETO : CINZA_CLARO}>{hm(l.faltas_min)}</Cel>
          <Cel alinha="right" forte>{hm(l.total_min)}</Cel>
          <Cel alinha="right" forte>{hm(l.quitacao_min)}</Cel>
        </View>
      ))}

      <View style={{ flexDirection: 'row', paddingVertical: 4, borderTopWidth: 1, borderColor: PRETO, marginTop: 1 }}>
        <Cel w={col.nome} forte>TOTAIS</Cel>
        <Cel w={col.cpf}> </Cel>
        <Cel w={col.per}> </Cel>
        <Cel alinha="right" forte>{hm(tot.hn)}</Cel>
        <Cel alinha="right" forte>{hm(tot.h50)}</Cel>
        <Cel alinha="right" forte>{hm(tot.h100)}</Cel>
        <Cel alinha="right" forte>{hm(tot.faltas)}</Cel>
        <Cel alinha="right" forte>{hm(tot.total)}</Cel>
        <Cel alinha="right" forte>{hm(tot.quit)}</Cel>
      </View>

      <Text style={{ fontSize: 6.5, color: CINZA_CLARO, marginTop: 8, lineHeight: 1.4 }}>
        H.N. = horas normais · H.E.50/100 = horas extras 50%/100% (somente as aprovadas) ·
        Faltas = horas não cumpridas (inclui atraso parcial) · H. Totais = H.N. + extras − faltas ·
        Quitação Banco = extras − faltas. Espelho de ponto detalhado por colaborador disponível no Flow.
      </Text>

      <Rodape identificacao={`Fechamento do ponto · ${d.competencia}`} geradoEm={agoraBR()} />
    </FolhaA4>
  )
}
