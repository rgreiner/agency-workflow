/**
 * Config da integração BTG Empresas. Tudo por env (lazy — nunca lança no import),
 * pra o app subir mesmo sem o BTG configurado. Sandbox por padrão; hosts
 * sobrescrevíveis por env porque o host de sandbox pode variar.
 *
 * Envs (no Coolify):
 *   BTG_CLIENT_ID, BTG_CLIENT_SECRET   — credenciais do app (secret NUNCA no client)
 *   BTG_ENV = sandbox | production     — default sandbox
 *   BTG_COMPANY_ID                     — CNPJ da empresa (companyId nos paths)
 *   BTG_SCOPES                         — escopos OAuth (default abaixo; ajustar ao app)
 *   BTG_ID_BASE, BTG_API_BASE          — overrides dos hosts (se diferirem do default)
 *   NEXT_PUBLIC_SITE_URL               — base p/ montar o redirect_uri
 */
export type BtgEnv = 'sandbox' | 'production'

export interface BtgConfig {
  clientId: string
  clientSecret: string
  env: BtgEnv
  companyId: string
  scopes: string
  idBase: string
  apiBase: string
  redirectUri: string
}

/** True se as credenciais mínimas estão presentes (pra UI decidir o que mostrar). */
export function btgConfigured(): boolean {
  return !!(process.env.BTG_CLIENT_ID && process.env.BTG_CLIENT_SECRET)
}

export function btgEnv(): BtgEnv {
  return process.env.BTG_ENV === 'production' ? 'production' : 'sandbox'
}

/** Config resolvida. Lança se faltar credencial — chamar só quando for de fato usar. */
export function btgConfig(): BtgConfig {
  const clientId = process.env.BTG_CLIENT_ID
  const clientSecret = process.env.BTG_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('BTG não configurado (defina BTG_CLIENT_ID e BTG_CLIENT_SECRET).')
  }
  const env = btgEnv()
  const idBase = process.env.BTG_ID_BASE
    || (env === 'production' ? 'https://id.btgpactual.com' : 'https://id.sandbox.btgpactual.com')
  const apiBase = process.env.BTG_API_BASE
    || (env === 'production' ? 'https://api.empresas.btgpactual.com' : 'https://api.sandbox.empresas.btgpactual.com')
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://flow.oneaone.com.br').replace(/\/$/, '')
  // No sandbox o token é travado numa empresa de teste fixa (o CNPJ real não tem
  // rota → 404). Em produção usa o CNPJ real do env.
  const SANDBOX_COMPANY_ID = '30306294000145'
  return {
    clientId,
    clientSecret,
    env,
    companyId: env === 'sandbox' ? SANDBOX_COMPANY_ID : (process.env.BTG_COMPANY_ID || ''),
    // Escopo do extrato/saldo confirmado no console do app: accounts.readonly (só leitura).
    // Se o BTG não devolver refresh token, acrescentar 'offline_access' via BTG_SCOPES.
    scopes: process.env.BTG_SCOPES || 'openid empresas.btgpactual.com/accounts.readonly',
    idBase,
    apiBase,
    redirectUri: `${site}/api/btg/callback`,
  }
}
