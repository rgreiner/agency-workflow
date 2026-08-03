/**
 * Cliente supabase-js para o BROWSER (client components).
 *
 * Ele NÃO fala mais direto com o flow-api: aponta para `/api/rest` na própria
 * origem, e é o servidor que anexa o JWT (lido do cookie httpOnly) antes de
 * repassar ao PostgREST. Antes, o cookie `flow-jwt` era legível por JavaScript
 * justamente para o supabase-js poder mandá-lo daqui — e um XSS levava embora um
 * token de 7 dias sem revogação. Agora o token não passa pelo browser.
 *
 * Ver src/app/api/rest/[...path]/route.ts.
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Database } from '@/types/database'

export function createClient() {
  // supabase-js monta `${url}/rest/v1/...`; com a origem atual, isso cai no proxy.
  const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  return createSupabaseClient<Database>(
    `${base}/api`,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
