import 'server-only'
import { redirect } from 'next/navigation'
import { getUsuario } from '@/lib/auth/server'
import { getAccess } from '@/lib/auth/access'

/**
 * Gate do Hub de Mídia — por URL, não só escondido na sidebar.
 * O toggle é `op_midia_hub` do cargo (ver migration 234): `op_midias` não serve
 * porque é o gate do COMERCIAL de mídia e está ligado também na Revisão.
 */
export async function assertMidiaAccess(orgSlug: string) {
  const user = await getUsuario()
  if (!user) redirect('/login')

  const r = await getAccess(orgSlug)
  if (!r) redirect('/')
  if (!r.access.midiaHub) redirect(`/${orgSlug}/dashboard`)

  return { supabase: r.supabase, orgId: r.orgId, userId: r.userId, access: r.access }
}

/** Fila da mídia quando a org não configurou os status do cargo. */
export const MIDIA_STATUS_FALLBACK = [
  'validacao_midia', 'midia', 'social', 'implantacao_digital', 'implantacao_off',
]

/**
 * Status que a fila do Hub observa: a união dos `allowed_statuses` dos cargos
 * que operam mídia, sem o de conclusão. Sai do cadastro em vez de uma lista
 * fixa no código — status virou cadastro da org na migration 168.
 */
export async function statusDaMidia(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, orgId: string,
): Promise<string[]> {
  const [{ data: pos }, { data: fim }] = await Promise.all([
    supabase.from('org_positions').select('allowed_statuses').eq('org_id', orgId).eq('op_midia_hub', true),
    supabase.from('org_status').select('valor').eq('org_id', orgId).eq('papel', 'conclusao'),
  ])
  const conclusao = new Set<string>((fim ?? []).map((s: { valor: string }) => s.valor))
  const set = new Set<string>()
  for (const p of (pos ?? []) as { allowed_statuses: string[] | null }[]) {
    for (const s of p.allowed_statuses ?? []) if (!conclusao.has(s)) set.add(s)
  }
  return set.size ? [...set] : MIDIA_STATUS_FALLBACK.filter(s => !conclusao.has(s))
}

/**
 * Momento em que o select "Tarefa da criação" ganhou três estados (commit
 * 98eb5ce, 01/09/2026). Entrega criada ANTES disso e sem tarefa é passivo
 * indistinguível — "material pronto" ou "ninguém abriu a tarefa". Criada depois,
 * sem tarefa é material pronto por escolha. É o corte que faz a tela "Vincular
 * entregas" drenar a zero em vez de listar para sempre o que é legítimo.
 */
export const CORTE_TRES_ESTADOS = '2026-09-01T09:53:44-03:00'

export interface PendenciasTransicao { migrar: number; vincular: number }

/**
 * Quanto ainda falta nas duas telas transitórias. O menu esconde cada uma quando
 * chega a zero — sem ninguém precisar lembrar de apagar o item.
 *
 * - `migrar`: tarefas recorrentes vivas em clientes SEM mídia ativa (o balde e
 *   qualquer cliente que ainda não passou pelo catálogo). Cliente com mídia
 *   ativa fica de fora inteiro: a rotina dele já é o modelo novo.
 * - `vincular`: entregas pendentes sem tarefa criadas antes do corte.
 */
export async function pendenciasDeTransicao(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any, orgId: string,
): Promise<PendenciasTransicao> {
  const [{ data: ativos }, resVinc] = await Promise.all([
    sb.from('midia_cliente').select('workspace_id').eq('org_id', orgId).eq('ativo', true),
    sb.from('midia_entrega').select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('situacao', 'aguardando').is('activity_id', null)
      .lt('created_at', CORTE_TRES_ESTADOS),
  ])
  const comMidia = ((ativos ?? []) as { workspace_id: string }[]).map(a => a.workspace_id)
  let q = sb.from('activities')
    .select('id, campaigns!inner(workspace_id, workspaces!inner(org_id))', { count: 'exact', head: true })
    .eq('campaigns.workspaces.org_id', orgId)
    .eq('archived', false)
    .not('recurrence', 'is', null)
  if (comMidia.length) q = q.not('campaigns.workspace_id', 'in', `(${comMidia.join(',')})`)
  const resMig = await q
  return { migrar: resMig.count ?? 0, vincular: resVinc.count ?? 0 }
}
