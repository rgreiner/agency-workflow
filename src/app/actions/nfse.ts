'use server'

import { revalidatePath } from 'next/cache'
import { getUsuario } from '@/lib/auth/server'
import { assertFinanceAccess } from '@/lib/finance'
import { certificadoPublico } from '@/lib/fiscal/certificado'
import { desempacotar } from '@/lib/fiscal/dps'
import { cancelarNotaNaReceita } from '@/lib/fiscal/cancelamento'
import { chaveNome } from '@/lib/nomes'
import { type TipoTomador, type Tomador } from '@/lib/fiscal/tomador'
import { cfgDaOrg, emitirNotaComo, type ConfigNfse, type NotaDoLancamento, type OpcoesEmissao } from '@/lib/fiscal/emitir'

/**
 * Emissão de NFS-e pelo Emissor Nacional, a partir de um lançamento a receber.
 *
 * O lançamento não é tocado: a nota pendura nele (mig. 313). Emissão é ato
 * público com prazo curto para cancelar, então aqui é UMA por vez, com o
 * ambiente vindo do certificado (nasce em produção restrita).
 */

export type { NotaDoLancamento } from '@/lib/fiscal/emitir'

export type { TipoTomador, Tomador } from '@/lib/fiscal/tomador'

export type { ConfigNfse, OpcoesEmissao } from '@/lib/fiscal/emitir'

export async function lerConfigNfse(orgSlug: string): Promise<{ cfg: ConfigNfse | null }> {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  return { cfg: await cfgDaOrg(supabase, orgId) }
}

export async function salvarConfigNfse(orgSlug: string, dados: Partial<ConfigNfse>) {
  const { supabase, orgId, userId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('org_nfse_config').upsert({
    org_id: orgId,
    serie: dados.serie ?? '00001',
    proximo_numero: dados.proximoNumero ?? 1,
    cod_municipio: dados.codMunicipio ?? null,
    codigo_servico: dados.codigoServico ?? null,
    perc_simples: dados.percSimples ?? null,
    trib_issqn: dados.tribIssqn ?? 1,
    tp_ret_issqn: dados.tpRetIssqn ?? 1,
    aliq_issqn: dados.aliqIssqn ?? null,
    descricao_padrao: dados.descricaoPadrao ?? null,
    cod_nbs: dados.codNbs ?? null,
    ibs_cbs_ativo: dados.ibsCbsAtivo ?? false,
    ibs_cbs_cind_op: dados.ibsCbsCIndOp ?? null,
    ibs_cbs_cst: dados.ibsCbsCst ?? null,
    ibs_cbs_classtrib: dados.ibsCbsClassTrib ?? null,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  }, { onConflict: 'org_id' })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/settings/fiscal`)
  return {}
}

/**
 * Notas dos lançamentos listados — alimenta a coluna NF da tabela.
 *
 * Traz a CANCELADA também. Filtrar por 'autorizada' fazia a nota cancelada
 * sumir da linha, e o lançamento voltava a parecer "sem nota" — convite a emitir
 * a segunda sem saber da primeira. Quando há as duas, a autorizada manda.
 */
export async function notasDosLancamentos(orgSlug: string, ids: string[]): Promise<Record<string, NotaDoLancamento>> {
  if (ids.length === 0) return {}
  const { supabase } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('nota_fiscal')
    .select('id, lancamento_id, chave, numero, serie, status, ambiente, valor, emitido_em, substituida_por, cancel_motivo')
    .in('lancamento_id', ids.slice(0, 500))
    .order('emitido_em', { ascending: true })
  const mapa: Record<string, NotaDoLancamento> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const n of (data ?? []) as any[]) {
    if (!n.lancamento_id) continue
    const atual = mapa[n.lancamento_id]
    // Autorizada manda sobre pendente e cancelada; pendente manda sobre cancelada.
    const peso = (st: string) => (st === 'autorizada' ? 2 : st === 'pendente' ? 1 : 0)
    if (atual && peso(atual.status) > peso(n.status)) continue
    mapa[n.lancamento_id] = {
      id: n.id, chave: n.chave, numero: n.numero, serie: n.serie,
      status: n.status, ambiente: n.ambiente,
      valor: n.valor != null ? Number(n.valor) : null,
      emitidoEm: n.emitido_em,
      substituidaPor: n.substituida_por ?? null,
      motivoCancelamento: n.cancel_motivo ?? null,
    }
  }
  return mapa
}

/**
 * Todos os cadastros que podem receber nota: clientes, fornecedores e veículos.
 *
 * Sem CNPJ completo o cadastro fica de fora da lista, em vez de aparecer e
 * falhar no envio. Hoje são 14 clientes, 152 veículos e 259 fornecedores com
 * CNPJ — por isso o Select entra em modo de busca sozinho.
 */
export async function tomadoresParaNota(orgSlug: string): Promise<Tomador[]> {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [cli, veic, forn] = await Promise.all([
    sb.from('workspaces').select('id, name, legal_name, tax_id').eq('org_id', orgId).eq('archived', false),
    // `legal_name` nos três: quando esta lista foi escrita, só `workspaces`
    // tinha a coluna (ela chegou a fornecedor e veículo na mig. 320) e o select
    // não foi atualizado junto. O resultado era a tela acusar "cadastro sem
    // razão social" para quem tinha — alarme falso numa tela de conferência.
    sb.from('veiculos').select('id, name, legal_name, tax_id').eq('org_id', orgId).eq('archived', false),
    sb.from('fornecedores').select('id, name, legal_name, tax_id').eq('org_id', orgId).eq('archived', false),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monta = (linhas: any[] | null, tipo: TipoTomador): Tomador[] =>
    (linhas ?? []).map(r => ({
      tipo, id: r.id as string, nome: r.name as string, razao: (r.legal_name ?? null) as string | null,
      cnpj: String(r.tax_id ?? '').replace(/\D/g, ''),
    })).filter(t => t.cnpj.length === 14)

  // Cliente antes de veículo, veículo antes de fornecedor: é a ordem em que o
  // nome repetido deve ser resolvido, e também a que a lista exibe.
  return [
    ...monta(cli.data, 'cliente'),
    ...monta(veic.data, 'veiculo'),
    ...monta(forn.data, 'fornecedor'),
  ]
}

/** O XML autorizado, para baixar/arquivar. */
export async function xmlDaNota(orgSlug: string, notaId: string): Promise<{ xml?: string; error?: string }> {
  const { supabase } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('nota_fiscal').select('xml_gz_b64').eq('id', notaId).maybeSingle()
  if (!data?.xml_gz_b64) return { error: 'XML não guardado para esta nota.' }
  try { return { xml: desempacotar(data.xml_gz_b64) } } catch { return { error: 'XML ilegível.' } }
}

export interface DadosParaEmitir {
  valor: number
  /** O que está escrito no lançamento — rótulo do financeiro, não do cliente. */
  descricao: string
  /** Sugestão para a nota, que a pessoa confirma ou reescreve antes de emitir. */
  descricaoSugerida: string
  /**
   * Competência que a nota vai levar (AAAA-MM-DD). É a do lançamento, caindo
   * para o vencimento — a mesma regra que a emissão usa, para a tela não
   * mostrar uma data e a nota sair com outra.
   */
  competencia: string
  /** Tomador já vinculado ao lançamento (só existe no caso cliente). */
  tomador: Tomador | null
  /** Palpite por nome quando não há vínculo — a pessoa confirma, o Flow não decide. */
  sugestao: Tomador | null
  tomadores: Tomador[]
  /** NF da agência já anexada ao lançamento (emitida fora do Flow). */
  nfAnexada: { numero: string; nome: string } | null
  ambiente: 'restrita' | 'producao'
}

/**
 * Tudo que o diálogo de emissão precisa, numa chamada só.
 *
 * O tomador é a parte delicada: a maioria dos lançamentos a receber veio do
 * import sem vínculo, e quem recebe a nota pode ser cliente, veículo ou
 * fornecedor. O Flow SUGERE e deixa a confirmação com a pessoa — tomador errado
 * numa nota fiscal só se conserta cancelando.
 *
 * ⚠️ A sugestão olha o CONTATO antes do centro de custo. Centro de custo é
 * fonte de receita: numa comissão de mídia ele guarda o CLIENTE que originou o
 * dinheiro, enquanto a nota vai para o VEÍCULO. Olhar o centro primeiro
 * sugeriria o tomador errado em toda comissão — que é a maioria das notas.
 */
export async function dadosParaEmitir(orgSlug: string, lancamentoId: string): Promise<{ dados?: DadosParaEmitir; error?: string }> {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [{ data: lanc }, { data: doc }, tomadores, cert, cfg] = await Promise.all([
    sb.from('lancamentos')
      .select('valor, valor_realizado, descricao, competencia, vencimento, workspace_id, contato_tipo, contato_id, centro_custo, contato_nome, anexos')
      .eq('id', lancamentoId).maybeSingle(),
    // O documento de origem vem da view; é dele que sai a descrição boa.
    sb.from('lancamentos_doc').select('doc_serie, doc_numero').eq('id', lancamentoId).maybeSingle(),
    tomadoresParaNota(orgSlug),
    certificadoPublico(orgId),
    cfgDaOrg(supabase, orgId),
  ])
  if (!lanc) return { error: 'Lançamento não encontrado.' }

  // O vínculo do contato manda: ele veio do documento que gerou o lançamento
  // (mig. 322) e não depende de grafia. Só na falta dele é que se procura o
  // cliente do lançamento e, por último, se adivinha pelo nome.
  const tomador =
    (lanc.contato_id && lanc.contato_tipo
      ? tomadores.find(t => t.tipo === lanc.contato_tipo && t.id === lanc.contato_id)
      : null)
    ?? (lanc.workspace_id
      ? tomadores.find(t => t.tipo === 'cliente' && t.id === lanc.workspace_id)
      : null)
    ?? null

  // Casa pela mesma régua do cubo (sem caixa, sem acento): "É o Amor" do cadastro
  // e "É O Amor" do import são o mesmo nome. Homônimo entre cadastros resolve
  // pela ordem da lista — cliente ganha de veículo, que ganha de fornecedor.
  const porChave = new Map<string, Tomador>()
  for (const t of tomadores) {
    const k = chaveNome(t.nome)
    if (!porChave.has(k)) porChave.set(k, t)
  }
  const sugestao = tomador ? null
    : porChave.get(chaveNome(lanc.contato_nome ?? '')) ?? porChave.get(chaveNome(lanc.centro_custo ?? '')) ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anexo = ((lanc.anexos ?? []) as any[]).find(a => a?.tipo === 'NF' && a?.emitente === 'agencia')

  /**
   * Descrição do SERVIÇO na nota — não é a descrição do lançamento.
   *
   * O financeiro escreve rótulo interno: "Venda", "Comissão", "Rendimento",
   * "Desconto Padrão Agência". Isso foi parar numa nota de verdade. As notas que
   * a prefeitura emitia usavam "PP 1914 | Comil" — documento e cliente —, que é
   * o que o tomador reconhece quando recebe.
   *
   * Por isso aqui é SUGESTÃO: quem confirma é a pessoa, no diálogo, antes de
   * disparar. Descrição errada em nota emitida só se conserta cancelando.
   */
  const docRef = doc?.doc_serie && doc?.doc_numero ? `${doc.doc_serie} ${doc.doc_numero}` : ''
  const quem = sugestao?.nome ?? tomador?.nome ?? lanc.contato_nome ?? ''
  const descricaoSugerida =
    (docRef && quem ? `${docRef} | ${quem}` : docRef)
    || cfg?.descricaoPadrao
    || lanc.descricao
    || ''

  return {
    dados: {
      valor: Number(lanc.valor_realizado ?? lanc.valor) || 0,
      descricao: lanc.descricao ?? '',
      descricaoSugerida,
      competencia: String(lanc.competencia || lanc.vencimento || ''),
      tomador,
      sugestao,
      tomadores,
      nfAnexada: anexo ? { numero: String(anexo.numero ?? ''), nome: String(anexo.nome ?? '') } : null,
      ambiente: cert?.ambiente ?? 'restrita',
    },
  }
}

export async function emitirNota(
  orgSlug: string,
  lancamentoId: string,
  opcoes: OpcoesEmissao = {},
): Promise<{ nota?: NotaDoLancamento; error?: string }> {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  return emitirNotaComo({ supabase, orgId, userId: user.id, orgSlug }, lancamentoId, opcoes)
}

/**
 * Cancelamento da NFS-e (evento e101101).
 *
 * É o conserto de uma nota que não devia existir. Quando a nota devia existir
 * com OUTRO conteúdo, o caminho é substituir — ver `emitirNota` com `substituir`.
 */
export async function cancelarNota(
  orgSlug: string,
  notaId: string,
  motivo: { cMotivo: string; xMotivo: string },
): Promise<{ ok?: true; error?: string }> {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const r = await cancelarNotaNaReceita(supabase, orgId, user.id, notaId, motivo)
  if (r.error) return { error: r.error }
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  return { ok: true }
}

export interface LinhaConferencia {
  campo: string
  /** O que o Flow pediu (DPS). */
  pedido: string
  /** O que a Receita registrou (NFS-e autorizada). */
  registrado: string
  /** false = pedido e registrado divergem; null = não dá para comparar. */
  bate: boolean | null
  /** Explica o que a divergência significa. */
  nota?: string
}

// Mesma régua do DANFSe: o XML guarda `&amp;`, e comparar sem desfazer faria a
// conferência acusar divergência entre o que mandamos e o que voltou — idêntico.
const desescapa = (t: string) => t
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')

const tag = (xml: string, t: string): string => {
  const m = new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml)
  return m ? desescapa(m[1].trim()) : ''
}
const dinheiro = (v: string) => (v ? Number(v).toFixed(2) : '')

/**
 * Conferência da nota campo a campo: o que o Flow PEDIU × o que a Receita
 * REGISTROU. Divergência entre os dois é bug do gerador — e numa nota fiscal
 * "deu 201" não é prova de que saiu certo, só de que foi aceita.
 */
export async function conferirNota(orgSlug: string, notaId: string): Promise<{ linhas?: LinhaConferencia[]; error?: string }> {
  const { supabase } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('nota_fiscal')
    .select('chave, numero, serie, valor, tomador_cnpj, tomador_nome, xml_gz_b64, dps_gz_b64, ambiente')
    .eq('id', notaId).maybeSingle()
  if (!data) return { error: 'Nota não encontrada.' }

  let nfse = '', dps = ''
  try { nfse = data.xml_gz_b64 ? desempacotar(data.xml_gz_b64) : '' } catch { /* segue sem */ }
  try { dps = data.dps_gz_b64 ? desempacotar(data.dps_gz_b64) : '' } catch { /* segue sem */ }
  if (!nfse) return { error: 'O XML autorizado não foi guardado para esta nota.' }

  // O XML da NFS-e repete tags do prestador e do tomador; o recorte evita
  // comparar o CNPJ do tomador com o do prestador e dizer que "não bate".
  const trecho = (xml: string, abre: string) => {
    const i = xml.indexOf(`<${abre}>`)
    if (i < 0) return ''
    const f = xml.indexOf(`</${abre}>`, i)
    return f < 0 ? '' : xml.slice(i, f)
  }
  const dpsToma = trecho(dps, 'toma'), nfseToma = trecho(nfse, 'toma')
  const dpsServ = trecho(dps, 'serv'), nfseServ = trecho(nfse, 'serv')

  const linha = (campo: string, pedido: string, registrado: string, nota?: string): LinhaConferencia => ({
    campo, pedido, registrado,
    bate: !pedido && !registrado ? null : pedido === registrado,
    nota,
  })

  const linhas: LinhaConferencia[] = [
    linha('Chave de acesso', '', data.chave || '', 'A Receita é quem gera — não há o que comparar.'),
    linha('Número da NFS-e', '', tag(nfse, 'nNFSe'), 'Numeração é da Receita; a nossa é a da DPS.'),
    linha('Número da DPS', tag(dps, 'nDPS'), tag(nfse, 'nDPS')),
    linha('Série', tag(dps, 'serie'), tag(nfse, 'serie')),
    linha('CNPJ do tomador', tag(dpsToma, 'CNPJ'), tag(nfseToma, 'CNPJ')),
    linha('Nome do tomador', tag(dpsToma, 'xNome'), tag(nfseToma, 'xNome')),
    linha('Código do serviço', tag(dpsServ, 'cTribNac'), tag(nfseServ, 'cTribNac')),
    linha('Descrição', tag(dpsServ, 'xDescServ'), tag(nfseServ, 'xDescServ')),
    linha('Valor do serviço', dinheiro(tag(dps, 'vServ')), dinheiro(tag(nfse, 'vServ'))),
    linha('Competência', tag(dps, 'dCompet'), tag(nfse, 'dCompet')),
    linha('Município de prestação', tag(dps, 'cLocPrestacao'), tag(nfse, 'cLocPrestacao')),
    linha('Opção Simples', tag(dps, 'opSimpNac'), tag(nfse, 'opSimpNac'), '3 = ME/EPP optante.'),
    linha('% total de tributos', tag(dps, 'pTotTribSN'), tag(nfse, 'pTotTribSN')),
    linha('Ambiente', data.ambiente === 'producao' ? 'produção' : 'produção restrita',
          tag(nfse, 'tpAmb') === '1' ? 'produção' : tag(nfse, 'tpAmb') === '2' ? 'produção restrita' : '',
          'Restrita = nota de teste, sem valor fiscal.'),
  ]
  if (!dps) {
    return { linhas: linhas.map(l => ({ ...l, pedido: '', bate: null, nota: l.nota ?? 'DPS não guardada (nota emitida antes desta tela).' })) }
  }
  return { linhas }
}

/**
 * Qual lançamento recebe a nota quando a emissão parte do Faturamento.
 *
 * Na tela de Faturamento ainda NÃO existe lançamento: ele nasce no "Faturar".
 * A nota, porém, é emitida contra um lançamento (mig. 313) — então a emissão
 * que começa ali só pode acontecer DEPOIS de faturar, e precisa descobrir qual
 * das parcelas recém-criadas vai receber a nota.
 *
 * A resposta é sempre a PRIMEIRA parcela, e só ela. Um fee 12x gera 12
 * lançamentos de uma vez, cada um com a sua competência mensal — emitir as 12
 * no ato do faturamento seria emitir nota de serviço que ainda não foi
 * prestado, antecipando imposto que só se desfaz cancelando. Medido em
 * produção (02/10/2026): dos 27 documentos já faturados, 18 têm 1 parcela e
 * 3 têm 12; no fee 12x que existe hoje, exatamente 1 das 12 parcelas tem nota —
 * a do mês corrente. A régua da casa já é uma nota por competência, e esta
 * função só a repete.
 */
export async function primeiraParcelaDoDocumento(
  orgSlug: string,
  origemTipo: 'producao' | 'midia',
  origemId: string,
): Promise<{ lancamentoId?: string; parcelas?: number; competencia?: string | null; error?: string }> {
  const { supabase } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data, error } = await sb.from('lancamentos')
    .select('id, competencia, vencimento')
    .eq('origem_tipo', origemTipo)
    .eq('origem_id', origemId)
    .eq('tipo', 'entrada')
    .order('vencimento', { ascending: true })
  if (error) return { error: error.message }

  const linhas = (data ?? []) as { id: string; competencia: string | null; vencimento: string | null }[]
  if (linhas.length === 0) {
    // Documento sem comissão (o cliente paga o veículo direto) não gera
    // lançamento — e sem lançamento não há nota a emitir.
    return { error: 'Este faturamento não gerou lançamento a receber, então não há nota a emitir.' }
  }
  return { lancamentoId: linhas[0].id, parcelas: linhas.length, competencia: linhas[0].competencia }
}

/**
 * A org consegue emitir NFS-e agora? (certificado + configuração mínima)
 *
 * Serve para a tela de Faturamento decidir se mostra "e emitir NF". O botão ali
 * fatura ANTES de emitir, então descobrir que falta certificado só no diálogo
 * deixaria o documento faturado e a nota não emitida — o pior dos dois mundos.
 * Repete as guardas de `emitirNota`, que continua sendo quem recusa de verdade.
 */
export async function nfseDisponivel(orgSlug: string): Promise<boolean> {
  try {
    const { supabase, orgId } = await assertFinanceAccess(orgSlug)
    const [info, cfg] = await Promise.all([certificadoPublico(orgId), cfgDaOrg(supabase, orgId)])
    if (!info || !cfg) return false
    return !!cfg.codMunicipio && !!cfg.codigoServico && cfg.percSimples != null
  } catch {
    return false
  }
}
