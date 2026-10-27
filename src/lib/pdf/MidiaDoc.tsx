// Autorização de Mídia (PI) em PDF. Espelha o documento que a agência já enviava
// ao veículo: cabeçalho, partes, pares de veiculação, duas colunas (localizações
// × valores), texto legal em largura inteira, datas e assinaturas.

import { Text, View } from '@react-pdf/renderer'
import {
  s, Cabecalho, Linha, Secao, TabLinha, Assinaturas, Rodape, FolhaA4, brl, brlUnit, dataBR, agoraBR, CINZA, CINZA_CLARO,
} from './kit'
import type { MidiaDocData, MapaPeriodo } from './midia-data'

export function MidiaDoc({ d }: { d: MidiaDocData }) {
  const identificacao = `Flow | Autorização de Mídia ${d.tipoLabel} nº ${d.numero ?? ''}`
  return (
    <FolhaA4>
      <Cabecalho agencia={d.agencia} logoUrl={d.logoUrl} />

      <Text style={s.titulo}>Autorização de Mídia {d.tipoLabel} nº {d.numero ?? ''}</Text>

      <Linha label="Veículo">
        <Text style={s.forte}>{d.veiculo.nome}</Text>
        {!!d.veiculo.endereco && <Text style={s.fraco}>{d.veiculo.endereco}</Text>}
        {!!d.veiculo.cnpjFone && <Text style={s.fraco}>{d.veiculo.cnpjFone}</Text>}
        {!!d.veiculo.notas && <Text style={s.fraco}>{d.veiculo.notas}</Text>}
      </Linha>

      <Linha label="Cliente">
        <Text style={s.forte}>{d.cliente.nome}</Text>
        {!!d.cliente.razao && <Text style={s.fraco}>{d.cliente.razao}</Text>}
        {!!d.cliente.endereco && <Text style={s.fraco}>{d.cliente.endereco}</Text>}
        {!!d.cliente.cnpj && <Text style={s.fraco}>{d.cliente.cnpj}</Text>}
      </Linha>

      <Linha label="Produto"><Text>{d.titulo}</Text></Linha>
      {!!d.campanha && <Linha label="Campanha"><Text>{d.campanha}</Text></Linha>}

      {/* Pares lado a lado (Praça/Espécie, Mês/Bisemana…) */}
      {d.pares.length > 0 && (
        <View style={s.paresGrade}>
          {d.pares.map(p => (
            <View key={p.label} style={s.parCelula}>
              <Text style={s.linhaLabel}>{p.label}</Text>
              <Text style={s.linhaValor}>{p.valor}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={s.colunas}>
        <View style={s.colEsq}>
          {/* Sem localizações (Eletrônica), a coluna da esquerda ficava vazia ao lado
              de Exibição/Preços: as peças moram aqui e a assinatura cabe na 1ª página. */}
          {d.localizacoes.length === 0 && d.pecas.length > 0 && <TabelaPecas pecas={d.pecas} compacta />}
          {d.localizacoes.length > 0 && (
            <>
              <Secao titulo="Localizações" />
              {d.localizacoes.map((l, i) => (
                <Text key={i} style={s.item}>{[l.endereco, l.cidade].filter(Boolean).join(' - ')}</Text>
              ))}
              {/* A coluna direita (produção/exibição/preços) é a mais alta: embaixo das
                  localizações sobra espaço, e a observação não empurra a assinatura. */}
              {!!d.observacao && (
                <View style={{ marginTop: 8 }}>
                  <Secao titulo="Observações" />
                  <Text style={s.fraco}>{d.observacao}</Text>
                </View>
              )}
            </>
          )}
        </View>

        <View style={s.colDir}>
          {d.producao.mostrar && (
            <>
              <Secao titulo="Produção" />
              <TabLinha label="Tipo" valor={d.producao.tipo} />
              {!!d.producao.pedido && <TabLinha label="Pedido de Prod." valor={d.producao.pedido} />}
              <TabLinha label="Quantidade" valor={String(d.producao.qtd)} />
              <TabLinha label="Valor unitário" valor={brlUnit(d.producao.unitario)} />
              <TabLinha label="Total produção" valor={brl(d.producao.total)} forte />
              {d.producao.comissao > 0 && <TabLinha label="Comissão produção" valor={brl(d.producao.comissao)} />}
            </>
          )}

          <Secao titulo="Exibição" />
          <TabLinha label="Custo" valor={brl(d.exibicao.custo)} />
          <TabLinha
            label="Desconto Padrão Agência ($)"
            valor={`${String(d.exibicao.descPct).replace('.', ',')}% (${brl(d.exibicao.desconto)})`}
          />

          <Secao titulo="Preços" />
          <TabLinha label="Prazo" valor={d.precos.prazoLabel} />
          <TabLinha label={d.precos.faturamentoLabel} valor={brl(d.precos.valor)} forte />

          {/* Com produção, quem lê quer as somas: veiculação + produção e as duas
              comissões juntas. As parcelas já estão acima (Total produção, Comissão
              produção, Desconto Padrão Agência, valor da veiculação) — aqui só o que
              soma, pra não empurrar a página. Sem produção, o valor acima já é o total. */}
          {d.producao.mostrar && (
            <>
              <Secao titulo="Totais" />
              <TabLinha label="Veiculação + produção" valor={brl(d.totais.total)} forte />
              {d.totais.comissoes > 0 && <TabLinha label="Total de comissões" valor={brl(d.totais.comissoes)} forte />}
            </>
          )}
        </View>
      </View>

      {/* Eletrônica/Impressa: o que o veículo precisa para ENCAIXAR a mídia (peças,
          dia a dia, inserções). Sem isto a autorização era só valor e prazo (ME 1578). */}
      {d.localizacoes.length > 0 && d.pecas.length > 0 && <TabelaPecas pecas={d.pecas} />}
      {d.periodos.map(p => <MapaVeiculacao key={p.titulo} p={p} />)}
      {d.insercoes.length > 0 && <TabelaInsercoes linhas={d.insercoes} />}

      {/* Observação do documento (negociação especial, substituição de outra PI). */}
      {!!d.observacao && d.localizacoes.length === 0 && (
        <View style={{ marginTop: 10 }} wrap={false}>
          <Secao titulo="Observações" />
          <Text style={s.fraco}>{d.observacao}</Text>
        </View>
      )}

      {/* Texto legal em largura inteira: é a condição que as duas partes assinam. */}
      <View style={{ marginTop: 10 }}>
        <Secao titulo="Texto Legal" />
        {d.legal.textoProprio ? (
          <Text style={s.fraco}>{d.legal.textoProprio}</Text>
        ) : (
          <>
            <Text style={[s.forte, { marginBottom: 4 }]}>{d.legal.titulo}</Text>
            {d.legal.itens.map((n, i) => (
              <View key={i} style={[s.item, { flexDirection: 'row' }]}>
                <Text style={{ width: 10 }}>•</Text>
                <Text style={[{ flex: 1 }, ...(n.highlight ? [s.destaque] : [])]}>{n.text}</Text>
              </View>
            ))}
          </>
        )}
      </View>

      <View style={[s.paresGrade, { marginTop: 14, marginBottom: 0 }]}>
        <View style={s.parCelula}><Text style={s.linhaLabel}>Local</Text><Text style={s.linhaValor}>{d.datas.local}</Text></View>
        <View style={s.parCelula}><Text style={s.linhaLabel}>Emissão</Text><Text style={s.linhaValor}>{dataBR(d.datas.emissao)}</Text></View>
        <View style={s.parCelula}><Text style={s.linhaLabel}>1ª Veiculação</Text><Text style={s.linhaValor}>{dataBR(d.datas.primeira)}</Text></View>
        <View style={s.parCelula}><Text style={s.linhaLabel}>Última Veiculação</Text><Text style={s.linhaValor}>{dataBR(d.datas.ultima)}</Text></View>
      </View>

      <Assinaturas esquerda={d.assinaturas.esquerda} direita={d.assinaturas.direita} />
      <Rodape identificacao={identificacao} geradoEm={agoraBR()} />
    </FolhaA4>
  )
}

// ── Tabelas da Eletrônica e da Impressa ─────────────────────────────────────

const t = {
  cab: { flexDirection: 'row' as const, borderBottomWidth: 1, borderBottomColor: '#d1d5db', paddingBottom: 2, color: CINZA_CLARO, fontFamily: 'Helvetica-Bold' },
  lin: { flexDirection: 'row' as const, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', paddingVertical: 2.5 },
}

function TabelaPecas({ pecas, compacta = false }: { pecas: MidiaDocData['pecas']; compacta?: boolean }) {
  return (
    <View style={{ marginTop: compacta ? 0 : 10 }} wrap={false}>
      <Secao titulo="Peças" />
      <View style={[t.cab, { fontSize: 7.5 }]}>
        <Text style={{ width: 28 }}>Peça</Text><Text style={{ width: compacta ? 90 : 150 }}>Tipo</Text>
        <Text style={{ flex: 1 }}>Descrição</Text><Text style={{ width: compacta ? 40 : 70, textAlign: 'right' }}>Duração</Text>
      </View>
      {pecas.map((p, i) => (
        <View key={i} style={[t.lin, { fontSize: 8.5 }]}>
          <Text style={{ width: 28, fontFamily: 'Helvetica-Bold' }}>{p.peca}</Text><Text style={{ width: compacta ? 90 : 150 }}>{p.tipo}</Text>
          <Text style={{ flex: 1 }}>{p.descricao}</Text><Text style={{ width: compacta ? 40 : 70, textAlign: 'right' }}>{p.duracao ? `${p.duracao}"` : ''}</Text>
        </View>
      ))}
    </View>
  )
}

/** Grade dia a dia (como na tela): 1 coluna por dia com a letra da semana; fim de semana sombreado. */
function MapaVeiculacao({ p }: { p: MapaPeriodo }) {
  const dia = { width: 9.6, textAlign: 'center' as const }
  return (
    <View style={{ marginTop: 10 }} wrap={false}>
      <Secao titulo={`Veiculação · ${p.titulo}`} />
      <View style={[t.cab, { fontSize: 5.5 }]}>
        <Text style={{ width: 16 }}>Peça</Text><Text style={{ width: 42 }}>Programa</Text>
        {p.dias.map(x => (
          <View key={x.n} style={[dia, x.sem === 'D' ? { backgroundColor: '#f3f4f6' } : {}]}>
            <Text>{x.n}</Text><Text style={{ fontFamily: 'Helvetica' }}>{x.sem}</Text>
          </View>
        ))}
        <Text style={{ width: 20, textAlign: 'right' }}>Exib.</Text><Text style={{ width: 34, textAlign: 'right' }}>Unit.</Text>
        <Text style={{ width: 18, textAlign: 'right' }}>Desc</Text><Text style={{ flex: 1, textAlign: 'right' }}>Total</Text>
      </View>
      {p.itens.map((it, i) => (
        <View key={i} style={[t.lin, { fontSize: 6.5 }]}>
          <Text style={{ width: 16, fontFamily: 'Helvetica-Bold' }}>{it.peca}</Text>
          <Text style={{ width: 42 }}>{it.programa}</Text>
          {it.porDia.map((v, j) => (
            <Text key={j} style={[dia, p.dias[j].sem === 'D' ? { backgroundColor: '#f3f4f6' } : {}, ...(v ? [{ fontFamily: 'Helvetica-Bold' }] : [])]}>{v ?? ''}</Text>
          ))}
          <Text style={{ width: 20, textAlign: 'right' }}>{it.exib}</Text>
          <Text style={{ width: 34, textAlign: 'right' }}>{brlUnit(it.unitario).replace('R$ ', '')}</Text>
          <Text style={{ width: 18, textAlign: 'right' }}>{it.desconto ? `${String(it.desconto).replace('.', ',')}%` : ''}</Text>
          <Text style={{ flex: 1, textAlign: 'right' }}>{brl(it.total).replace('R$ ', '')}</Text>
        </View>
      ))}
      <View style={[t.lin, { fontSize: 7, borderBottomWidth: 0 }]}>
        <Text style={{ flex: 1, color: CINZA }}>{`${p.exib} exibições no mês`}</Text>
        <Text style={{ fontFamily: 'Helvetica-Bold' }}>Total do período: {brl(p.total)}</Text>
      </View>
    </View>
  )
}

function TabelaInsercoes({ linhas }: { linhas: MidiaDocData['insercoes'] }) {
  const c = { fmt: 90, mes: 60, ed: 32, ins: 28, abr: 50, db: 48, val: 56, desc: 26 }
  return (
    <View style={{ marginTop: 10 }} wrap={false}>
      <Secao titulo="Inserções" />
      <View style={[t.cab, { fontSize: 6.5 }]}>
        <Text style={{ width: c.fmt }}>Formato</Text><Text style={{ width: c.mes }}>Mês</Text><Text style={{ width: c.ed }}>Edição</Text>
        <Text style={{ width: c.ins, textAlign: 'right' }}>Ins.</Text><Text style={{ width: c.abr, paddingLeft: 6 }}>Abrang.</Text>
        <Text style={{ flex: 1 }}>Determinação</Text><Text style={{ width: c.db }}>Data base</Text>
        <Text style={{ width: c.val, textAlign: 'right' }}>Valor</Text><Text style={{ width: c.desc, textAlign: 'right' }}>Desc</Text>
        <Text style={{ width: c.val, textAlign: 'right' }}>Total</Text>
      </View>
      {linhas.map((r, i) => (
        <View key={i} style={[t.lin, { fontSize: 7.5 }]}>
          <Text style={{ width: c.fmt }}>{r.formato}</Text><Text style={{ width: c.mes }}>{r.mesAno}</Text><Text style={{ width: c.ed }}>{r.edicao}</Text>
          <Text style={{ width: c.ins, textAlign: 'right' }}>{r.insercoes}</Text><Text style={{ width: c.abr, paddingLeft: 6 }}>{r.abrangencia}</Text>
          <Text style={{ flex: 1 }}>{r.determinacao}</Text><Text style={{ width: c.db }}>{dataBR(r.dataBase)}</Text>
          <Text style={{ width: c.val, textAlign: 'right' }}>{brl(r.valor).replace('R$ ', '')}</Text>
          <Text style={{ width: c.desc, textAlign: 'right' }}>{r.desconto ? `${String(r.desconto).replace('.', ',')}%` : ''}</Text>
          <Text style={{ width: c.val, textAlign: 'right' }}>{brl(r.total).replace('R$ ', '')}</Text>
        </View>
      ))}
    </View>
  )
}
