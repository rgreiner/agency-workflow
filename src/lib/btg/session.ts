/**
 * Obtém um access token válido a partir do refresh token guardado, já rotacionando
 * e persistindo o novo refresh token (o BTG rotaciona a cada uso). É o ponto de
 * entrada de qualquer chamada autenticada (teste manual + sync do cron).
 */
import { getBtgConnection, updateBtgRefreshToken } from './store'
import { refreshTokens } from './oauth'

export interface BtgAccess {
  accessToken: string
  companyId: string | null
  accountId: string | null
}

export async function getBtgAccess(orgId: string): Promise<BtgAccess> {
  const conn = await getBtgConnection(orgId)
  if (!conn?.refreshToken) throw new Error('BTG não conectado nesta organização.')
  const tokens = await refreshTokens(conn.refreshToken)
  if (!tokens.access_token) throw new Error('BTG não devolveu access token.')
  if (tokens.refresh_token && tokens.refresh_token !== conn.refreshToken) {
    await updateBtgRefreshToken(orgId, tokens.refresh_token)
  }
  return { accessToken: tokens.access_token, companyId: conn.companyId, accountId: conn.accountId }
}
