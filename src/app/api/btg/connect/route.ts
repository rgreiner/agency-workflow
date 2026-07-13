/**
 * Início do OAuth BTG: valida acesso financeiro do usuário e redireciona pro BTG Id
 * (authorize) com um state assinado que amarra o callback à org. GET /api/btg/connect?org=slug
 */
import { type NextRequest, NextResponse } from 'next/server'
import { getUsuario } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'
import { btgConfigured } from '@/lib/btg/config'
import { authorizeUrl, signState } from '@/lib/btg/oauth'
import { publicBaseUrl } from '@/lib/btg/url'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const orgSlug = req.nextUrl.searchParams.get('org') ?? ''
  const base = publicBaseUrl(req)
  const back = (q: string) => NextResponse.redirect(`${base}/${orgSlug}/financeiro/contas?btg=${q}`)

  const user = await getUsuario()
  if (!user) return NextResponse.redirect(`${base}/login`)
  if (!btgConfigured()) return back('naoconfig')

  const supabase = await createClient()
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return NextResponse.redirect(`${base}/`)

  const { data: m } = await supabase
    .from('organization_members').select('role, can_finance')
    .eq('org_id', org.id).eq('user_id', user.id).single() as { data: { role: string; can_finance: boolean } | null }
  if (!m || !(m.can_finance || ['owner', 'admin'].includes(m.role))) return back('semacesso')

  return NextResponse.redirect(authorizeUrl(signState({ org: orgSlug, uid: user.id })))
}
