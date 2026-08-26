'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'
import { apagarArquivoDocumento, lerArquivoDocumento } from '@/lib/rh/documento-arquivo'
import { sendMail, remetenteDominio } from '@/lib/email/send'
import { htmlDocumentoRh, rotuloDocumento } from '@/lib/email/documento-rh'

export interface ColaboradorInput {
  nome: string
  cpf?: string | null
  email?: string | null
  telefone?: string | null
  cargo?: string | null
  tipo_vinculo?: string | null
  data_admissao?: string | null
  data_demissao?: string | null
  status?: string | null
  gestor_id?: string | null
  /** Custo-empresa mensal de VR/VA/plano — camada 4 do custo/hora (migration 170). */
  beneficios_mensal?: string | null
  salario_atual?: string | null
  /** Substitui a folha no custo/hora (mig. 257) — sócio: retirada projetada. */
  custo_projetado_mensal?: string | null
  observacao?: string | null
  membro_user_id?: string | null
}

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string }
}

/** Cria (id null) ou edita um colaborador. Retorna o id. */
export async function salvarColaborador(orgSlug: string, id: string | null, data: ColaboradorInput) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: novoId, error } = await (c.supabase as any).rpc('rh_upsert_colaborador', {
    p_org_id: c.orgId, p_id: id, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh`)
  if (id) revalidatePath(`/${orgSlug}/rh/${id}`)
  return { id: novoId as string }
}

/** Liga/desliga o controle de jornada da pessoa (migration 209).
 *  Salva na hora, fora do formulário: é um interruptor, não um campo. */
export async function setBatePonto(orgSlug: string, id: string, bate: boolean) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_set_bate_ponto', { p_colaborador: id, p_bate: bate })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh`)
  revalidatePath(`/${orgSlug}/rh/${id}`)
  revalidatePath(`/${orgSlug}/rh/ponto`)
  return { ok: true }
}

/** Liga/desliga o rateio do custo da pessoa como overhead (mig. 257) — cargo
 *  adm/gestão que não atua em tarefas: o custo vai para a estrutura e as horas
 *  saem do denominador. */
export async function setCustoOverhead(orgSlug: string, id: string, overhead: boolean) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_set_custo_overhead', { p_colaborador: id, p_overhead: overhead })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/${id}`)
  revalidatePath(`/${orgSlug}/rh/horas`)
  return { ok: true }
}

/** Liga/desliga a entrada da pessoa no fechamento da contabilidade (mig. 256).
 *  Separado de bate_ponto: dá para bater ponto (custo/hora por tarefa) sem ir
 *  para a contabilidade — e o contrário. */
export async function setEntraFechamento(orgSlug: string, id: string, entra: boolean) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_set_entra_fechamento', { p_colaborador: id, p_entra: entra })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/${id}`)
  revalidatePath(`/${orgSlug}/rh/fechamento`)
  return { ok: true }
}

export async function setColaboradorArquivado(orgSlug: string, id: string, arquivado: boolean) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_set_colaborador_arquivado', { p_id: id, p_arquivado: arquivado })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh`)
}

export interface JornadaInput {
  entrada?: string; intervalo_ini?: string; intervalo_fim?: string; saida?: string
  flex_min?: number; tolerancia_min?: number; dias_semana?: number[]
}

/** Salva a jornada: padrão da org (colaboradorId null) ou override por pessoa. */
export async function salvarJornada(orgSlug: string, colaboradorId: string | null, data: JornadaInput) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_upsert_jornada', {
    p_org_id: c.orgId, p_colaborador_id: colaboradorId, p_data: data,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ponto`)
  if (colaboradorId) revalidatePath(`/${orgSlug}/rh/${colaboradorId}`)
  return { ok: true }
}

/** Remove o override de uma pessoa → volta a herdar a jornada padrão da org. */
export async function resetarJornada(orgSlug: string, colaboradorId: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_reset_jornada', { p_colaborador_id: colaboradorId })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/${colaboradorId}`)
  return { ok: true }
}

/** Lista os documentos de um colaborador (sob demanda, p/ a modal na listagem). RLS filtra por rh_can. */
export async function listarDocumentos(orgSlug: string, colaboradorId: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any)
    .from('rh_documento')
    .select('id, tipo, nome, competencia, created_at')
    .eq('colaborador_id', colaboradorId)
    .order('created_at', { ascending: false })
  if (error) return { error: error.message }
  return { documentos: (data ?? []) as { id: string; tipo: string; nome: string | null; competencia: string | null; created_at: string }[] }
}

/** Registra um documento já enviado (chave vinda de /api/rh/upload). */
export async function adicionarDocumento(
  orgSlug: string, colaboradorId: string,
  doc: { tipo: string; nome: string; chave: string; competencia?: string | null },
) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_add_documento', {
    p_colaborador_id: colaboradorId, p_data: doc,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/${colaboradorId}`)
}

export async function excluirDocumento(orgSlug: string, colaboradorId: string, docId: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }

  // Apaga o ARQUIVO antes da linha (migration 198). Ao contrário, um unlink que
  // falha deixaria exatamente o órfão que isto veio resolver — e sem rastro de
  // que ele existe. A RPC devolve a chave e registra o expurgo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: doc } = await (c.supabase as any)
    .from('rh_documento').select('chave').eq('id', docId).maybeSingle()

  const r = await apagarArquivoDocumento(doc?.chave as string | undefined)
  if (!r.ok) return { error: `Não consegui apagar o arquivo: ${r.erro}` }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_expurgar_documento', { p_id: docId, p_motivo: 'manual' })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/${colaboradorId}`)
}

/**
 * Manda o documento para o e-mail PESSOAL verificado da pessoa (migration 200).
 * Não existe caminho para o corporativo: ele está sob controle do admin, que
 * reseta senha e administra a caixa — a mesma razão pela qual o OTP da
 * assinatura também vai para o pessoal.
 */
export async function enviarDocumentoPorEmail(orgSlug: string, colaboradorId: string, docId: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const user = await getUsuario()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: info, error: e1 } = await (c.supabase as any).rpc('rh_documento_para_envio', { p_id: docId })
  if (e1) return { error: e1.message }
  const d = info as {
    tipo: string | null; nome: string | null; chave: string | null; competencia: string | null
    pessoa: string; email_pessoal: string | null; verificado: boolean
  }

  if (!d.email_pessoal) {
    return { error: `${d.pessoa} ainda não cadastrou o e-mail pessoal. Ela faz isso na tela do próprio ponto.` }
  }
  if (!d.verificado) {
    return { error: `O e-mail pessoal de ${d.pessoa} ainda não foi verificado — sem isso não dá para afirmar que a caixa é dela.` }
  }

  const arquivo = await lerArquivoDocumento(d.chave)
  if (!arquivo.ok) return { error: `Não consegui ler o arquivo: ${arquivo.erro}` }

  const { data: org } = await c.supabase.from('organizations').select('name').eq('id', c.orgId).single()
  const dominio = remetenteDominio()
  const nomeArquivo = d.nome || `${d.tipo ?? 'documento'}.pdf`

  const { error: erroEnvio } = await sendMail({
    to: d.email_pessoal,
    from: dominio ? `${org?.name ?? 'RH'} <rh@${dominio}>` : undefined,
    replyTo: user?.email || undefined,
    subject: `${rotuloDocumento(d.tipo)}${d.competencia ? ` — ${d.competencia.slice(5, 7)}/${d.competencia.slice(0, 4)}` : ''}`,
    html: htmlDocumentoRh({
      orgName: org?.name ?? 'RH', pessoa: d.pessoa, tipo: d.tipo,
      competencia: d.competencia, arquivo: nomeArquivo,
    }),
    attachments: [{ filename: nomeArquivo, content: arquivo.conteudo! }],
  })

  // O envio fica registrado mesmo quando falha: "mandei e não chegou" e "nunca
  // mandei" são problemas diferentes, e a tela precisa saber qual é.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (c.supabase as any).rpc('rh_registrar_envio_documento', {
    p_documento_id: docId, p_destino: d.email_pessoal, p_erro: erroEnvio ?? null,
  })
  if (erroEnvio) return { error: `Não enviou: ${erroEnvio}` }

  revalidatePath(`/${orgSlug}/rh/${colaboradorId}`)
  return { ok: true, destino: d.email_pessoal }
}

/** Importa uma competência de folha (linhas já extraídas e conferidas na tela).
 *  competencia = 'AAAA-MM'. Casa por CPF e cria quem falta (autoCriar). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function importarFolha(orgSlug: string, competencia: string, linhas: any[], autoCriar = true) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const comp = /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : null
  if (!comp) return { error: 'Competência inválida (use AAAA-MM)' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_importar_folha', {
    p_org_id: c.orgId, p_competencia: comp, p_linhas: linhas, p_auto_criar: autoCriar,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/folha`)
  revalidatePath(`/${orgSlug}/rh`)
  return {
    resultado: data as {
      linhas: number; criados: number; casados: number
      // Linhas que não casaram com ninguém (migration 197). Antes viravam ficha
      // nova em silêncio — e no reimport, mais uma.
      pendentes?: { folha_id: string; nome: string | null; cpf: string | null; cargo: string | null; liquido: number | null }[]
    },
  }
}

/** "A quem pertence este registro?" — liga a linha da folha a uma ficha existente
 *  e aproveita para completar CPF e salário que faltavam no cadastro. */
export async function vincularLinhaFolha(orgSlug: string, folhaId: string, colaboradorId: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_folha_vincular', {
    p_folha_id: folhaId, p_colaborador_id: colaboradorId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/folha`)
  return { resultado: data as { ok: boolean; colaborador: string; cpf_preenchido: boolean } }
}

export interface PlanoPessoa {
  colaborador_id: string | null; nome: string; liquido: number
  status: 'vinculado' | 'achado' | 'novo'
  lancamento_id: string | null; lanc_valor: number | null; lanc_venc: string | null; lanc_situacao: string | null
}
/** O que acontece ao marcar a ficha como "Desligado": o gatilho da migration 179
 *  arquiva o acesso e solta as atividades ativas. A tela avisa ANTES de salvar. */
export async function carregarImpactoDesligamento(orgSlug: string, colaboradorId: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_impacto_desligamento', {
    p_colaborador_id: colaboradorId,
  })
  if (error) return { error: error.message }
  return { impacto: data as { tem_acesso: boolean; ativas: number } }
}

export interface PlanoGuia {
  status: 'vinculado' | 'achado' | 'novo'
  lancamento_id: string | null; valor: number | null; venc: string | null
  situacao: string | null; descricao: string | null
}
export interface FolhaPlano {
  competencia: string
  salarios: PlanoPessoa[]
  socios: { nome: string }[]
  guias?: { inss: PlanoGuia; fgts: PlanoGuia }
  palpite_inss?: number
  palpite_fgts?: number
}

/** Plano de conciliação da competência: por pessoa, com o lançamento candidato (read-only). */
export async function carregarPlanoFolha(orgSlug: string, competencia: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const comp = /^\d{4}-\d{2}$/.test(competencia) ? `${competencia}-01` : null
  if (!comp) return { error: 'Competência inválida' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_folha_plano', {
    p_org_id: c.orgId, p_competencia: comp,
  })
  if (error) return { error: error.message }
  return { plano: data as FolhaPlano }
}

export interface AplicarSalario {
  colaborador_id: string | null; nome: string
  acao: 'vincular' | 'criar' | 'ignorar'
  lancamento_id?: string | null; valor?: number; venc?: string
}

/** Aplica a conciliação: salários por pessoa (vincular/criar) + guias INSS/FGTS
 *  (com o provisionado a adotar, quando o plano achou um). */
export async function aplicarFolhaFinanceiro(orgSlug: string, i: {
  competencia: string; salarios: AplicarSalario[]
  inss: number; vencInss: string; fgts: number; vencFgts: string
  inssLanc?: string | null; fgtsLanc?: string | null
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  const comp = /^\d{4}-\d{2}$/.test(i.competencia) ? `${i.competencia}-01` : null
  if (!comp) return { error: 'Competência inválida' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_folha_aplicar', {
    p_org_id: c.orgId, p_competencia: comp, p_salarios: i.salarios,
    p_inss: i.inss || 0, p_venc_inss: i.vencInss || null,
    p_fgts: i.fgts || 0, p_venc_fgts: i.vencFgts || null,
    p_inss_lanc: i.inssLanc || null, p_fgts_lanc: i.fgtsLanc || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/folha`)
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  return { resultado: data as { vinculados: number; criados: number; guias: number } }
}

// gerarLancamentosFolha (consolidado "Salários") foi substituído por
// carregarPlanoFolha + aplicarFolhaFinanceiro — agora é 1 lançamento POR PESSOA,
// sócios sem salário e vínculo ao lançamento manual existente (migration 161).
