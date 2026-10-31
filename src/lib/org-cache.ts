import 'server-only'
import { unstable_cache } from 'next/cache'
import type { OrgStatusRow } from '@/types'

/**
 * Cache entre requests do que o layout da org lê em TODA navegação e muda
 * poucas vezes por mês (Onda 2 da auditoria de 31/10/2026). Antes eram 11
 * consultas por navegação e por AutoRefresh; estas quatro saem do caminho.
 *
 * `unstable_cache` não pode ler cookies: o cliente supabase vem de fora, já
 * com a sessão. O resultado é por ORG (qualquer membro lê as mesmas linhas),
 * então a chave é o org_id. As actions de Configurações invalidam pela tag.
 */

export const TAG_CONFIG_ORG = (orgId: string) => `org-config:${orgId}`
export const TAG_ONBOARDING = (orgId: string) => `onboarding:${orgId}`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export interface ConfigDaOrg {
  settings: { logo_url: string | null; accent_color: string; status_overrides: unknown[] } | null
  statuses: OrgStatusRow[]
  pauta: { campo: string; valor: string }[]
}

/** Aparência, cadastro de status e opções de pauta. Tag `org-config:<org>`, 5 min. */
export function configDaOrg(sb: Sb, orgId: string): Promise<ConfigDaOrg> {
  return unstable_cache(async () => {
    const [{ data: settings }, { data: statuses }, { data: pauta }] = await Promise.all([
      sb.from('org_settings').select('logo_url, accent_color, status_overrides').eq('org_id', orgId).single(),
      sb.from('org_status').select('valor, label, grupo, bg, txt, ordem, papel').eq('org_id', orgId).order('ordem'),
      sb.from('org_pauta_opcao').select('campo, valor').eq('org_id', orgId).order('campo').order('ordem'),
    ])
    return {
      settings: (settings ?? null) as ConfigDaOrg['settings'],
      statuses: (statuses ?? []) as OrgStatusRow[],
      pauta: (pauta ?? []) as ConfigDaOrg['pauta'],
    }
  }, ['org-config', orgId], { tags: [TAG_CONFIG_ORG(orgId)], revalidate: 300 })()
}

/** Etapas pendentes da trilha de primeiros passos DESTA pessoa. Tag `onboarding:<org>`, 5 min. */
export function trilhaPendente(sb: Sb, orgId: string, userId: string): Promise<number> {
  return unstable_cache(async () => {
    const { data } = await sb.rpc('onboarding_trilha', { p_org_id: orgId })
    return ((data ?? []) as { concluido: boolean }[]).filter(e => !e.concluido).length
  }, ['onboarding-trilha', orgId, userId], { tags: [TAG_ONBOARDING(orgId)], revalidate: 300 })()
}

/**
 * Contas cujo saldo no Flow não bate com o banco (migs. 347/348). A RPC soma o
 * extrato inteiro conta a conta; 60 s de cache tiram essa conta de cada clique
 * de quem tem o Financeiro. O alerta da sidebar tolera um minuto de atraso.
 */
export function divergenciasFinanceiras(sb: Sb, orgId: string): Promise<number> {
  return unstable_cache(async () => {
    const { data } = await sb.rpc('fin_divergencias', { p_org: orgId })
    return ((data ?? []) as { diferenca_real: number }[]).filter(d => Math.abs(Number(d.diferenca_real)) >= 0.01).length
  }, ['fin-divergencias', orgId], { revalidate: 60 })()
}
