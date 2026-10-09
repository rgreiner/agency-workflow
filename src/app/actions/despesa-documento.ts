'use server'

import { revalidatePath } from 'next/cache'
import { assertFinanceAccess } from '@/lib/finance'
import { getUsuario } from '@/lib/auth/server'
import { bytesDeUpload, mimeDoArquivo } from '@/lib/uploads-volume'
import { lerNfFornecedor } from '@/lib/ai/nf-fornecedor'
import { categoriaNomes, type CategoriaGrupoLike } from '@/lib/finance-categorias'
import { chaveNome } from '@/lib/nomes'
import { logSystemError } from '@/lib/system-error'
import type { Anexo } from '@/app/actions/financeiro'

/**
 * Despesa a partir do documento (tela Financeiro → Lançar despesa).
 *
 * A pessoa sobe a NF, o cupom ou o boleto; a IA lê o cabeçalho; a tela mostra
 * tudo preenchido para conferir; o lançamento nasce com o documento anexado.
 * Nenhum fornecedor manda XML (medido em 03/10/2026: os 214 anexos de despesa
 * eram PDF ou foto), então é leitura por IA — e o que ela lê é SUGESTÃO.
 */

export interface DocumentoLido {
  emitente: string | null
  cnpj: string | null
  numero: string | null
  emissao: string | null
  vencimento: string | null
  /** Total impresso no(s) documento(s). */
  valor: number | null
  /** O que a pessoa marcou como da empresa (manuscrito ou grifado). */
  valorMarcado: number | null
  criterio: 'manuscrito' | 'grifado' | null
  documentos: number
  descricao: string | null
  pagoNoAto: boolean
  categoria: string | null
  /** Fornecedor do cadastro que casou com o documento, quando houve. */
  fornecedorId: string | null
  fornecedorNome: string | null
  /** Por onde casou — a tela diz, para a pessoa saber o quanto confiar. */
  casouPor: 'cnpj' | 'nome' | null
}

export async function lerDocumentoDespesa(orgSlug: string, urls: string[]): Promise<{ doc?: DocumentoLido; error?: string }> {
  const { orgId, supabase } = await assertFinanceAccess(orgSlug)
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const arquivos: { bytes: Buffer; mimeType: string }[] = []
  // Teto de 5: cupom de mercado chega fotografado em pedaços, mas cada imagem
  // custa — 5 já cobrem um cupom inteiro.
  for (const u of urls.slice(0, 5)) {
    const bytes = await bytesDeUpload(u)
    if (bytes) arquivos.push({ bytes, mimeType: mimeDoArquivo(u) ?? 'application/pdf' })
  }
  if (arquivos.length === 0) return { error: 'O arquivo não foi encontrado no servidor.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [{ data: cfg }, { data: forns }] = await Promise.all([
    sb.from('org_settings').select('finance_categorias').eq('org_id', orgId).maybeSingle(),
    sb.from('fornecedores').select('id, name, legal_name, tax_id').eq('org_id', orgId).eq('archived', false),
  ])
  const categorias = categoriaNomes((cfg?.finance_categorias ?? []) as CategoriaGrupoLike[], 'saida')

  try {
    const lido = await lerNfFornecedor(orgId, arquivos, categorias)
    if (!lido) return { error: 'Nenhuma chave de IA configurada (Configurações → Revisão IA).' }

    // CNPJ primeiro, porque não tem grafia. Nome só como segunda tentativa, e
    // exato depois de normalizado — "parecido" casaria o supermercado errado.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lista = (forns ?? []) as any[]
    let achado = lido.cnpj ? lista.find(f => String(f.tax_id ?? '').replace(/\D/g, '') === lido.cnpj) : null
    let casouPor: DocumentoLido['casouPor'] = achado ? 'cnpj' : null
    if (!achado && lido.emitente) {
      const k = chaveNome(lido.emitente)
      achado = lista.find(f => chaveNome(f.legal_name ?? '') === k || chaveNome(f.name ?? '') === k) ?? null
      if (achado) casouPor = 'nome'
    }

    return {
      doc: {
        emitente: lido.emitente, cnpj: lido.cnpj, numero: lido.numero,
        emissao: lido.emissao, vencimento: lido.vencimento, valor: lido.valor_total,
        valorMarcado: lido.valor_marcado, criterio: lido.criterio_marcado, documentos: lido.documentos,
        descricao: lido.descricao, pagoNoAto: lido.pago_no_ato, categoria: lido.categoria,
        fornecedorId: achado?.id ?? null, fornecedorNome: achado?.name ?? null, casouPor,
      },
    }
  } catch (e) {
    // Falha de IA vai para system_errors (visível ao admin), nunca dump na tela.
    await logSystemError(supabase, { userId: user.id, context: 'despesa-documento', error: e })
    return { error: 'Não foi possível ler o documento agora. Preencha à mão ou tente de novo.' }
  }
}

export interface NovaDespesa {
  valor: number
  vencimento: string
  competencia?: string | null
  descricao: string
  numeroNf?: string | null
  fornecedorId?: string | null
  /** Nome livre quando não há cadastro (o supermercado da esquina). */
  contatoNome?: string | null
  contaId?: string | null
  categoria: string
  centroCusto: string
  forma?: string | null
  anexos: Anexo[]
}

export async function lancarDespesaDeDocumento(orgSlug: string, d: NovaDespesa): Promise<{ id?: string; error?: string }> {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  if (!(d.valor > 0)) return { error: 'Informe o valor.' }
  if (!d.vencimento) return { error: 'Informe a data de vencimento (ou da compra).' }
  if (!d.categoria?.trim()) return { error: 'Escolha a categoria.' }
  // Mesma régua de todo lançamento (decisão de 31/07/2026): sem centro de custo
  // a rentabilidade por cliente fica cega.
  if (!d.centroCusto?.trim()) return { error: 'Informe o centro de custo — ele diz de qual cliente sai o dinheiro.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  let nome = d.contatoNome?.trim() || null
  if (d.fornecedorId) {
    const { data: f } = await sb.from('fornecedores').select('name').eq('id', d.fornecedorId).eq('org_id', orgId).maybeSingle()
    nome = f?.name ?? nome
  }

  const { data: id, error } = await sb.rpc('create_lancamento', {
    p_user_id: user.id, p_org_id: orgId,
    p_data: {
      tipo: 'saida',
      contato_tipo: d.fornecedorId ? 'fornecedor' : null,
      contato_id: d.fornecedorId ?? null,
      contato_nome: nome,
      descricao: d.descricao.trim(),
      valor: String(d.valor),
      vencimento: d.vencimento,
      competencia: d.competencia ?? d.vencimento,
      conta_id: d.contaId || null,
      categoria: d.categoria,
      centro_custo: d.centroCusto,
      forma_pagamento: d.forma || null,
      // O número da nota vai na observação, que é onde o pacote da contabilidade
      // procura ("nº da NF em toda linha").
      observacao: d.numeroNf ? `NF ${d.numeroNf}` : null,
      anexos: d.anexos,
    },
  })
  if (error) return { error: error.message }

  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  return { id: id as string }
}
