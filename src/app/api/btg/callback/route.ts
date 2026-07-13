/**
 * Callback do OAuth BTG: valida o state, troca o code por tokens, guarda o refresh
 * token (via conexão direta) e tenta descobrir a conta. Volta pra tela de Contas.
 * GET /api/btg/callback?code=...&state=...
 */
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { btgConfig } from '@/lib/btg/config'
import { exchangeCode, verifyState } from '@/lib/btg/oauth'
import { saveBtgConnection, setBtgAccount } from '@/lib/btg/store'
import { listAccounts } from '@/lib/btg/api'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const st = p.get('state') ? verifyState(p.get('state') as string) : null
  const orgSlug = st?.org ?? ''
  const back = (q: string) => NextResponse.redirect(new URL(`/${orgSlug || ''}/financeiro/contas?btg=${q}`, req.url))

  if (p.get('error')) return back('erro')
  if (!st || !p.get('code')) return back('erro')

  try {
    const supabase = await createClient()
    const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
    if (!org) return back('erro')

    const tokens = await exchangeCode(p.get('code') as string)
    if (!tokens.refresh_token) return back('semrefresh')

    const cfg = btgConfig()
    await saveBtgConnection(org.id, {
      companyId: cfg.companyId, refreshToken: tokens.refresh_token, scopes: cfg.scopes,
    })

    // Descobre a conta (não é crítico p/ concluir a conexão).
    try {
      if (cfg.companyId) {
        const accts = await listAccounts(cfg.companyId, tokens.access_token)
        if (accts[0]) await setBtgAccount(org.id, accts[0].accountId)
      }
    } catch { /* segue conectado; a conta é resolvida no próximo sync */ }

    return back('ok')
  } catch {
    return back('erro')
  }
}
