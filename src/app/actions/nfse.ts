'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { assertFinanceAccess } from '@/lib/finance'
import { certificadoParaUso, certificadoPublico } from '@/lib/fiscal/certificado'
import { chamarNfse } from '@/lib/fiscal/nfse-conexao'
import { montarDps, assinarDps, chavesDoPfx, empacotar, desempacotar } from '@/lib/fiscal/dps'
import { logSystemError } from '@/lib/system-error'

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

/** Notas já emitidas dos lançamentos listados — alimenta a coluna NF da tabela. */
export async function notasDosLancamentos(orgSlug: string, ids: string[]): Promise<Record<string, NotaDoLancamento>> {
  if (ids.length === 0) return {}
  const { supabase } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('nota_fiscal')
    .select('id, lancamento_id, chave, numero, serie, status, ambiente, valor, emitido_em')
    .in('lancamento_id', ids.slice(0, 500))
    .eq('status', 'autorizada')
  const mapa: Record<string, NotaDoLancamento> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const n of (data ?? []) as any[]) {
    if (!n.lancamento_id) continue
    mapa[n.lancamento_id] = {
      id: n.id, chave: n.chave, numero: n.numero, serie: n.serie,
      status: n.status, ambiente: n.ambiente,
      valor: n.valor != null ? Number(n.valor) : null,
      emitidoEm: n.emitido_em,
    }
  }
  return mapa
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

export async function emitirNota(orgSlug: string, lancamentoId: string): Promise<{ nota?: NotaDoLancamento; error?: string }> {
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
    .select('id, tipo, valor, valor_realizado, descricao, competencia, vencimento, workspace_id, contato_nome').eq('id', lancamentoId).maybeSingle()
  if (!lanc) return { error: 'Lançamento não encontrado.' }
  if (lanc.tipo !== 'entrada') return { error: 'Nota fiscal sai de lançamento a receber, não de despesa.' }

  const { data: jaTem } = await sb.from('nota_fiscal')
    .select('id').eq('lancamento_id', lancamentoId).eq('status', 'autorizada').maybeSingle()
  if (jaTem) return { error: 'Este lançamento já tem nota emitida.' }

  if (!lanc.workspace_id) return { error: 'O lançamento não está vinculado a um cliente — sem tomador não há nota.' }
  const { data: cli } = await sb.from('workspaces').select('legal_name, name, tax_id').eq('id', lanc.workspace_id).maybeSingle()
  const cnpjTomador = String(cli?.tax_id ?? '').replace(/\D/g, '')
  if (cnpjTomador.length !== 14) return { error: `Cliente ${cli?.name ?? ''} sem CNPJ completo no cadastro.` }

  const valor = Number(lanc.valor_realizado ?? lanc.valor) || 0
  if (valor <= 0) return { error: 'Lançamento sem valor.' }

  // Número só é consumido depois de tudo validado: número queimado é buraco na
  // sequência fiscal, e a Receita cobra explicação por buraco.
  const { data: numero, error: eNum } = await sb.rpc('proximo_numero_nfse', { p_user_id: user.id, p_org_id: orgId })
  if (eNum) return { error: eNum.message }

  try {
    const { xml, id } = montarDps({
      cnpjPrestador: cnpjPrestador,
      cnpjTomador,
      nomeTomador: cli?.legal_name || cli?.name || lanc.contato_nome || 'Tomador',
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
      tomador_nome: cli?.legal_name || cli?.name || null,
      tomador_cnpj: cnpjTomador,
      xml_gz_b64: resp.nfseXmlGZipB64 ?? null,
      emitido_por: user.id,
    }).select('id, chave, numero, serie, status, ambiente, valor, emitido_em').single()
    if (eIns) return { error: `Nota emitida na Receita, mas falhou ao gravar no Flow: ${eIns.message}. Chave ${resp.chaveAcesso}` }

    // A marcação antiga de "NF emitida" passa a ter dono: quem emitiu foi o Flow.
    await sb.from('lancamentos').update({ nf_emitida: true }).eq('id', lancamentoId)
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
