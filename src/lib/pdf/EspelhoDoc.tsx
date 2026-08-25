// Espelho de ponto em PDF. Quando o ciclo está assinado, o conteúdo vem do
// SNAPSHOT CONGELADO junto da assinatura — nunca de uma releitura do banco —
// para o documento ser exatamente aquilo sobre o que o hash foi calculado.
import { Document, Page, Text, View } from '@react-pdf/renderer'
import { s, PRETO, CINZA, CINZA_CLARO, LINHA, Cabecalho, Rodape, agoraBR, type Agencia } from './kit'

export interface EspelhoPdfDia {
  data: string; dow: number; esperado_min: number; marcacoes: string[]
  minutos: number; saldo_min: number; intervalo_ok: boolean | null
  origem: string | null
  feriado: { nome: string | null; tipo: string } | null
  justificativa: { tipo: string; status: string } | null
  ajuste: { por: string | null; em: string } | null
}
export interface EspelhoPdfDados {
  colaborador: { nome: string; cargo: string | null; cpf: string | null }
  jornada: { carga_min: number; entrada: string; saida: string }
  ini: string; fim: string; competencia: string
  resumo: { hn_min: number; faltas_min: number; extra_min: number; saldo_min: number }
  dias: EspelhoPdfDia[]
  assinaturas: { papel: string; por: string | null; assinado_em: string; hash: string; ip: string | null }[]
}

const DOW = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const hm = (m: number) => `${m < 0 ? '-' : ''}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, '0')}`
const dBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const dtBR = (s2: string) => new Date(s2).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const col = { dia: 62, marc: 168, trab: 46, saldo: 46 }

function Cel({ w, children, alinha, forte, cor }: {
  w?: number; children: React.ReactNode; alinha?: 'right' | 'center'; forte?: boolean; cor?: string
}) {
  return (
    <Text style={{ width: w, flex: w ? undefined : 1, fontSize: 8, textAlign: alinha,
      // A última coluna (sem largura fixa) precisa afastar-se da anterior, senão
      // "Saldo" e "Ocorrência" saem coladas.
      paddingLeft: w ? 0 : 8, paddingRight: 2,
      color: cor ?? PRETO, fontFamily: forte ? 'Helvetica-Bold' : 'Helvetica' }}>{children}</Text>
  )
}

/** Uma pessoa = uma página (que pagina sozinha se o ciclo for longo). Extraída
 *  para o PDF do FECHAMENTO montar um documento único com o time inteiro —
 *  mesmo formato do relatório que a contabilidade recebia do Pontomais. */
export function EspelhoPagina({ d, agencia, logoUrl }: { d: EspelhoPdfDados; agencia: Agencia; logoUrl: string | null }) {
  const assinado = d.assinaturas.length > 0
  return (
    <Page size="A4" style={s.page}>
      <Cabecalho agencia={agencia} logoUrl={logoUrl} />

      <Text style={{ ...s.titulo, marginTop: 10 }}>ESPELHO DE PONTO</Text>
      <View style={{ marginTop: 6, marginBottom: 8 }}>
        <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: PRETO }}>{d.colaborador.nome}</Text>
        <Text style={{ fontSize: 8, color: CINZA }}>
          {d.colaborador.cargo || 'Sem cargo'}{d.colaborador.cpf ? ` · CPF ${d.colaborador.cpf}` : ''}
        </Text>
        <Text style={{ fontSize: 8, color: CINZA, marginTop: 2 }}>
          Período {dBR(d.ini)} a {dBR(d.fim)} · competência {d.competencia.split('-').reverse().join('/')} ·
          jornada {d.jornada.entrada?.slice(0, 5)}–{d.jornada.saida?.slice(0, 5)} ({hm(d.jornada.carga_min)}/dia)
        </Text>
      </View>

      {/* Resumo */}
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
        {[
          ['Horas normais', hm(d.resumo.hn_min)],
          ['Extras', hm(d.resumo.extra_min)],
          ['Faltas', hm(d.resumo.faltas_min)],
          ['Saldo do período', hm(d.resumo.saldo_min)],
        ].map(([l, v]) => (
          <View key={l} style={{ flex: 1, borderWidth: 1, borderColor: LINHA, borderRadius: 3, padding: 5 }}>
            <Text style={{ fontSize: 6.5, color: CINZA_CLARO }}>{l}</Text>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: PRETO }}>{v}</Text>
          </View>
        ))}
      </View>

      {/* Tabela */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: PRETO, paddingBottom: 3 }}>
        <Cel w={col.dia} forte>Dia</Cel>
        <Cel w={col.marc} forte>Marcações</Cel>
        <Cel w={col.trab} alinha="right" forte>Trab.</Cel>
        <Cel w={col.saldo} alinha="right" forte>Saldo</Cel>
        <Cel forte>Ocorrência</Cel>
      </View>

      {d.dias.map(x => {
        const semCarga = x.esperado_min === 0
        const ocor: string[] = []
        if (x.feriado) ocor.push(x.feriado.nome || x.feriado.tipo)
        if (x.justificativa) ocor.push(`${x.justificativa.tipo} (${x.justificativa.status})`)
        if (x.ajuste) ocor.push('ajustado')
        if (x.intervalo_ok === false) ocor.push('almoço < 1h')
        if (!semCarga && !x.marcacoes.length && !x.justificativa) ocor.push('sem marcação')
        if (x.origem) ocor.push(`importado (${x.origem})`)
        return (
          <View key={x.data} wrap={false}
            style={{ flexDirection: 'row', paddingVertical: 2.2, borderBottomWidth: 0.5, borderColor: LINHA }}>
            <Cel w={col.dia} cor={semCarga ? CINZA_CLARO : PRETO}>{DOW[x.dow]} {x.data.slice(8, 10)}/{x.data.slice(5, 7)}</Cel>
            <Cel w={col.marc} cor={semCarga ? CINZA_CLARO : PRETO}>{x.marcacoes.join('  ') || '—'}</Cel>
            <Cel w={col.trab} alinha="right" cor={CINZA}>{x.minutos ? hm(x.minutos) : '—'}</Cel>
            <Cel w={col.saldo} alinha="right" cor={CINZA}>{x.saldo_min ? hm(x.saldo_min) : '—'}</Cel>
            <Cel cor={CINZA}>{ocor.join(' · ')}</Cel>
          </View>
        )
      })}

      {/* Assinaturas eletrônicas */}
      <View style={{ marginTop: 14 }} wrap={false}>
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: PRETO, marginBottom: 4 }}>
          {assinado ? 'ASSINATURA ELETRÔNICA' : 'DOCUMENTO NÃO ASSINADO'}
        </Text>
        {assinado ? (
          <>
            {d.assinaturas.map((a, i) => (
              <View key={i} style={{ marginBottom: 4 }}>
                <Text style={{ fontSize: 7.5, color: PRETO }}>
                  {a.papel === 'empresa' ? 'Empregador' : 'Colaborador'}: {a.por ?? '—'} · {dtBR(a.assinado_em)}
                  {a.ip ? ` · IP ${a.ip}` : ''}
                </Text>
                <Text style={{ fontSize: 6, color: CINZA_CLARO, fontFamily: 'Courier' }}>SHA-256 {a.hash}</Text>
              </View>
            ))}
            <Text style={{ fontSize: 6.5, color: CINZA, marginTop: 3, lineHeight: 1.4 }}>
              Assinatura eletrônica avançada (Lei nº 14.063/2020, art. 4º, II), com validade reconhecida
              entre as partes nos termos do art. 10, § 2º, da MP nº 2.200-2/2001, mediante termo de adesão
              previamente firmado. Autenticação por senha pessoal e código de uso único enviado ao e-mail
              pessoal do signatário. O código SHA-256 acima identifica o conteúdo assinado: qualquer
              alteração posterior produz um código diferente.
            </Text>
          </>
        ) : (
          <Text style={{ fontSize: 7, color: CINZA }}>
            Este espelho ainda não foi assinado eletronicamente. Documento emitido apenas para conferência.
          </Text>
        )}
      </View>

      <Rodape
        identificacao={`Espelho de ponto · ${d.colaborador.nome} · ${d.competencia}`}
        geradoEm={agoraBR()}
      />
    </Page>
  )
}

export function EspelhoDoc(props: { d: EspelhoPdfDados; agencia: Agencia; logoUrl: string | null }) {
  return <Document><EspelhoPagina {...props} /></Document>
}

/** O documento do fechamento: todo o time num PDF só, uma pessoa por página. */
export function EspelhoLoteDoc({ dados, agencia, logoUrl }: {
  dados: EspelhoPdfDados[]; agencia: Agencia; logoUrl: string | null
}) {
  return (
    <Document>
      {dados.map((d, i) => <EspelhoPagina key={i} d={d} agencia={agencia} logoUrl={logoUrl} />)}
    </Document>
  )
}
