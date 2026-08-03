'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { unwrap } from '@/lib/supabase/unwrap'
import { sendMail, remetenteDominio } from '@/lib/email/send'
import { htmlCobranca, assuntoCobranca, tomPorDias, type TituloCobranca } from '@/lib/email/cobranca'

/**
 * Ações da cobrança (tela de Inadimplentes). A régua automática vive no cron;
 * aqui é o que o financeiro faz à mão: cobrar agora, registrar promessa de
 * pagamento, vincular a grafia do contato a um cliente e ligar/desligar a régua.
 */

const diasAtraso = (venc: string, hoje: string) => {
  const a = Date.UTC(+venc.slice(0, 4), +venc.slice(5, 7) - 1, +venc.slice(8, 10))
  const b = Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, +hoje.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

async function contexto(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { erro: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id, name').eq('slug', orgSlug).single()
  if (!org) return { erro: 'Organização não encontrada' as const }
  return { supabase, user, org }
}

/**
 * "Cobrar agora": UM e-mail por cliente com TODOS os títulos escolhidos — é o
 * que o cliente espera receber, e evita cinco e-mails para as cinco parcelas do
 * mesmo Fee. Sai do financeiro@ da agência com Reply-To de quem clicou.
 */
export async function cobrarAgora(orgSlug: string, workspaceId: string, lancamentoIds: string[]) {
  const ctx = await contexto(orgSlug)
  if ('erro' in ctx) return { error: ctx.erro }
  const { supabase, user, org } = ctx
  if (!lancamentoIds.length) return { error: 'Nenhum título selecionado.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: ws } = await sb.from('workspaces')
    .select('id, name, finance_email').eq('id', workspaceId).eq('org_id', org.id).maybeSingle()
  if (!ws) return { error: 'Cliente não encontrado.' }
  const dest = (ws.finance_email ?? '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) {
    return { error: `${ws.name} não tem e-mail financeiro cadastrado — informe na ficha do cliente.` }
  }

  const { data: cfg } = await sb.from('org_settings').select('payment_info').eq('org_id', org.id).maybeSingle()
  const paymentInfo = (cfg?.payment_info ?? '').trim()
  if (!paymentInfo) {
    return { error: 'Cadastre os dados de pagamento (Configurações → Documentos) antes de cobrar — sem eles o cliente não sabe como pagar.' }
  }

  const res = await sb.from('lancamentos')
    .select('id, descricao, valor, valor_realizado, vencimento, situacao, tipo')
    .eq('org_id', org.id).eq('workspace_id', workspaceId).in('id', lancamentoIds)
  interface LancRow {
    id: string; descricao: string | null; valor: number | string
    valor_realizado: number | string | null; vencimento: string | null; situacao: string; tipo: string
  }
  const lancs = unwrap<LancRow>(res, 'títulos da cobrança')
    .filter(l => l.tipo === 'entrada' && l.situacao === 'em_aberto' && l.vencimento)
  if (!lancs.length) return { error: 'Nenhum título em aberto entre os selecionados.' }

  const hoje = new Date().toISOString().slice(0, 10)
  const titulos: TituloCobranca[] = lancs
    .map(l => ({
      descricao: l.descricao?.trim() || 'Cobrança',
      valor: Math.round((Number(l.valor ?? 0) - Number(l.valor_realizado ?? 0)) * 100) / 100,
      vencimento: l.vencimento!,
      dias: diasAtraso(l.vencimento!, hoje),
    }))
    .filter(t => t.valor > 0)
    .sort((a, b) => b.dias - a.dias)
  if (!titulos.length) return { error: 'Os títulos selecionados já estão quitados.' }

  const dias = titulos[0].dias
  const tom = tomPorDias(dias)
  const dominio = remetenteDominio()
  const { error: erroEnvio } = await sendMail({
    to: dest,
    from: dominio ? `${org.name} Financeiro <financeiro@${dominio}>` : undefined,
    replyTo: user.email || undefined,
    subject: `${assuntoCobranca(tom, dias)} — ${org.name}`,
    html: htmlCobranca({ orgName: org.name, cliente: ws.name, titulos, paymentInfo, tom }),
  })
  if (erroEnvio) return { error: `Não enviou: ${erroEnvio}` }

  const { error } = await sb.rpc('registrar_cobranca_manual', {
    p_user_id: user.id, p_lancamento_ids: lancs.map(l => l.id), p_email: dest,
  })
  // O e-mail já saiu — falhar aqui só perde o rastro, não desfaz o envio.
  if (error) return { ok: true, email: dest, aviso: `Enviado, mas o histórico não gravou: ${error.message}` }

  revalidatePath(`/${orgSlug}/financeiro/inadimplentes`)
  return { ok: true, email: dest, titulos: titulos.length }
}

/** Promessa de pagamento: silencia a régua até a data prometida. */
export async function setPromessaPagamento(
  orgSlug: string, lancamentoId: string, data: string | null, obs: string | null,
) {
  const ctx = await contexto(orgSlug)
  if ('erro' in ctx) return { error: ctx.erro }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (ctx.supabase as any).rpc('set_lancamento_promessa', {
    p_user_id: ctx.user.id, p_lancamento_id: lancamentoId, p_data: data || null, p_obs: obs || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/inadimplentes`)
  return { ok: true }
}

/**
 * Vincula uma grafia de contato a um cliente. Grava o de-para e carimba todos os
 * lançamentos com aquele nome — o extrato do Conta Azul traz razão social
 * ("OPERA EMPREENDIMENTOS LTDA") e o Flow guarda o apelido ("Opera").
 */
export async function vincularClienteContato(orgSlug: string, contato: string, workspaceId: string) {
  const ctx = await contexto(orgSlug)
  if ('erro' in ctx) return { error: ctx.erro }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.supabase as any).rpc('set_cliente_alias', {
    p_user_id: ctx.user.id, p_org_id: ctx.org.id, p_contato: contato, p_workspace_id: workspaceId,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/inadimplentes`)
  return { ok: true, vinculados: Number(data ?? 0) }
}

export async function setCobrancaConfig(orgSlug: string, ativa: boolean, regua: number[]) {
  const ctx = await contexto(orgSlug)
  if ('erro' in ctx) return { error: ctx.erro }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (ctx.supabase as any).rpc('set_cobranca_config', {
    p_user_id: ctx.user.id, p_org_id: ctx.org.id, p_ativa: ativa, p_regua: regua,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/inadimplentes`)
  return { ok: true }
}

export async function setClienteCobrancaAuto(orgSlug: string, workspaceId: string, ativo: boolean) {
  const ctx = await contexto(orgSlug)
  if ('erro' in ctx) return { error: ctx.erro }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (ctx.supabase as any).rpc('set_cliente_cobranca_auto', {
    p_user_id: ctx.user.id, p_workspace_id: workspaceId, p_ativo: ativo,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/financeiro/inadimplentes`)
  revalidatePath(`/${orgSlug}/workspaces/${workspaceId}`)
  return { ok: true }
}
