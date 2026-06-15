/**
 * Cliente supabase-js para o BROWSER (client components). Lê NOSSO JWT do
 * cookie `flow-jwt` (não-httpOnly de propósito) e o envia ao PostgREST via a
 * opção `accessToken`. O JWT_SECRET nunca chega aqui — só o token assinado.
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { COOKIE_TOKEN } from '@/lib/auth/jwt'
import { Database } from '@/types/database'

function lerTokenCookie(): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE_TOKEN + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

export function createClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () => lerTokenCookie(),
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
}
