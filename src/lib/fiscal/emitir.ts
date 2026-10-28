import { revalidatePath } from 'next/cache'
import type { createClient } from '@/lib/supabase/server'
import { certificadoParaUso, certificadoPublico } from '@/lib/fiscal/certificado'
import { chamarNfse } from '@/lib/fiscal/nfse-conexao'
import { montarDps, assinarDps, chavesDoPfx, empacotar, desempacotar, type DadosDps } from '@/lib/fiscal/dps'
import { MOTIVO_MIN } from '@/lib/fiscal/evento'
import { logSystemError } from '@/lib/system-error'
import { mensagemDaReceita } from '@/lib/fiscal/cancelamento'
import { buscarCep, buscarCnpj } from '@/app/actions/lookup'
import { ROTULO_TOMADOR, cnpjValido, type TipoTomador } from '@/lib/fiscal/tomador'

type Sb = Awaited<ReturnType<typeof createClient>>

interface RespostaOk { tipoAmbiente?: number; chaveAcesso?: string; nfseXmlGZipB64?: string; idDps?: string }

export interface NotaDoLancamento {
  id: string
  chave: string
  numero: string | null
  serie: string | null
  status: 'pendente' | 'autorizada' | 'cancelada'
  ambiente: 'restrita' | 'producao'
  valor: number | null
  emitidoEm: string
  /** Preenchido quando esta nota foi cancelada POR substituição. */
  substituidaPor?: string | null
  motivoCancelamento?: string | null
}

export interface ConfigNfse {
  serie: string
  proximoNumero: number
  codMunicipio: string | null
  codigoServico: string | null
  percSimples: number | null
  tribIssqn: number
  tpRetIssqn: number
  /** pAliq — vazio não informa, que é o padrão. */
  aliqIssqn: number | null
  descricaoPadrao: string | null
  /** Código NBS do serviço (9 dígitos) — campo da Reforma. */
  codNbs: string | null
  /** Liga o grupo IBS/CBS e sobe a DPS para a versão 1.01. */
  ibsCbsAtivo: boolean
  ibsCbsCIndOp: string | null
  ibsCbsCst: string | null
  ibsCbsClassTrib: string | null
}

export async function cfgDaOrg(supabase: Sb, orgId: string): Promise<ConfigNfse | null> {
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
    aliqIssqn: data.aliq_issqn != null ? Number(data.aliq_issqn) : null,
    descricaoPadrao: data.descricao_padrao ?? null,
    codNbs: data.cod_nbs ?? null,
    ibsCbsAtivo: !!data.ibs_cbs_ativo,
    ibsCbsCIndOp: data.ibs_cbs_cind_op ?? null,
    ibsCbsCst: data.ibs_cbs_cst ?? null,
    ibsCbsClassTrib: data.ibs_cbs_classtrib ?? null,
  }
}

/**
 * A nota já estava autorizada na Receita e o Flow não sabia.
 *
 * Acontece quando a resposta do envio se perde: lá a nota existe, aqui ficou
 * pendente. Adotar é buscar o XML pela chave e completar a linha que já existe —
 * nunca criar outra, senão o lançamento fica com duas notas para uma cobrança só.
 */
async function adotarNotaJaAutorizada(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any, orgId: string, linhaId: string, chave: string, lancamentoId: string, orgSlug: string,
): Promise<NotaDoLancamento | null> {
  const r = await chamarNfse(orgId, { caminho: `/sefinnacional/nfse/${chave}`, timeoutMs: 30_000 })
  if ('erro' in r || r.erroRede || r.status !== 200) return null

  let xmlGz: string | null = null
  let numeroNfse: string | null = null
  try {
    const resp = JSON.parse(r.corpo) as RespostaOk
    xmlGz = resp.nfseXmlGZipB64 ?? null
    if (xmlGz) numeroNfse = (/<nNFSe>([^<]*)<\/nNFSe>/.exec(desempacotar(xmlGz)) || [])[1] ?? null
  } catch { /* sem o número a nota ainda vale: a chave é a identidade */ }

  const { data } = await sb.from('nota_fiscal').update({
    status: 'autorizada', chave, numero: numeroNfse, xml_gz_b64: xmlGz,
  }).eq('id', linhaId).select('id, chave, numero, serie, status, ambiente, valor, emitido_em').single()
  if (!data) return null

  await sb.from('lancamentos').update({ nf_emitida: true }).eq('id', lancamentoId)
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  return {
    id: data.id, chave: data.chave, numero: data.numero, serie: data.serie,
    status: data.status, ambiente: data.ambiente,
    valor: data.valor != null ? Number(data.valor) : null,
    emitidoEm: data.emitido_em,
  }
}

export interface OpcoesEmissao {
  /**
   * Quem recebe a nota, escolhido na hora de emitir. Existe porque 152 dos 293
   * lançamentos a receber vieram do import sem vínculo — e sem tomador não há
   * nota. Pode ser cliente, veículo ou fornecedor: Fee e Job vão para o cliente,
   * comissão de mídia para o veículo e comissão de produção para o fornecedor.
   *
   * Sendo cliente, o vínculo FICA gravado no lançamento e a próxima emissão não
   * pergunta de novo. Veículo e fornecedor não têm onde ficar: `workspace_id`
   * referencia `workspaces`, e gravar ali o id de outra tabela apontaria para o
   * nada.
   */
  tomador?: { tipo: TipoTomador; id: string }
  /**
   * Descrição do serviço confirmada na tela. Sem ela a emissão cai na descrição
   * do lançamento, que é rótulo do financeiro — foi assim que "Venda" virou a
   * descrição de uma nota fiscal.
   */
  descricao?: string
  /** A pessoa viu que o lançamento já tem NF anexada e quer emitir assim mesmo. */
  confirmarNfAnexada?: boolean
  /**
   * Substituição: esta nota entra no lugar daquela. A Receita cancela a antiga
   * sozinha ao autorizar esta (evento e105102) — por isso aqui não se manda
   * cancelamento junto.
   */
  substituir?: { notaId: string; cMotivo: string; xMotivo: string }
}

/**
 * Núcleo da emissão, sem sessão: a tela (server action `emitirNota`) e a Flávia
 * (API de agentes) chamam o mesmo código — a regra fiscal não pode ter duas versões.
 * Quem chama já provou o acesso e passa o cliente do banco com o usuário dele.
 */
export async function emitirNotaComo(
  ctx: { supabase: Sb; orgId: string; userId: string; orgSlug: string },
  lancamentoId: string,
  opcoes: OpcoesEmissao = {},
): Promise<{ nota?: NotaDoLancamento; error?: string }> {
  const { supabase, orgId, orgSlug } = ctx
  const user = { id: ctx.userId }
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

  if (cfg.ibsCbsAtivo) {
    const faltaReforma = [
      !cfg.codNbs && 'código NBS',
      !cfg.ibsCbsCIndOp && 'código indicador da operação',
      !cfg.ibsCbsCst && 'CST',
      !cfg.ibsCbsClassTrib && 'classificação tributária',
    ].filter(Boolean)
    if (faltaReforma.length) {
      return { error: `IBS/CBS está ligado mas falta: ${faltaReforma.join(', ')} (Configurações → Nota fiscal).` }
    }
  }

  const { data: lanc } = await sb.from('lancamentos')
    .select('id, tipo, valor, valor_realizado, descricao, competencia, vencimento, workspace_id, contato_tipo, contato_id, contato_nome, anexos')
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

  // Quem recebe a nota: o escolhido agora ou, na falta, o cliente já vinculado.
  const escolha: { tipo: TipoTomador; id: string } | null =
    opcoes.tomador
    ?? (lanc.contato_id && lanc.contato_tipo
      ? { tipo: lanc.contato_tipo as TipoTomador, id: lanc.contato_id as string }
      : null)
    ?? (lanc.workspace_id ? { tipo: 'cliente', id: lanc.workspace_id } : null)
  if (!escolha) return { error: 'Escolha para quem a nota é emitida — sem tomador não há nota.' }

  const TABELA: Record<TipoTomador, string> = {
    cliente: 'workspaces', fornecedor: 'fornecedores', veiculo: 'veiculos',
  }
  const { data: dest } = await sb.from(TABELA[escolha.tipo])
    .select(escolha.tipo === 'cliente'
      ? 'legal_name, name, tax_id, address_zip, address_street, address_number, address_complement, address_district'
      : 'legal_name, name, tax_id, enderecos')
    .eq('id', escolha.id).maybeSingle()
  if (!dest) return { error: `${ROTULO_TOMADOR[escolha.tipo]} não encontrado.` }
  const cnpjTomador = String(dest.tax_id ?? '').replace(/\D/g, '')
  if (cnpjTomador.length !== 14) {
    return { error: `${ROTULO_TOMADOR[escolha.tipo]} ${dest.name ?? ''} sem CNPJ completo no cadastro.` }
  }
  // 14 dígitos não bastam: oito cadastros tinham CNPJ com dígito verificador
  // errado. Recusar aqui diz ONDE está o problema; recusar na Receita, não.
  if (!cnpjValido(cnpjTomador)) {
    return { error: `O CNPJ de ${dest.name ?? 'tomador'} está inválido no cadastro (dígito verificador não confere). Corrija antes de emitir.` }
  }
  /**
   * Nome do tomador na nota é a RAZÃO SOCIAL, não o apelido do cadastro.
   *
   * Cliente já guarda `legal_name`. Fornecedor e veículo passaram a guardar
   * (mig. 320) mas nascem vazios, então, faltando, busca-se na Receita pelo CNPJ
   * e GRAVA-SE no cadastro: a próxima emissão não precisa perguntar, e a
   * cobrança automática encontra o cadastro já completo.
   */
  let razaoSocial: string = String(dest.legal_name ?? '').trim()
  let dadosReceita: Awaited<ReturnType<typeof buscarCnpj>>['data'] | undefined

  /**
   * Endereço do tomador — exigido pela Receita quando há IBS/CBS (E0234).
   *
   * Vem do NOSSO cadastro, que é onde a pessoa mantém o dado: cliente guarda em
   * colunas planas (13 dos 16 preenchidos), fornecedor e veículo guardam no
   * jsonb `enderecos`. O que falta nos dois é o `cMun`, código IBGE do
   * município, que o cadastro não tem — esse vem do CEP, pelo ViaCEP.
   *
   * Sem endereço no cadastro, cai para o registro da Receita pelo CNPJ: é
   * público, tem tudo e é contra ele que a nota é validada. Falhando as duas
   * fontes, recusa dizendo o que preencher — nunca emite sem.
   */
  let enderecoTomador: DadosDps['enderecoTomador']
  if (cfg.ibsCbsAtivo) {
    const doCadastro = escolha.tipo === 'cliente'
      ? {
          cep: dest.address_zip, xLgr: dest.address_street, nro: dest.address_number,
          xCpl: dest.address_complement, xBairro: dest.address_district,
        }
      : (() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const e = ((dest.enderecos ?? []) as any[])[0]
          return e ? { cep: e.cep, xLgr: e.logradouro, nro: e.numero, xCpl: e.complemento, xBairro: e.bairro } : null
        })()

    const texto = (v: unknown) => String(v ?? '').trim()
    const completo = doCadastro
      && texto(doCadastro.xLgr) && texto(doCadastro.xBairro) && texto(doCadastro.cep).replace(/\D/g, '').length === 8

    if (completo) {
      const cepLimpo = texto(doCadastro!.cep).replace(/\D/g, '')
      const r = await buscarCep(cepLimpo)
      if (r.data?.ibge) {
        enderecoTomador = {
          cMun: r.data.ibge, cep: cepLimpo,
          xLgr: texto(doCadastro!.xLgr), nro: texto(doCadastro!.nro) || 'S/N',
          xCpl: texto(doCadastro!.xCpl) || undefined, xBairro: texto(doCadastro!.xBairro),
        }
      }
    }

    if (!enderecoTomador) {
      const r = await buscarCnpj(cnpjTomador)
      dadosReceita = r.data
      const e = r.data
      if (!e?.codigoIbge || !e.logradouro || !e.bairro || !e.cep) {
        return {
          error: `Falta o endereço de ${dest.name ?? 'tomador'} para emitir com IBS/CBS.`
            + ` Preencha no cadastro (o botão Buscar CNPJ preenche) — a consulta automática não resolveu`
            + ` (${r.error ?? 'cadastro incompleto na Receita'}).`,
        }
      }
      enderecoTomador = {
        cMun: e.codigoIbge, cep: e.cep.replace(/\D/g, ''),
        xLgr: e.logradouro, nro: e.numero || 'S/N',
        xCpl: e.complemento || undefined, xBairro: e.bairro,
      }
    }
  }

  if (!razaoSocial) {
    if (!dadosReceita) dadosReceita = (await buscarCnpj(cnpjTomador)).data
    razaoSocial = String(dadosReceita?.razao_social ?? '').trim()
    // Grava no cadastro: o dado passa a existir para a próxima nota, para a
    // cobrança e para quem abrir a ficha — em vez de viver só nesta chamada.
    if (razaoSocial) {
      await sb.from(TABELA[escolha.tipo]).update({ legal_name: razaoSocial }).eq('id', escolha.id)
    }
  }
  // Sem razão social em lugar nenhum, o apelido do cadastro é melhor que nada —
  // mas nunca o contato digitado no lançamento, que não é cadastro.
  const nomeTomador: string = razaoSocial || String(dest.name ?? '').trim() || 'Tomador'

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

  /**
   * Número da DPS: reaproveitado de uma tentativa anterior que não respondeu, ou
   * consumido agora.
   *
   * A produção do Sistema Nacional é instável, e cada falha de rede queimava um
   * número — buraco na sequência fiscal, que a Receita manda explicar. Pior: se
   * ela autorizasse e a resposta se perdesse, a tentativa seguinte emitiria uma
   * SEGUNDA nota para a mesma cobrança.
   *
   * Por isso, havendo pendência, o primeiro passo é perguntar à Receita o que
   * houve com aquela DPS. Virou nota: adota. Não virou: reenvia com o mesmo
   * número.
   */
  const { data: pendente } = await sb.from('nota_fiscal')
    .select('id, n_dps, id_dps').eq('lancamento_id', lancamentoId).eq('status', 'pendente').maybeSingle()

  if (pendente?.id_dps) {
    const r = await chamarNfse(orgId, { caminho: `/sefinnacional/dps/${pendente.id_dps}`, timeoutMs: 30_000 })
    if (!('erro' in r) && !r.erroRede && r.status === 200) {
      try {
        const resp = JSON.parse(r.corpo) as RespostaOk
        if (resp.chaveAcesso) {
          const adotada = await adotarNotaJaAutorizada(sb, orgId, pendente.id, resp.chaveAcesso, lancamentoId, orgSlug)
          if (adotada) return { nota: adotada }
        }
      } catch { /* resposta ilegível: segue para o reenvio */ }
    }
  }

  // O contador é POR AMBIENTE (mig. 316) — nota de teste não gasta número da
  // sequência oficial.
  let numero: number
  if (pendente?.n_dps != null) {
    numero = Number(pendente.n_dps)
  } else {
    const { data: n, error: eNum } = await sb.rpc('proximo_numero_nfse', {
      p_user_id: user.id, p_org_id: orgId, p_ambiente: cert.ambiente,
    })
    if (eNum) return { error: eNum.message }
    numero = Number(n)
  }

  try {
    const { xml, id } = montarDps({
      cnpjPrestador: cnpjPrestador,
      cnpjTomador,
      nomeTomador,
      codMunicipio: cfg.codMunicipio!,
      serie: cfg.serie,
      numero,
      valor,
      descricao: opcoes.descricao?.trim() || lanc.descricao || cfg.descricaoPadrao || 'Prestação de serviços de publicidade',
      codigoServico: cfg.codigoServico!,
      percSimples: cfg.percSimples!,
      tribIssqn: cfg.tribIssqn,
      tpRetIssqn: cfg.tpRetIssqn,
      aliqIssqn: cfg.aliqIssqn ?? undefined,
      ambiente: cert.ambiente === 'producao' ? 1 : 2,
      competencia: (lanc.competencia || lanc.vencimento || undefined) as string | undefined,
      nbs: cfg.codNbs || undefined,
      enderecoTomador,
      // Só vai o grupo quando a chave está ligada E os três códigos existem:
      // grupo pela metade é recusa certa, e a recusa vem depois de consumir o
      // número da DPS.
      ibsCbs: cfg.ibsCbsAtivo && cfg.codNbs && cfg.ibsCbsCIndOp && cfg.ibsCbsCst && cfg.ibsCbsClassTrib
        ? { cIndOp: cfg.ibsCbsCIndOp, cst: cfg.ibsCbsCst, classTrib: cfg.ibsCbsClassTrib }
        : undefined,
      subst: substituida
        ? { chave: substituida.chave, cMotivo: opcoes.substituir!.cMotivo, xMotivo: opcoes.substituir!.xMotivo.trim() }
        : undefined,
    })

    const { key, certB64 } = await chavesDoPfx(cert.pfx, cert.senha)
    const assinado = assinarDps(xml, id, key, certB64)

    // A pendência é gravada ANTES do envio: é ela que segura o número e o id da
    // DPS. Se a resposta não voltar, é por aqui que se descobre o que houve.
    const linhaId: string = pendente?.id ?? (await sb.from('nota_fiscal').insert({
      org_id: orgId, lancamento_id: lancamentoId, ambiente: cert.ambiente,
      status: 'pendente', numero: null, serie: cfg.serie, n_dps: numero,
      valor, competencia: lanc.competencia || lanc.vencimento || null,
      tomador_nome: nomeTomador, tomador_cnpj: cnpjTomador, tomador_tipo: escolha.tipo,
      emitido_por: user.id,
    }).select('id').single()).data?.id
    await sb.from('nota_fiscal').update({ id_dps: id, dps_gz_b64: empacotar(assinado) }).eq('id', linhaId)

    const r = await chamarNfse(orgId, {
      caminho: '/sefinnacional/nfse',
      metodo: 'POST',
      corpo: JSON.stringify({ dpsXmlGZipB64: empacotar(assinado) }),
      timeoutMs: 60_000,
    })
    if ('erro' in r) return { error: 'Certificado indisponível.' }
    if (r.erroRede) {
      // Pode ter chegado lá. A nota fica pendente com o número guardado, e a
      // próxima tentativa pergunta à Receita antes de reenviar.
      return {
        error: `A Receita não respondeu (${r.erroRede}). A nota ficou pendente com o número ${numero} reservado —`
          + ' tente de novo: o Flow confere lá antes de reenviar, para não emitir em duplicidade.',
      }
    }
    // 201 é o único que emite; qualquer outro devolve o motivo em português.
    if (r.status !== 201) {
      // Recusa é resposta: a DPS não virou nota, e o número segue reservado para
      // a próxima tentativa — corrigido o motivo, sai com o mesmo número.
      return { error: mensagemDaReceita(r.corpo) }
    }

    const resp = JSON.parse(r.corpo) as RespostaOk
    if (!resp.chaveAcesso) return { error: 'A Receita respondeu sem a chave de acesso.' }

    // Número da nota vem do XML autorizado (nNFSe); a Receita numera a NFS-e.
    let numeroNfse: string | null = null
    try {
      const xmlNota = resp.nfseXmlGZipB64 ? desempacotar(resp.nfseXmlGZipB64) : ''
      numeroNfse = (/<nNFSe>([^<]*)<\/nNFSe>/.exec(xmlNota) || [])[1] ?? null
    } catch { /* sem o número a nota ainda vale: a chave é a identidade */ }

    const { data: nova, error: eIns } = await sb.from('nota_fiscal').update({
      status: 'autorizada',
      chave: resp.chaveAcesso,
      numero: numeroNfse,
      xml_gz_b64: resp.nfseXmlGZipB64 ?? null,
      substitui_chave: substituida?.chave ?? null,
      emitido_em: new Date().toISOString(),
    }).eq('id', linhaId).select('id, chave, numero, serie, status, ambiente, valor, emitido_em').single()
    if (eIns) {
      return {
        error: `Nota emitida na Receita, mas falhou ao gravar no Flow: ${eIns.message}.`
          + ` Chave ${resp.chaveAcesso} — ela segue pendente aqui e a próxima tentativa a adota.`,
      }
    }

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

    // O vínculo fica gravado SÓ quando o tomador é cliente: escolher uma vez
    // resolve esse lançamento para sempre e alimenta margem e centro de custo.
    const patch: Record<string, unknown> = { nf_emitida: true }
    // Escolher o tomador uma vez deixa o lançamento rastreável para sempre —
    // para a próxima nota, para a margem e para a cobrança automática.
    if (!lanc.contato_id) { patch.contato_tipo = escolha.tipo; patch.contato_id = escolha.id }
    if (!lanc.workspace_id && escolha.tipo === 'cliente') patch.workspace_id = escolha.id
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
