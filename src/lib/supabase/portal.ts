/**
 * Cliente supabase-js do PORTAL DO CLIENTE (server-only). Carrega o JWT do
 * cookie `flow-portal-jwt` (role='portal'): no PostgREST essa role só executa
 * as RPCs portal_* — nenhuma tabela, nenhuma RPC interna. Sem token vai como
 * anon e tudo nega.
 */
import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { tokenSessaoPortal } from '@/lib/auth/portal'
import { Database } from '@/types/database'

export async function createPortalClient() {
  const token = await tokenSessaoPortal()

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () => token,
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
}
