// Ficha de admissão em PDF — o documento que a contabilidade já recebe hoje em
// Word, com as mesmas seções e na mesma ordem. Os campos vêm de
// `lib/admissao-ficha`: formulário, conferência e PDF leem a MESMA definição.
import { Text, View } from '@react-pdf/renderer'
import { s, PRETO, CINZA, CINZA_CLARO, LINHA, FolhaA4, Cabecalho, Rodape, agoraBR, brl, dataBR, type Agencia } from './kit'
import { SECOES_FICHA, CAMPOS_CONJUGE, CAMPOS_FILHO, type FichaAdmissao } from '@/lib/admissao-ficha'
import { hora, horasSemanais, type BeneficiosProposta, type JornadaProposta } from '@/lib/admissao'

export interface FichaAdmissaoPdf {
  nome: string
  cargo: string | null
  tipo_vinculo: string | null
  salario: string | null
  data_inicio: string | null
  jornada: JornadaProposta | null
  beneficios: BeneficiosProposta | null
  exame_em: string | null
  ficha: FichaAdmissao | null
  departamento?: string | null
  anexos: { tipo: string; nome: string | null }[]
}

const dtBR = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—')

/** Par rótulo/valor em coluna — a ficha é toda feita disso. */
function Par({ label, valor, w = '33%' }: { label: string; valor: string; w?: string }) {
  return (
    <View style={{ width: w, paddingRight: 8, marginBottom: 4 }}>
      <Text style={{ fontSize: 6, color: CINZA_CLARO, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</Text>
      <Text style={{ fontSize: 8.5, color: PRETO }}>{valor || '—'}</Text>
    </View>
  )
}
function Titulo({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: PRETO, marginTop: 7, marginBottom: 3,
      borderBottomWidth: 1, borderColor: LINHA, paddingBottom: 2 }}>
      {n} – {children}
    </Text>
  )
}

export function FichaAdmissaoDoc({ d, agencia, logoUrl }: {
  d: FichaAdmissaoPdf; agencia: Agencia; logoUrl: string | null
}) {
  const f = d.ficha ?? {}
  const val = (sec: keyof FichaAdmissao, k: string) =>
    String(((f[sec] ?? {}) as Record<string, string>)[k] ?? '')
  const j = d.jornada ?? {}
  const b = d.beneficios ?? {}

  const secoesPessoa = SECOES_FICHA.filter(x => x.id !== 'banco')
  const banco = SECOES_FICHA.find(x => x.id === 'banco')

  return (
    <FolhaA4>
        <Cabecalho agencia={agencia} logoUrl={logoUrl} />
        <Text style={{ ...s.titulo, marginTop: 10 }}>FICHA DE ADMISSÃO</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
          <Par label="Razão social" valor={agencia.razao} w="50%" />
          <Par label="Departamento" valor={d.departamento ?? '—'} w="25%" />
          <Par label="Admissão" valor={dataBR(d.data_inicio)} w="25%" />
        </View>

        <Titulo n={1}>DADOS PESSOAIS</Titulo>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Par label="Nome" valor={d.nome} w="100%" />
          {(secoesPessoa.find(x => x.id === 'pessoais')?.campos ?? []).map(c => (
            <Par key={c.k} label={c.label} valor={c.tipo === 'data' ? dataBR(val('pessoais', c.k)) : val('pessoais', c.k)}
              w={c.col === 6 ? '50%' : '25%'} />
          ))}
        </View>

        <Titulo n={2}>ENDEREÇO</Titulo>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {(secoesPessoa.find(x => x.id === 'endereco')?.campos ?? []).map(c => (
            <Par key={c.k} label={c.label} valor={val('endereco', c.k)} w={c.col === 4 ? '40%' : c.col === 2 ? '20%' : '25%'} />
          ))}
        </View>

        <Titulo n={3}>ESCOLARIDADE</Titulo>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {(secoesPessoa.find(x => x.id === 'escolaridade')?.campos ?? []).map(c => (
            <Par key={c.k} label={c.label} valor={val('escolaridade', c.k)} w="50%" />
          ))}
        </View>

        <Titulo n={4}>DOCUMENTAÇÃO</Titulo>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {(secoesPessoa.find(x => x.id === 'documentos')?.campos ?? []).map(c => (
            <Par key={c.k} label={c.label} valor={c.tipo === 'data' ? dataBR(val('documentos', c.k)) : val('documentos', c.k)}
              w={c.col === 2 ? '20%' : '25%'} />
          ))}
        </View>

        <Titulo n={5}>DEPENDENTES</Titulo>
        {CAMPOS_CONJUGE.some(c => val('conjuge', c.k)) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {CAMPOS_CONJUGE.map(c => (
              <Par key={c.k} label={c.label} valor={c.tipo === 'data' ? dataBR(val('conjuge', c.k)) : val('conjuge', c.k)}
                w={c.col === 6 ? '50%' : '25%'} />
            ))}
          </View>
        )}
        {(f.filhos ?? []).map((filho, i) => (
          <View key={i} style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {CAMPOS_FILHO.map(c => (
              <Par key={c.k} label={`${c.label} (filho ${i + 1})`}
                valor={c.tipo === 'data' ? dataBR(filho[c.k] ?? '') : (filho[c.k] ?? '')}
                w={c.col === 6 ? '50%' : '25%'} />
            ))}
          </View>
        ))}
        {!(f.filhos ?? []).length && !CAMPOS_CONJUGE.some(c => val('conjuge', c.k)) && (
          <Text style={{ fontSize: 8, color: CINZA }}>Nenhum dependente declarado.</Text>
        )}

        <Titulo n={6}>DADOS DA CONTRATAÇÃO</Titulo>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Par label="Cargo" valor={d.cargo ?? '—'} w="34%" />
          <Par label="Vínculo" valor={(d.tipo_vinculo ?? 'clt').toUpperCase()} w="16%" />
          <Par label="Salário" valor={d.salario ? brl(Number(d.salario)) : '—'} w="25%" />
          <Par label="Data de admissão" valor={dataBR(d.data_inicio)} w="25%" />
          <Par label="Horário de trabalho"
            valor={j.entrada ? `${hora(j.entrada)} às ${hora(j.intervalo_ini)} · ${hora(j.intervalo_fim)} às ${hora(j.saida)}` : '—'} w="50%" />
          <Par label="Horas semanais" valor={`${horasSemanais(j)}h`} w="25%" />
          <Par label="Contrato de experiência" valor="45 + 45 dias" w="25%" />
          <Par label="Exame admissional" valor={dtBR(d.exame_em)} w="50%" />
          <Par label="Vale-transporte" valor={b.vt ? `Sim${b.vt_desconto_pct ? ` (desconto ${b.vt_desconto_pct}%)` : ''}` : 'Não'} w="25%" />
          <Par label="Vale-alimentação" valor={b.va_dia ? `${brl(b.va_dia)}/dia${b.va_desconto_pct ? ` (desconto ${b.va_desconto_pct}%)` : ''}` : 'Não'} w="25%" />
        </View>

        <Titulo n={7}>DADOS BANCÁRIOS</Titulo>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {(banco?.campos ?? []).map(c => (
            <Par key={c.k} label={c.label} valor={val('banco', c.k)} w="25%" />
          ))}
        </View>

        <Titulo n={8}>DOCUMENTOS ENVIADOS</Titulo>
        <Text style={{ fontSize: 8, color: PRETO }}>
          {d.anexos.length ? d.anexos.map(x => `${x.tipo}${x.nome ? ` (${x.nome})` : ''}`).join(' · ') : 'Nenhum anexo.'}
        </Text>

        {f.observacao ? (
          <>
            <Titulo n={9}>OBSERVAÇÕES</Titulo>
            <Text style={{ fontSize: 8.5, color: PRETO }}>{f.observacao}</Text>
          </>
        ) : null}

        <Text style={{ fontSize: 6.5, color: CINZA_CLARO, marginTop: 12 }}>
          Preenchida pelo próprio candidato no link da proposta e conferida pelo RH.
        </Text>
      <Rodape identificacao={`Ficha de admissão — ${d.nome}`} geradoEm={agoraBR()} />
    </FolhaA4>
  )
}
