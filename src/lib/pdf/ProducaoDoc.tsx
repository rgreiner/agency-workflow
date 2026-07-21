/* eslint-disable jsx-a11y/alt-text */
// Documentos de Produção em PDF (Fee, Proposta, Pedido de Produção, Orçamento).
// Espelha o que a agência já imprimia — cabeçalho, corpo por tipo, notas legais,
// data e assinaturas. Uma definição só (a tela de visualização mostra este PDF).

import { Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import {
  s, CINZA, CINZA_CLARO, Cabecalho, Linha, Secao, Assinaturas, Rodape, FolhaA4, brl, dataBR, agoraBR,
} from './kit'
import type { ProducaoDocData, LegalNote } from './producao-data'

const t = StyleSheet.create({
  sub: { color: CINZA, marginBottom: 14, marginTop: -8 },
  box: { flexDirection: 'row', backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, paddingVertical: 10, marginVertical: 10 },
  boxCell: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  boxLabel: { fontSize: 7.5, color: CINZA_CLARO, marginBottom: 2 },
  boxVal: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: '#111827' },
  th: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingBottom: 3, marginBottom: 1 },
  thText: { color: CINZA_CLARO, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f3f4f6', paddingVertical: 3.5 },
  trForte: { flexDirection: 'row', paddingVertical: 5, fontFamily: 'Helvetica-Bold' },
  right: { textAlign: 'right' },
  italico: { color: CINZA, borderLeftWidth: 2, borderLeftColor: '#9ca3af', paddingLeft: 6, marginBottom: 10 },
  itemNome: { fontFamily: 'Helvetica-Bold', color: '#111827' },
  itemBloco: { marginBottom: 10 },
  orcImg: { width: 96, height: 68, objectFit: 'cover', borderRadius: 3, marginRight: 8 },
  notaItem: { flexDirection: 'row', marginBottom: 3 },
})

/** Bullets legais (NF), com destaque amarelo quando marcado. */
function Notas({ notas }: { notas: LegalNote[] }) {
  return (
    <View style={{ marginTop: 8 }}>
      {notas.map((n, i) => (
        <View key={i} style={t.notaItem}>
          <Text style={{ width: 10 }}>•</Text>
          <Text style={[{ flex: 1 }, ...(n.highlight ? [s.destaque] : [])]}>{n.text}</Text>
        </View>
      ))}
    </View>
  )
}

function Rodapes({ observacao, textoLegal }: { observacao: string; textoLegal: string }) {
  return (
    <>
      {!!observacao && <Text style={[s.item, { marginTop: 6 }]}>{observacao}</Text>}
      {!!textoLegal && <Text style={[s.fraco, { marginTop: 4 }]}>{textoLegal}</Text>}
    </>
  )
}

export function ProducaoDoc({ d }: { d: ProducaoDocData }) {
  const identificacao = `Flow | ${d.tipoLabel} nº ${d.numero ?? ''}`
  return (
    <FolhaA4>
      <Cabecalho agencia={d.agencia} logoUrl={d.logoUrl} />
      <Text style={s.titulo}>{d.tipoLabel} nº {d.numero ?? ''}</Text>

      {d.tipo === 'fee' && <Fee d={d} />}
      {d.tipo === 'proposta' && <Proposta d={d} />}
      {d.tipo === 'pedido' && <Pedido d={d} />}
      {d.tipo === 'orcamento' && <Orcamento d={d} />}

      <Text style={{ marginTop: 20, color: CINZA }}>
        {d.tipo === 'orcamento' ? d.emissaoExtenso : `${d.cidade}, ${dataBR(d.emissao)}`}
      </Text>
      <Assinaturas esquerda={d.assinaturas.esquerda} direita={d.assinaturas.direita} />
      <Rodape identificacao={identificacao} geradoEm={agoraBR()} />
    </FolhaA4>
  )
}

function Fee({ d }: { d: Extract<ProducaoDocData, { tipo: 'fee' }> }) {
  const f = d.fee
  return (
    <>
      <Text style={t.sub}>{d.cliente.nome} — {d.titulo}</Text>
      <View style={t.box}>
        <Cell label="De" valor={dataBR(f.de)} />
        <Cell label="Até" valor={dataBR(f.ate)} />
        <Cell label="Parcelas" valor={f.numParcelas} />
        <Cell label="Valor mensal" valor={brl(f.valorMensal)} />
      </View>
      <Secao titulo="Parcelas" />
      <View style={{ width: '66%' }}>
        <View style={t.th}><Text style={[t.thText, { flex: 1 }]}>Vencimento</Text><Text style={[t.thText, { flex: 1 }, t.right]}>Valor</Text></View>
        {f.parcelas.map((pc, i) => (
          <View key={i} style={t.tr}><Text style={{ flex: 1 }}>{dataBR(pc.vencimento)}</Text><Text style={[{ flex: 1 }, t.right]}>{brl(pc.valor)}</Text></View>
        ))}
        <View style={t.trForte}><Text style={{ flex: 1 }}>Total do contrato</Text><Text style={[{ flex: 1 }, t.right]}>{brl(f.total)}</Text></View>
      </View>
      <Rodapes observacao={d.observacao} textoLegal={d.textoLegal} />
    </>
  )
}

function Proposta({ d }: { d: Extract<ProducaoDocData, { tipo: 'proposta' }> }) {
  const pr = d.proposta
  return (
    <>
      <Text style={t.sub}>{[d.cliente.nome, d.campanha].filter(Boolean).join(' · ')} — {d.titulo}</Text>
      {!!pr.introducao && <Text style={[s.item, { marginBottom: 12 }]}>{pr.introducao}</Text>}
      <Secao titulo="Itens" />
      <View style={t.th}>
        <Text style={[t.thText, { width: '18%' }]}>Tipo</Text>
        <Text style={[t.thText, { flex: 1 }]}>Item</Text>
        <Text style={[t.thText, { width: '14%' }, t.right]}>Qtd.</Text>
        <Text style={[t.thText, { width: '22%' }, t.right]}>Total</Text>
      </View>
      {pr.itens.map((it, i) => (
        <View key={i} style={t.tr}>
          <Text style={{ width: '18%' }}>{it.tipoLabel}</Text>
          <Text style={{ flex: 1 }}>{it.nome}</Text>
          <Text style={[{ width: '14%' }, t.right]}>{it.quantidade}</Text>
          <Text style={[{ width: '22%' }, t.right]}>{brl(it.total)}</Text>
        </View>
      ))}
      <View style={t.trForte}><Text style={{ flex: 1 }}>Total</Text><Text style={[{ width: '22%' }, t.right]}>{brl(pr.total)}</Text></View>
      <Rodapes observacao={d.observacao} textoLegal={d.textoLegal} />
    </>
  )
}

function Pedido({ d }: { d: Extract<ProducaoDocData, { tipo: 'pedido' }> }) {
  const pd = d.pedido
  return (
    <>
      <Linha label="Fornecedor">
        <Text style={s.forte}>{pd.fornecedor.nome}</Text>
        {!!pd.fornecedor.cnpj && <Text style={s.fraco}>{pd.fornecedor.cnpj}</Text>}
      </Linha>
      <Linha label="Cliente">
        <Text style={s.forte}>{d.cliente.nome}</Text>
        {!!d.cliente.razao && <Text style={s.fraco}>{d.cliente.razao}</Text>}
        {!!d.cliente.endereco && <Text style={s.fraco}>{d.cliente.endereco}</Text>}
        {!!d.cliente.cnpj && <Text style={s.fraco}>{d.cliente.cnpj}</Text>}
      </Linha>
      {!!d.campanha && <Linha label="Campanha"><Text>{d.campanha}</Text></Linha>}
      <Linha label="Título"><Text>{d.titulo}</Text></Linha>

      <Text style={[t.italico, { marginTop: 6 }]}>Solicitamos por ordem e conta de nosso cliente acima descrito o seguinte trabalho:</Text>

      {pd.itens.map((it, i) => (
        <View key={i} style={t.itemBloco}>
          <Text style={t.itemNome}>{it.nome || '—'}</Text>
          {!!it.descricao && <Text style={s.fraco}>{it.descricao}</Text>}
          <View style={{ flexDirection: 'row', marginTop: 2 }}>
            <Text style={{ marginRight: 22, color: CINZA }}>Nº Orç.: {it.nOrc || '---'}</Text>
            <Text style={{ marginRight: 22, color: CINZA }}>Quantidade: {it.quant || '---'}</Text>
            <Text style={{ color: CINZA }}>Valor: {brl(it.valor)}</Text>
          </View>
        </View>
      ))}

      <View style={t.box}>
        <Cell label="Valor Total" valor={brl(pd.valorTotal)} />
        <Cell label="Faturar" valor={pd.faturarLabel} />
        <Cell label="Comissão" valor={`${String(pd.comissaoPct).replace('.', ',')}% (${brl(pd.comissao)})`} />
        <Cell label="Entrega" valor={dataBR(pd.entrega)} />
      </View>

      <Notas notas={pd.notas} />
      <Rodapes observacao={d.observacao} textoLegal={d.textoLegal} />
    </>
  )
}

function Orcamento({ d }: { d: Extract<ProducaoDocData, { tipo: 'orcamento' }> }) {
  const oc = d.orcamento
  return (
    <>
      <Linha label="Cliente">
        <Text style={s.forte}>{d.cliente.nome}</Text>
        {!!d.cliente.razao && <Text style={s.fraco}>{d.cliente.razao}</Text>}
        {!!d.cliente.endereco && <Text style={s.fraco}>{d.cliente.endereco}</Text>}
        {!!d.cliente.cnpj && <Text style={s.fraco}>{d.cliente.cnpj}</Text>}
        {!!d.cliente.contato && <Text style={s.fraco}>{d.cliente.contato}</Text>}
      </Linha>
      {!!d.campanha && <Linha label="Campanha"><Text>{d.campanha}</Text></Linha>}
      <Linha label="Título"><Text>{d.titulo}</Text></Linha>

      <View style={{ marginTop: 6 }}><Secao titulo="Itens" /></View>
      {oc.itens.map((it, i) => (
        <View key={i} style={{ marginBottom: 12 }} wrap={false}>
          <View style={{ flexDirection: 'row', marginBottom: 3 }}>
            {!!it.imagem && <Image src={it.imagem} style={t.orcImg} />}
            <View style={{ flex: 1 }}>
              <Text style={t.itemNome}>{it.nome || '—'}</Text>
              {!!it.descricao && <Text style={s.fraco}>{it.descricao}</Text>}
            </View>
          </View>
          <View style={t.th}>
            <Text style={[t.thText, { flex: 1 }]}>Fornecedor</Text>
            <Text style={[t.thText, { width: '14%' }]}>Nº Orç.</Text>
            <Text style={[t.thText, { width: '13%' }]}>Pgto.</Text>
            <Text style={[t.thText, { width: '11%' }]}>Quant.</Text>
            <Text style={[t.thText, { width: '17%' }, t.right]}>Unit.</Text>
            <Text style={[t.thText, { width: '17%' }, t.right]}>Total</Text>
            <Text style={[t.thText, { width: 14 }]} />
          </View>
          {it.opcoes.map((o, j) => (
            <View key={j} style={t.tr}>
              <Text style={{ flex: 1 }}>{o.fornecedor}</Text>
              <Text style={{ width: '14%' }}>{o.nOrc}</Text>
              <Text style={{ width: '13%' }}>{o.pgto}</Text>
              <Text style={{ width: '11%' }}>{o.quant}</Text>
              <Text style={[{ width: '17%' }, t.right]}>{brl(o.valorUnit)}</Text>
              <Text style={[{ width: '17%' }, t.right, ...(o.selecionado ? [s.forte] : [])]}>{brl(o.total)}</Text>
              <Text style={{ width: 14, textAlign: 'right', color: '#059669' }}>{o.selecionado ? '✓' : ''}</Text>
            </View>
          ))}
        </View>
      ))}

      <Notas notas={oc.notas} />
      <Rodapes observacao={d.observacao} textoLegal={d.textoLegal} />
    </>
  )
}

function Cell({ label, valor }: { label: string; valor: string }) {
  return (
    <View style={t.boxCell}>
      <Text style={t.boxLabel}>{label}</Text>
      <Text style={t.boxVal}>{valor}</Text>
    </View>
  )
}
