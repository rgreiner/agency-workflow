'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { assertFinanceAccess } from '@/lib/finance'
import { certificadoParaUso, certificadoPublico } from '@/lib/fiscal/certificado'
import { chamarNfse } from '@/lib/fiscal/nfse-conexao'
import { montarDps, assinarDps, assinarXml, chavesDoPfx, empacotar, desempacotar } from '@/lib/fiscal/dps'
import { montarCancelamento, MOTIVO_MIN } from '@/lib/fiscal/evento'
import { logSystemError } from '@/lib/system-error'
import { chaveNome } from '@/lib/nomes'

/**
 * Emissão de NFS-e pelo Emissor Nacional, a partir de um lançamento a receber.
 *
 * O lançamento não é tocado: a nota pendura nele (mig. 313). Emissão é ato
 * público com prazo curto para cancelar, então aqui é UMA por vez, com o
 * ambiente vindo do certificado (nasce em produção restrita).
 */

export interface NotaDoLancamento {
  id: string
  chave: string
  numero: string | null
  serie: string | null
  status: 'autorizada' | 'cancelada'
  ambiente: 'restrita' | 'producao'
  valor: number | null
  emitidoEm: string
  /** Preenchido quando esta nota foi cancelada POR substituição. */
  substituidaPor?: string | null
  motivoCancelamento?: string | null
}

/** Cliente que pode ser tomador: só entra na lista quem tem CNPJ no cadastro. */
export interface ClienteTomador {
  id: string
  nome: string
  razao: string | null
  cnpj: string
}

export interface ConfigNfse {
  serie: string
  proximoNumero: number
  codMunicipio: string | null
  codigoServico: string | null
  percSimples: number | null
  tribIssqn: number
  tpRetIssqn: number
  descricaoPadrao: string | null
}

async function cfgDaOrg(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string): Promise<ConfigNfse | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('org_nfse_config').select('*').eq('org_id', orgId).maybeSingle()
  if (!data) return null
  return {
    serie: data.serie ?? '00001',
    proximoNumero: Number(data.proximo_numero ?? 1),
    codMunicipio: data.cod_municipio ?? null,
    codigoServico: data.codigo_servico ?? null,
    percSimples: data.perc_simples != null ? Number(data.perc_simples) : null,
    tribIssqn: Number(data.trib_issqn ?? 1),
    tpRetIssqn: Number(data.tp_ret_issqn ?? 1),
    descricaoPadrao: data.descricao_padrao ?? null,
  }
}

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
    descricao_padrao: dados.descricaoPadrao ?? null,
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
    if (atual && atual.status === 'autorizada' && n.status !== 'autorizada') continue
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
 * Clientes que servem de tomador. Sem CNPJ no cadastro não há nota, então quem
 * não tem fica de fora da lista em vez de aparecer e falhar no envio.
 */
export async function clientesParaNota(orgSlug: string): Promise<ClienteTomador[]> {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('workspaces')
    .select('id, name, legal_name, tax_id')
    .eq('org_id', orgId).eq('archived', false).order('name')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .map(w => ({ id: w.id, nome: w.name, razao: w.legal_name ?? null, cnpj: String(w.tax_id ?? '').replace(/\D/g, '') }))
    .filter(c => c.cnpj.length === 14)
}

/** O XML autorizado, para baixar/arquivar. */
export async function xmlDaNota(orgSlug: string, notaId: string): Promise<{ xml?: string; error?: string }> {
  const { supabase } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('nota_fiscal').select('xml_gz_b64').eq('id', notaId).maybeSingle()
  if (!data?.xml_gz_b64) return { error: 'XML não guardado para esta nota.' }
  try { return { xml: desempacotar(data.xml_gz_b64) } } catch { return { error: 'XML ilegível.' } }
}

interface RespostaOk { tipoAmbiente?: number; chaveAcesso?: string; nfseXmlGZipB64?: string; idDps?: string }
interface RespostaErro { erros?: { Codigo?: string; Descricao?: string; Complemento?: string }[] }

/** Junta os erros da Receita numa frase que a pessoa consegue agir. */
function mensagemDaReceita(corpo: string): string {
  try {
    const j = JSON.parse(corpo) as RespostaErro & { erro?: { codigo?: string; descricao?: string } }
    const lista = j.erros ?? (j.erro ? [{ Codigo: j.erro.codigo, Descricao: j.erro.descricao }] : [])
    if (lista.length === 0) return 'A Receita recusou a nota sem detalhar o motivo.'
    return lista.map(e => `${e.Descricao ?? ''}${e.Complemento ? ` (${e.Complemento})` : ''}`.trim() || e.Codigo).join(' · ')
  } catch {
    return 'A Receita recusou a nota.'
  }
}

export interface DadosParaEmitir {
  valor: number
  descricao: string
  /** Cliente já vinculado ao lançamento. */
  tomador: ClienteTomador | null
  /** Palpite por nome quando não há vínculo — a pessoa confirma, o Flow não decide. */
  sugestao: ClienteTomador | null
  clientes: ClienteTomador[]
  /** NF da agência já anexada ao lançamento (emitida fora do Flow). */
  nfAnexada: { numero: string; nome: string } | null
  ambiente: 'restrita' | 'producao'
}

/**
 * Tudo que o diálogo de emissão precisa, numa chamada só.
 *
 * O tomador é a parte delicada: a maioria dos lançamentos a receber veio do
 * import e não tem cliente vinculado, mas quase todos trazem o nome do cliente
 * no centro de custo. O Flow SUGERE a partir desse nome e deixa a confirmação
 * com a pessoa — tomador errado numa nota fiscal só se conserta cancelando.
 */
export async function dadosParaEmitir(orgSlug: string, lancamentoId: string): Promise<{ dados?: DadosParaEmitir; error?: string }> {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [{ data: lanc }, clientes, cert] = await Promise.all([
    sb.from('lancamentos')
      .select('valor, valor_realizado, descricao, workspace_id, centro_custo, contato_nome, anexos')
      .eq('id', lancamentoId).maybeSingle(),
    clientesParaNota(orgSlug),
    certificadoPublico(orgId),
  ])
  if (!lanc) return { error: 'Lançamento não encontrado.' }

  const tomador = lanc.workspace_id ? clientes.find(c => c.id === lanc.workspace_id) ?? null : null
  // Casa pela mesma régua do cubo (sem caixa, sem acento): "É o Amor" do cadastro
  // e "É O Amor" do import são o mesmo cliente.
  const porChave = new Map(clientes.map(c => [chaveNome(c.nome), c]))
  const sugestao = tomador ? null
    : porChave.get(chaveNome(lanc.centro_custo ?? '')) ?? porChave.get(chaveNome(lanc.contato_nome ?? '')) ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anexo = ((lanc.anexos ?? []) as any[]).find(a => a?.tipo === 'NF' && a?.emitente === 'agencia')

  return {
    dados: {
      valor: Number(lanc.valor_realizado ?? lanc.valor) || 0,
      descricao: lanc.descricao ?? '',
      tomador,
      sugestao,
      clientes,
      nfAnexada: anexo ? { numero: String(anexo.numero ?? ''), nome: String(anexo.nome ?? '') } : null,
      ambiente: cert?.ambiente ?? 'restrita',
    },
  }
}

export interface OpcoesEmissao {
  /**
   * Cliente escolhido na hora de emitir. Existe porque 152 dos 293 lançamentos
   * a receber vieram do import e não têm vínculo com cliente — e sem tomador não
   * há nota. Escolhido aqui, o vínculo FICA no lançamento: a próxima emissão não
   * pergunta de novo.
   */
  workspaceId?: string
  /** A pessoa viu que o lançamento já tem NF anexada e quer emitir assim mesmo. */
  confirmarNfAnexada?: boolean
  /**
   * Substituição: esta nota entra no lugar daquela. A Receita cancela a antiga
   * sozinha ao autorizar esta (evento e105102) — por isso aqui não se manda
   * cancelamento junto.
   */
  substituir?: { notaId: string; cMotivo: string; xMotivo: string }
}

export async function emitirNota(
  orgSlug: string,
  lancamentoId: string,
  opcoes: OpcoesEmissao = {},
): Promise<{ nota?: NotaDoLancamento; error?: string }> {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const cert = await certificadoParaUso(orgId)
  if (!cert) return { error: 'Nenhum certificado digital cadastrado (Configurações → Nota fiscal).' }

  const info = await certificadoPublico(orgId)
  const cnpjPrestador = String(info?.cnpj ?? '').replace(/\D/g, '')
  if (cnpjPrestador.length !== 14) {
    return { error: 'Não foi possível ler o CNPJ do certificado. Reenvie o arquivo em Configurações → Nota fiscal.' }
  }

  const cfg = await cfgDaOrg(supabase, orgId)
  if (!cfg) return { error: 'Configure a nota fiscal antes de emitir (Configurações → Nota fiscal).' }
  const faltando = [
    !cfg.codMunicipio && 'município de emissão',
    !cfg.codigoServico && 'código do serviço',
    cfg.percSimples == null && 'percentual do Simples',
  ].filter(Boolean)
  // Valor fiscal errado só se conserta cancelando a nota: melhor recusar aqui.
  if (faltando.length) return { error: `Falta configurar: ${faltando.join(', ')} (Configurações → Nota fiscal).` }

  const { data: lanc } = await sb.from('lancamentos')
    .select('id, tipo, valor, valor_realizado, descricao, competencia, vencimento, workspace_id, contato_nome, anexos')
    .eq('id', lancamentoId).maybeSingle()
  if (!lanc) return { error: 'Lançamento não encontrado.' }
  if (lanc.tipo !== 'entrada') return { error: 'Nota fiscal sai de lançamento a receber, não de despesa.' }

  // Substituindo, a nota antiga continua pendurada no lançamento — é esperado ter
  // duas. Fora disso, uma autorizada já basta.
  const { data: jaTem } = await sb.from('nota_fiscal')
    .select('id').eq('lancamento_id', lancamentoId).eq('status', 'autorizada').maybeSingle()
  if (jaTem && jaTem.id !== opcoes.substituir?.notaId) {
    return { error: 'Este lançamento já tem nota emitida.' }
  }

  // NF já emitida FORA do Flow (pela prefeitura, no sistema antigo) chega como
  // anexo com emitente "agência". Emitir por cima disso gera nota em duplicidade
  // — que só se desfaz cancelando. Avisa e exige confirmação.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nfAnexada = ((lanc.anexos ?? []) as any[])
    .find(a => a?.tipo === 'NF' && a?.emitente === 'agencia')
  if (nfAnexada && !opcoes.confirmarNfAnexada && !opcoes.substituir) {
    return { error: `Este lançamento já tem a ${nfAnexada.numero ? `NF ${nfAnexada.numero}` : 'NF'} da agência anexada, emitida fora do Flow. Confirme que quer emitir outra.` }
  }

  const workspaceId = opcoes.workspaceId || lanc.workspace_id
  if (!workspaceId) return { error: 'O lançamento não está vinculado a um cliente — sem tomador não há nota.' }
  const { data: cli } = await sb.from('workspaces').select('legal_name, name, tax_id').eq('id', workspaceId).maybeSingle()
  if (!cli) return { error: 'Cliente não encontrado.' }
  const cnpjTomador = String(cli.tax_id ?? '').replace(/\D/g, '')
  if (cnpjTomador.length !== 14) return { error: `Cliente ${cli.name ?? ''} sem CNPJ completo no cadastro.` }

  const valor = Number(lanc.valor_realizado ?? lanc.valor) || 0
  if (valor <= 0) return { error: 'Lançamento sem valor.' }

  // A nota a ser substituída precisa existir, ser desta org e estar valendo.
  let substituida: { id: string; chave: string } | null = null
  if (opcoes.substituir) {
    const { data: velha } = await sb.from('nota_fiscal')
      .select('id, chave, status').eq('id', opcoes.substituir.notaId).maybeSingle()
    if (!velha) return { error: 'Nota a substituir não encontrada.' }
    if (velha.status !== 'autorizada') return { error: 'Esta nota já não está valendo — não há o que substituir.' }
    if ((opcoes.substituir.xMotivo ?? '').trim().length < MOTIVO_MIN) {
      return { error: `O motivo da substituição precisa de pelo menos ${MOTIVO_MIN} caracteres (exigência da Receita).` }
    }
    substituida = { id: velha.id, chave: velha.chave }
  }

  // Número só é consumido depois de tudo validado: número queimado é buraco na
  // sequência fiscal, e a Receita cobra explicação por buraco. O contador é POR
  // AMBIENTE (mig. 316) — nota de teste não gasta número da sequência oficial.
  const { data: numero, error: eNum } = await sb.rpc('proximo_numero_nfse', {
    p_user_id: user.id, p_org_id: orgId, p_ambiente: cert.ambiente,
  })
  if (eNum) return { error: eNum.message }

  try {
    const { xml, id } = montarDps({
      cnpjPrestador: cnpjPrestador,
      cnpjTomador,
      nomeTomador: cli.legal_name || cli.name || lanc.contato_nome || 'Tomador',
      codMunicipio: cfg.codMunicipio!,
      serie: cfg.serie,
      numero: Number(numero),
      valor,
      descricao: lanc.descricao || cfg.descricaoPadrao || 'Prestação de serviços de publicidade',
      codigoServico: cfg.codigoServico!,
      percSimples: cfg.percSimples!,
      tribIssqn: cfg.tribIssqn,
      tpRetIssqn: cfg.tpRetIssqn,
      ambiente: cert.ambiente === 'producao' ? 1 : 2,
      competencia: (lanc.competencia || lanc.vencimento || undefined) as string | undefined,
      subst: substituida
        ? { chave: substituida.chave, cMotivo: opcoes.substituir!.cMotivo, xMotivo: opcoes.substituir!.xMotivo.trim() }
        : undefined,
    })

    const { key, certB64 } = await chavesDoPfx(cert.pfx, cert.senha)
    const assinado = assinarDps(xml, id, key, certB64)

    const r = await chamarNfse(orgId, {
      caminho: '/sefinnacional/nfse',
      metodo: 'POST',
      corpo: JSON.stringify({ dpsXmlGZipB64: empacotar(assinado) }),
      timeoutMs: 60_000,
    })
    if ('erro' in r) return { error: 'Certificado indisponível.' }
    if (r.erroRede) return { error: `Não foi possível falar com a Receita (${r.erroRede}).` }
    // 201 é o único que emite; qualquer outro devolve o motivo em português.
    if (r.status !== 201) return { error: mensagemDaReceita(r.corpo) }

    const resp = JSON.parse(r.corpo) as RespostaOk
    if (!resp.chaveAcesso) return { error: 'A Receita respondeu sem a chave de acesso.' }

    // Número da nota vem do XML autorizado (nNFSe); a Receita numera a NFS-e.
    let numeroNfse: string | null = null
    try {
      const xmlNota = resp.nfseXmlGZipB64 ? desempacotar(resp.nfseXmlGZipB64) : ''
      numeroNfse = (/<nNFSe>([^<]*)<\/nNFSe>/.exec(xmlNota) || [])[1] ?? null
    } catch { /* sem o número a nota ainda vale: a chave é a identidade */ }

    const { data: nova, error: eIns } = await sb.from('nota_fiscal').insert({
      org_id: orgId,
      lancamento_id: lancamentoId,
      ambiente: cert.ambiente,
      status: 'autorizada',
      chave: resp.chaveAcesso,
      numero: numeroNfse,
      serie: cfg.serie,
      n_dps: Number(numero),
      valor,
      competencia: lanc.competencia || lanc.vencimento || null,
      tomador_nome: cli.legal_name || cli.name || null,
      tomador_cnpj: cnpjTomador,
      xml_gz_b64: resp.nfseXmlGZipB64 ?? null,
      dps_gz_b64: empacotar(assinado),
      substitui_chave: substituida?.chave ?? null,
      emitido_por: user.id,
    }).select('id, chave, numero, serie, status, ambiente, valor, emitido_em').single()
    if (eIns) return { error: `Nota emitida na Receita, mas falhou ao gravar no Flow: ${eIns.message}. Chave ${resp.chaveAcesso}` }

    // A antiga já foi cancelada pela Receita no ato da autorização desta. Aqui só
    // se registra o fato — e com a chave da substituta, que é o que responde
    // "cadê a nota boa?" seis meses depois.
    if (substituida) {
      await sb.from('nota_fiscal').update({
        status: 'cancelada',
        cancelado_em: new Date().toISOString(),
        cancel_cod: opcoes.substituir!.cMotivo,
        cancel_motivo: opcoes.substituir!.xMotivo.trim(),
        substituida_por: resp.chaveAcesso,
      }).eq('id', substituida.id)
    }

    // O vínculo com o cliente fica gravado: escolher o tomador uma vez resolve
    // esse lançamento para sempre, e alimenta centro de custo e margem.
    const patch: Record<string, unknown> = { nf_emitida: true }
    if (!lanc.workspace_id && opcoes.workspaceId) patch.workspace_id = opcoes.workspaceId
    await sb.from('lancamentos').update(patch).eq('id', lancamentoId)
    revalidatePath(`/${orgSlug}/financeiro/lancamentos`)

    return {
      nota: {
        id: nova.id, chave: nova.chave, numero: nova.numero, serie: nova.serie,
        status: nova.status, ambiente: nova.ambiente,
        valor: nova.valor != null ? Number(nova.valor) : null,
        emitidoEm: nova.emitido_em,
      },
    }
  } catch (error) {
    try { await logSystemError(supabase, { userId: user.id, context: 'fiscal:nfse', error }) } catch { /* best-effort */ }
    return { error: 'Falha ao emitir a nota. O time técnico foi avisado.' }
  }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const texto = (motivo.xMotivo ?? '').trim()
  if (texto.length < MOTIVO_MIN) {
    return { error: `O motivo precisa de pelo menos ${MOTIVO_MIN} caracteres — a Receita recusa textos curtos.` }
  }

  const { data: nota } = await sb.from('nota_fiscal')
    .select('id, chave, status, ambiente, lancamento_id').eq('id', notaId).maybeSingle()
  if (!nota) return { error: 'Nota não encontrada.' }
  if (nota.status !== 'autorizada') return { error: 'Esta nota já está cancelada.' }

  const cert = await certificadoParaUso(orgId)
  if (!cert) return { error: 'Nenhum certificado digital cadastrado.' }
  if (cert.ambiente !== nota.ambiente) {
    return { error: `A nota foi emitida em ${nota.ambiente === 'producao' ? 'produção' : 'produção restrita'} e o certificado está apontando para o outro ambiente. Troque o ambiente antes de cancelar.` }
  }
  const info = await certificadoPublico(orgId)
  const cnpjAutor = String(info?.cnpj ?? '').replace(/\D/g, '')
  if (cnpjAutor.length !== 14) return { error: 'Não foi possível ler o CNPJ do certificado.' }

  try {
    const { xml, id } = montarCancelamento({
      chave: nota.chave,
      cnpjAutor,
      ambiente: cert.ambiente === 'producao' ? 1 : 2,
      cMotivo: motivo.cMotivo,
      xMotivo: texto,
    })
    const { key, certB64 } = await chavesDoPfx(cert.pfx, cert.senha)
    const assinado = assinarXml(xml, { interna: 'infPedReg', raiz: 'pedRegEvento', id, key, certB64 })

    const r = await chamarNfse(orgId, {
      caminho: `/sefinnacional/nfse/${nota.chave}/eventos`,
      metodo: 'POST',
      corpo: JSON.stringify({ pedidoRegistroEventoXmlGZipB64: empacotar(assinado) }),
      timeoutMs: 60_000,
    })
    if ('erro' in r) return { error: 'Certificado indisponível.' }
    if (r.erroRede) return { error: `Não foi possível falar com a Receita (${r.erroRede}).` }
    if (r.status !== 200 && r.status !== 201) return { error: mensagemDaReceita(r.corpo) }

    await sb.from('nota_fiscal').update({
      status: 'cancelada',
      cancelado_em: new Date().toISOString(),
      cancel_cod: motivo.cMotivo,
      cancel_motivo: texto,
      evento_gz_b64: empacotar(assinado),
    }).eq('id', notaId)

    // O lançamento volta a não ter nota — a não ser que outra, válida, já esteja
    // pendurada nele.
    if (nota.lancamento_id) {
      const { data: outra } = await sb.from('nota_fiscal')
        .select('id').eq('lancamento_id', nota.lancamento_id).eq('status', 'autorizada').maybeSingle()
      if (!outra) await sb.from('lancamentos').update({ nf_emitida: false }).eq('id', nota.lancamento_id)
    }
    revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
    return { ok: true }
  } catch (error) {
    try { await logSystemError(supabase, { userId: user.id, context: 'fiscal:nfse-cancelamento', error }) } catch { /* best-effort */ }
    return { error: 'Falha ao cancelar a nota. O time técnico foi avisado.' }
  }
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

const tag = (xml: string, t: string): string => {
  const m = new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml)
  return m ? m[1].trim() : ''
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
