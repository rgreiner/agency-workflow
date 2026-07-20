import { assertFinanceAccess } from '@/lib/finance'
import { isRealizado, isIgnorado } from '@/lib/extrato'
import { LancamentosClient, type Lancamento, type ContaRef } from './LancamentosClient'
import type { FinanceCategoriaGrupo, FinanceCentro } from '@/app/actions/financeiro'

// A dedup "linha importada que virou lançamento some" depende de ler os dois lados
// no mesmo request. Sem isso, uma render cacheada mostra a versão Conta Azul de um
// item já promovido — e a pessoa edita a versão errada (que abre sem anexos).
export const dynamic = 'force-dynamic'

const PAGE = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extratoToLancamento(e: any, contaIdByName: Map<string, string>): Lancamento {
  const valorNum = Number(e.valor ?? 0)
  const tipo = e.tipo === 'despesa' ? 'saida' : e.tipo === 'receita' ? 'entrada' : (valorNum < 0 ? 'saida' : 'entrada')
  const realizado = isRealizado(e.situacao)
  const situacao = realizado ? (tipo === 'saida' ? 'pago' : 'recebido') : 'em_aberto'
  const abs = Math.abs(valorNum || Number(e.valor_original ?? 0))
  return {
    id: `imp:${e.import_ref}`,
    tipo,
    origem_tipo: 'conta_azul',
    parcela_num: null,
    parcela_total: null,
    contato_nome: e.contato ?? null,
    descricao: e.descricao ?? null,
    valor: abs,
    valor_realizado: realizado ? abs : null,
    // data_prevista = data REAL esperada (renegociada/parcial); venc_original = vencimento
    // contratual original. Para o fluxo de caixa vale a prevista — senão um resto renegociado
    // aparece "Atrasado" no mês do vencimento antigo (ex.: Distribuição de Lucros).
    vencimento: e.data_prevista ?? e.venc_original ?? e.data_mov ?? null,
    competencia: e.competencia ?? null,
    situacao,
    nf_emitida: !!e.nota_fiscal,
    boleto_gerado: false,
    revisar: false,
    conta_id: e.conta ? (contaIdByName.get(String(e.conta).trim().toLowerCase()) ?? null) : null,
    categoria: e.categoria ?? null,
    centro_custo: e.centro_custo ?? null,
    data_liquidacao: realizado ? (e.data_mov ?? null) : null,
    forma_pagamento: e.forma_pgto ?? null,
    observacao: e.observacao ?? null,
    juros: e.juros ?? null,
    multa: e.multa ?? null,
    desconto: e.desconto ?? null,
    tarifa: e.taxas ?? null,
    anexos: null,
    source: 'importado',
    import_ref: e.import_ref ?? null,
  }
}

export default async function LancamentosPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [{ data: raw }, { data: contasRaw }, { data: settings }] = await Promise.all([
    sb.from('lancamentos')
      .select('id, tipo, origem_tipo, origem_ref, parcela_num, parcela_total, contato_nome, descricao, valor, valor_realizado, vencimento, competencia, situacao, nf_emitida, boleto_gerado, revisar, conta_id, categoria, centro_custo, data_liquidacao, forma_pagamento, observacao, juros, multa, desconto, tarifa, anexos')
      .eq('org_id', orgId)
      .order('vencimento', { ascending: true, nullsFirst: false }),
    sb.from('contas_financeiras')
      .select('id, nome, cor, ativo')
      .eq('org_id', orgId)
      .order('ordem', { ascending: true }),
    sb.from('org_settings')
      .select('finance_categorias, finance_centros_custo')
      .eq('org_id', orgId)
      .maybeSingle(),
  ])

  const lancamentos = (raw ?? []) as Lancamento[]
  const contas = ((contasRaw ?? []) as ContaRef[]).filter(c => c.ativo)
  const categorias = (settings?.finance_categorias ?? []) as FinanceCategoriaGrupo[]
  const centros = (settings?.finance_centros_custo ?? []) as FinanceCentro[]
  const today = new Date().toISOString().slice(0, 10)

  // Extrato importado (Conta Azul) — mesma fonte do Fluxo de caixa. Mostra aqui como
  // linhas read-only ("Conta Azul"); ao editar, viram lançamento do Flow (promoção).
  const contaIdByName = new Map(contas.map(c => [c.nome.trim().toLowerCase(), c.id]))
  const importadasRaw: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('extrato_importado')
      .select('import_ref, data_mov, contato, descricao, tipo, conta, forma_pgto, valor, situacao, valor_original, juros, multa, desconto, taxas, competencia, venc_original, data_prevista, observacao, nota_fiscal, categoria, centro_custo')
      .eq('org_id', orgId)
      // Ordenação obrigatória: sem ela o Postgres devolve as ~6.9k linhas em ordem
      // arbitrária a cada requisição, e a paginação duplica e perde linhas entre
      // carregamentos. import_ref é único, então serve de desempate estável.
      .order('data_mov', { ascending: true, nullsFirst: false })
      .order('import_ref', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    importadasRaw.push(...data)
    if (data.length < PAGE) break
  }

  // Dedup no SERVIDOR: a linha importada que já virou lançamento não deve chegar na
  // tela. Antes isso era filtrado só no cliente — mandava 523 linhas a mais pro
  // browser e, quando escapava, a pessoa editava a versão "Conta Azul" (que abre com
  // anexos vazios) achando que era o lançamento, e concluía que o anexo não salvou.
  const promovidos = new Set(
    lancamentos.filter(l => l.origem_tipo === 'conta_azul' && l.origem_ref).map(l => l.origem_ref as string),
  )
  const importadas = importadasRaw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => !isIgnorado(e.situacao))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => !e.import_ref || !promovidos.has(e.import_ref as string))
    .map(e => extratoToLancamento(e, contaIdByName))

  return (
    <LancamentosClient
      orgSlug={orgSlug}
      lancamentos={lancamentos}
      importadas={importadas}
      contas={contas}
      categorias={categorias}
      centros={centros}
      today={today}
    />
  )
}
