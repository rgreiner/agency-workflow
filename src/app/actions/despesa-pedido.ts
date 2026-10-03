'use server'

import { revalidatePath } from 'next/cache'
import { assertFinanceAccess } from '@/lib/finance'
import { getUsuario } from '@/lib/auth/server'
import { bytesDeUpload, mimeDoArquivo } from '@/lib/uploads-volume'
import { lerNfFornecedor } from '@/lib/ai/nf-fornecedor'
import { logSystemError } from '@/lib/system-error'
import type { Anexo } from '@/app/actions/financeiro'

/**
 * Custo do fornecedor ligado ao pedido (mig. 329).
 *
 * A receita já tinha rastro até o documento; o custo não. A NF do fornecedor era
 * digitada como lançamento manual, com o centro de custo certo mas sem elo com o
 * PP que a gerou. Aqui a nota vira despesa COLADA no pedido.
 *
 * São N notas para 1 pedido — o fornecedor às vezes manda mais de uma. Nada
 * impede repetir; o que a RPC barra é a MESMA nota duas vezes no mesmo pedido.
 */

export interface NfLidaView {
  emitente: string | null
  cnpj: string | null
  numero: string | null
  emissao: string | null
  vencimento: string | null
  valor: number | null
  descricao: string | null
  /** Fornecedor do cadastro que casou com o CNPJ lido, quando houve. */
  fornecedorId: string | null
  fornecedorNome: string | null
}

/** Lê a NF que acabou de subir pro volume e devolve o que preencher. */
export async function lerNfDoFornecedor(orgSlug: string, urls: string[]): Promise<{ nf?: NfLidaView; error?: string }> {
  const { orgId, supabase } = await assertFinanceAccess(orgSlug)
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const arquivos: { bytes: Buffer; mimeType: string }[] = []
  for (const u of urls.slice(0, 5)) {
    const bytes = await bytesDeUpload(u)
    if (bytes) arquivos.push({ bytes, mimeType: mimeDoArquivo(u) ?? 'application/pdf' })
  }
  if (arquivos.length === 0) return { error: 'O arquivo não foi encontrado no servidor.' }

  try {
    const lida = await lerNfFornecedor(orgId, arquivos)
    if (!lida) return { error: 'Nenhuma chave de IA configurada (Configurações → Revisão IA).' }

    // Casar pelo CNPJ e não pelo nome: razão social na nota ("FINEART FILMES
    // LTDA") raramente é o nome do cadastro ("FineArt"), e CNPJ não tem grafia.
    let fornecedorId: string | null = null, fornecedorNome: string | null = null
    if (lida.cnpj) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: forns } = await (supabase as any)
        .from('fornecedores').select('id, name, tax_id').eq('org_id', orgId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const achado = ((forns ?? []) as any[]).find(f => String(f.tax_id ?? '').replace(/\D/g, '') === lida.cnpj)
      if (achado) { fornecedorId = achado.id; fornecedorNome = achado.name }
    }

    return {
      nf: {
        emitente: lida.emitente, cnpj: lida.cnpj, numero: lida.numero,
        emissao: lida.emissao, vencimento: lida.vencimento,
        valor: lida.valor_total, descricao: lida.descricao,
        fornecedorId, fornecedorNome,
      },
    }
  } catch (e) {
    // Falha de IA não vira dump na tela de quem usa — vai para system_errors,
    // visível só pra admin.
    await logSystemError(supabase, { userId: user.id, context: 'nf-fornecedor', error: e })
    return { error: 'Não foi possível ler a nota agora. Preencha à mão ou tente de novo.' }
  }
}

export interface DespesaDoPedido {
  valor: number
  vencimento: string
  competencia?: string | null
  descricao: string
  numeroNf?: string | null
  contatoId?: string | null
  contatoNome?: string | null
  contaId?: string | null
  categoria?: string | null
  anexos?: Anexo[]
}

export async function lancarDespesaDoPedido(
  orgSlug: string, producaoId: string, d: DespesaDoPedido,
): Promise<{ id?: string; error?: string }> {
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  if (!(d.valor > 0)) return { error: 'Informe o valor da nota.' }
  if (!d.vencimento) return { error: 'Informe o vencimento.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('criar_despesa_de_pedido', {
    p_user_id: user.id, p_org_id: orgId, p_producao_id: producaoId,
    p_data: {
      valor: String(d.valor), vencimento: d.vencimento, competencia: d.competencia ?? null,
      descricao: d.descricao, numero_nf: d.numeroNf ?? null,
      contato_id: d.contatoId ?? null, contato_nome: d.contatoNome ?? null,
      conta_id: d.contaId ?? null, categoria: d.categoria ?? null,
      anexos: d.anexos ?? [],
    },
  })
  if (error) return { error: error.message }

  revalidatePath(`/${orgSlug}/financeiro/custos`)
  revalidatePath(`/${orgSlug}/financeiro/lancamentos`)
  return { id: data as string }
}
