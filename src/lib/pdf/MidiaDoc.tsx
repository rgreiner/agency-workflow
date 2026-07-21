// Autorização de Mídia (PI) em PDF. Espelha o documento que a agência já enviava
// ao veículo: cabeçalho, partes, pares de veiculação, duas colunas (localizações
// × valores), texto legal em largura inteira, datas e assinaturas.

import { Text, View } from '@react-pdf/renderer'
import {
  s, Cabecalho, Linha, Secao, TabLinha, Assinaturas, Rodape, FolhaA4, brl, dataBR, agoraBR,
} from './kit'
import type { MidiaDocData } from './midia-data'

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
          {d.localizacoes.length > 0 && (
            <>
              <Secao titulo="Localizações" />
              {d.localizacoes.map((l, i) => (
                <Text key={i} style={s.item}>{[l.endereco, l.cidade].filter(Boolean).join(' - ')}</Text>
              ))}
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
              <TabLinha label="Valor unitário" valor={brl(d.producao.unitario)} />
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
        </View>
      </View>

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
