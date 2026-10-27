// Autorização de Mídia (PI/ME/MX) em PDF, em PAISAGEM (Rafael, 27/10/2026).
//
// Disposição inspirada no contrato de veiculação da RPC, que é o que o veículo
// está acostumado a ler: partes lado a lado, o detalhe da veiculação em largura
// inteira (é com ele que o veículo ENCAIXA a mídia — ME 1578 saía sem) e, embaixo,
// três colunas: observações · texto legal · "Valor de mídia" em cascata
// (bruto − negociação − agência = líquido). Tudo cabendo em uma folha no caso comum.

import { Text, View } from '@react-pdf/renderer'
import {
  s, Cabecalho, Secao, Assinaturas, Rodape, FolhaA4, brl, brlUnit, dataBR, agoraBR, CINZA, CINZA_CLARO,
} from './kit'
import type { MidiaDocData, MapaPeriodo } from './midia-data'

const L = {
  rot: { fontSize: 6.5, color: CINZA_CLARO, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' as const, letterSpacing: 0.4, marginBottom: 2 },
  col3: { flexDirection: 'row' as const, gap: 16 },
  cab: { flexDirection: 'row' as const, borderBottomWidth: 1, borderBottomColor: '#d1d5db', paddingBottom: 2, color: CINZA_CLARO, fontFamily: 'Helvetica-Bold' },
  lin: { flexDirection: 'row' as const, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', paddingVertical: 2.5 },
}

function Parte({ rotulo, nome, linhas }: { rotulo: string; nome: string; linhas: string[] }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={L.rot}>{rotulo}</Text>
      <Text style={[s.forte, { fontSize: 9 }]}>{nome}</Text>
      {linhas.filter(Boolean).map((l, i) => <Text key={i} style={[s.fraco, { fontSize: 7.5, lineHeight: 1.35 }]}>{l}</Text>)}
    </View>
  )
}

/** Linha de valor compacta (a paisagem tem pouca altura: a TabLinha do retrato tem 3,5 pt de folga). */
function V({ label, valor, forte }: { label: string; valor: string; forte?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#f3f4f6', paddingVertical: 1.8, fontSize: 8 }}>
      <Text style={{ color: CINZA_CLARO }}>{label}</Text>
      <Text style={forte ? s.forte : {}}>{valor}</Text>
    </View>
  )
}

function Par({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 1.5 }}>
      <Text style={{ width: 70, fontSize: 7.5, color: CINZA_CLARO }}>{rotulo}</Text>
      <Text style={{ flex: 1, fontSize: 8 }}>{valor}</Text>
    </View>
  )
}

export function MidiaDoc({ d }: { d: MidiaDocData }) {
  const identificacao = `Flow | Autorização de Mídia ${d.tipoLabel} nº ${d.numero ?? ''}`
  const veiculacao = [d.datas.primeira, d.datas.ultima].some(Boolean)
    ? `${dataBR(d.datas.primeira)} a ${dataBR(d.datas.ultima)}` : ''
  return (
    <FolhaA4 paisagem>
      <Cabecalho agencia={d.agencia} logoUrl={d.logoUrl} />

      <Text style={[s.titulo, { fontSize: 15, marginTop: 10, marginBottom: 10 }]}>
        Autorização de Mídia {d.tipoLabel} nº {d.numero ?? ''}
      </Text>

      {/* Partes lado a lado + os dados do documento. */}
      <View style={L.col3}>
        <Parte rotulo="Veículo" nome={d.veiculo.nome} linhas={[d.veiculo.endereco, d.veiculo.cnpjFone, d.veiculo.notas]} />
        <Parte rotulo="Cliente" nome={d.cliente.nome} linhas={[d.cliente.razao, d.cliente.endereco, d.cliente.cnpj]} />
        <View style={{ flex: 1 }}>
          <Text style={L.rot}>Veiculação</Text>
          <Par rotulo="Produto" valor={d.titulo} />
          {!!d.campanha && <Par rotulo="Campanha" valor={d.campanha} />}
          {d.pares.map(p => <Par key={p.label} rotulo={p.label} valor={p.valor} />)}
          {!!veiculacao && <Par rotulo="Período" valor={veiculacao} />}
        </View>
      </View>

      {/* O detalhe que o veículo usa para encaixar — largura inteira. */}
      {d.pecas.length > 0 && <LinhaPecas pecas={d.pecas} />}
      {d.periodos.map(p => <MapaVeiculacao key={p.titulo} p={p} />)}
      {d.insercoes.length > 0 && <TabelaInsercoes linhas={d.insercoes} />}
      {(d.localizacoes.length > 0 || d.producao.mostrar) && <LocalizacoesProducao d={d} />}

      {/* Observações · texto legal · valores. */}
      <View style={[L.col3, { marginTop: 12 }]} wrap={false}>
        <View style={{ flex: 1 }}>
          <Secao titulo="Observações" />
          <Text style={[s.fraco, { fontSize: 7.5 }]}>{d.observacao || '—'}</Text>
        </View>

        <View style={{ flex: 1.35 }}>
          <Secao titulo="Texto Legal" />
          {d.legal.textoProprio ? (
            <Text style={[s.fraco, { fontSize: 7.5 }]}>{d.legal.textoProprio}</Text>
          ) : (
            <>
              <Text style={[s.forte, { fontSize: 7.5, marginBottom: 2 }]}>{d.legal.titulo}</Text>
              {d.legal.itens.map((n, i) => (
                <View key={i} style={{ flexDirection: 'row', marginBottom: 1.5, fontSize: 7.5 }}>
                  <Text style={{ width: 8 }}>•</Text>
                  <Text style={[{ flex: 1 }, ...(n.highlight ? [s.destaque] : [])]}>{n.text}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Secao titulo="Valor de mídia" />
          <V label="Valor bruto" valor={brl(d.exibicao.custo)} />
          {d.exibicao.negociacao > 0 && (
            <>
              <V label="Desconto de negociação"
                valor={`${(d.exibicao.negociacao / (d.exibicao.custo || 1) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% (${brl(d.exibicao.negociacao)})`} />
              <V label="Valor negociado" valor={brl(d.precos.valor)} forte />
            </>
          )}
          <V label={`Agência ${String(d.exibicao.descPct).replace('.', ',')}%`} valor={brl(d.exibicao.desconto)} />
          <V label="Valor líquido" valor={brl(d.exibicao.liquido)} forte />
          <V label="Faturamento" valor={d.precos.faturamentoLabel} />
          <V label="Prazo" valor={d.precos.prazoLabel} />
          {d.producao.mostrar && (
            <>
              <V label="Veiculação + produção" valor={brl(d.totais.total)} forte />
              {d.totais.comissoes > 0 && <V label="Total de comissões" valor={brl(d.totais.comissoes)} />}
            </>
          )}
        </View>
      </View>

      <View wrap={false}>
        <Text style={{ marginTop: 10, fontSize: 7.5, color: CINZA }}>
          {d.datas.local}, {dataBR(d.datas.emissao)}
        </Text>
        <View style={{ marginTop: -14 }}>
          <Assinaturas esquerda={d.assinaturas.esquerda} direita={d.assinaturas.direita} />
        </View>
      </View>
      <Rodape identificacao={identificacao} geradoEm={agoraBR()} />
    </FolhaA4>
  )
}

// ── Detalhe por tipo ────────────────────────────────────────────────────────

/** Peças numa linha só: "A — Chamada Eleições (15")  ·  B — Spot (30")". */
function LinhaPecas({ pecas }: { pecas: MidiaDocData['pecas'] }) {
  return (
    <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' }} wrap={false}>
      <Text style={[L.rot, { marginRight: 8, marginBottom: 0 }]}>Peças</Text>
      {pecas.map((p, i) => (
        <Text key={i} style={{ fontSize: 8, marginRight: 14 }}>
          <Text style={s.forte}>{p.peca}</Text>
          {` — ${[p.tipo, p.descricao].filter(Boolean).join(' · ')}${p.duracao ? ` (${p.duracao}")` : ''}`}
        </Text>
      ))}
    </View>
  )
}

/** Grade dia a dia como na tela e na RPC: uma coluna por dia com a letra da semana; domingo sombreado. */
function MapaVeiculacao({ p }: { p: MapaPeriodo }) {
  const dia = { width: 16.5, textAlign: 'center' as const }
  const dom = (j: number) => (p.dias[j]?.sem === 'D' ? { backgroundColor: '#f3f4f6' } : {})
  return (
    <View style={{ marginTop: 8 }} wrap={false}>
      <Secao titulo={`Veiculação · ${p.titulo}`} />
      <View style={[L.cab, { fontSize: 6 }]}>
        <Text style={{ width: 18 }}>Peça</Text><Text style={{ width: 56 }}>Programa</Text>
        {p.dias.map((x, j) => (
          <View key={x.n} style={[dia, dom(j)]}>
            <Text>{x.n}</Text><Text style={{ fontFamily: 'Helvetica' }}>{x.sem}</Text>
          </View>
        ))}
        <Text style={{ width: 24, textAlign: 'right' }}>Exib.</Text><Text style={{ width: 40, textAlign: 'right' }}>Unit.</Text>
        <Text style={{ width: 24, textAlign: 'right' }}>Desc</Text><Text style={{ flex: 1, textAlign: 'right' }}>Total</Text>
      </View>
      {p.itens.map((it, i) => (
        <View key={i} style={[L.lin, { fontSize: 7.5 }]}>
          <Text style={{ width: 18, fontFamily: 'Helvetica-Bold' }}>{it.peca}</Text>
          <Text style={{ width: 56 }}>{it.programa}</Text>
          {it.porDia.map((v, j) => (
            <Text key={j} style={[dia, dom(j), ...(v ? [{ fontFamily: 'Helvetica-Bold' }] : [])]}>{v ?? ''}</Text>
          ))}
          <Text style={{ width: 24, textAlign: 'right' }}>{it.exib}</Text>
          <Text style={{ width: 40, textAlign: 'right' }}>{brlUnit(it.unitario).replace('R$ ', '')}</Text>
          <Text style={{ width: 24, textAlign: 'right' }}>{it.desconto ? `${String(it.desconto).replace('.', ',')}%` : ''}</Text>
          <Text style={{ flex: 1, textAlign: 'right' }}>{brl(it.total).replace('R$ ', '')}</Text>
        </View>
      ))}
      <View style={[L.lin, { fontSize: 7.5, borderBottomWidth: 0 }]}>
        <Text style={{ flex: 1, color: CINZA }}>{p.exib} exibições no mês</Text>
        <Text style={{ fontFamily: 'Helvetica-Bold' }}>Total do período: {brl(p.total)}</Text>
      </View>
    </View>
  )
}

function TabelaInsercoes({ linhas }: { linhas: MidiaDocData['insercoes'] }) {
  const c = { fmt: 130, mes: 80, ed: 50, ins: 40, abr: 70, db: 60, val: 70, desc: 40 }
  return (
    <View style={{ marginTop: 10 }} wrap={false}>
      <Secao titulo="Inserções" />
      <View style={[L.cab, { fontSize: 7 }]}>
        <Text style={{ width: c.fmt }}>Formato</Text><Text style={{ width: c.mes }}>Mês</Text><Text style={{ width: c.ed }}>Edição</Text>
        <Text style={{ width: c.ins, textAlign: 'right' }}>Ins.</Text><Text style={{ width: c.abr, paddingLeft: 8 }}>Abrangência</Text>
        <Text style={{ flex: 1 }}>Determinação</Text><Text style={{ width: c.db }}>Data base</Text>
        <Text style={{ width: c.val, textAlign: 'right' }}>Valor</Text><Text style={{ width: c.desc, textAlign: 'right' }}>Desc</Text>
        <Text style={{ width: c.val, textAlign: 'right' }}>Total</Text>
      </View>
      {linhas.map((r, i) => (
        <View key={i} style={[L.lin, { fontSize: 8 }]}>
          <Text style={{ width: c.fmt }}>{r.formato}</Text><Text style={{ width: c.mes }}>{r.mesAno}</Text><Text style={{ width: c.ed }}>{r.edicao}</Text>
          <Text style={{ width: c.ins, textAlign: 'right' }}>{r.insercoes}</Text><Text style={{ width: c.abr, paddingLeft: 8 }}>{r.abrangencia}</Text>
          <Text style={{ flex: 1 }}>{r.determinacao}</Text><Text style={{ width: c.db }}>{dataBR(r.dataBase)}</Text>
          <Text style={{ width: c.val, textAlign: 'right' }}>{brl(r.valor).replace('R$ ', '')}</Text>
          <Text style={{ width: c.desc, textAlign: 'right' }}>{r.desconto ? `${String(r.desconto).replace('.', ',')}%` : ''}</Text>
          <Text style={{ width: c.val, textAlign: 'right' }}>{brl(r.total).replace('R$ ', '')}</Text>
        </View>
      ))}
    </View>
  )
}

/** Externa: localizações em duas colunas (a paisagem tem largura) e a produção ao lado. */
function LocalizacoesProducao({ d }: { d: MidiaDocData }) {
  const metade = Math.ceil(d.localizacoes.length / 2)
  const colunas = [d.localizacoes.slice(0, metade), d.localizacoes.slice(metade)]
  return (
    <View style={[L.col3, { marginTop: 10 }]} wrap={false}>
      {d.localizacoes.length > 0 && (
        <View style={{ flex: 2 }}>
          <Secao titulo="Localizações" />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {colunas.map((col, k) => (
              <View key={k} style={{ flex: 1 }}>
                {col.map((l, i) => (
                  <Text key={i} style={{ fontSize: 8, marginBottom: 2 }}>{[l.endereco, l.cidade].filter(Boolean).join(' - ')}</Text>
                ))}
              </View>
            ))}
          </View>
        </View>
      )}
      {d.producao.mostrar && (
        <View style={{ flex: 1 }}>
          <Secao titulo="Produção" />
          <V label="Tipo" valor={d.producao.tipo} />
          {!!d.producao.pedido && <V label="Pedido de Prod." valor={d.producao.pedido} />}
          <V label={`${d.producao.qtd} × ${brlUnit(d.producao.unitario)}`} valor={brl(d.producao.total)} forte />
          {d.producao.comissao > 0 && <V label="Comissão produção" valor={brl(d.producao.comissao)} />}
        </View>
      )}
    </View>
  )
}
