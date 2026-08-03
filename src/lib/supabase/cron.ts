/**
 * Cliente supabase-js das TAREFAS AGENDADAS. Igual ao de servidor, só que a
 * identidade não vem de cookie: é um JWT curto (10 min) assinado na hora com o
 * claim `flow_cron`, que as RPCs reconhecem por is_cron() (migration 183).
 *
 * Antes o cron ia como `anon` — o que obrigava as RPCs que ele usa a ficarem
 * sem checagem de autorização, abertas pra qualquer um no PostgREST público.
 */
import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { mintCronToken } from '@/lib/auth/jwt'
import { Database } from '@/types/database'

export async function createCronClient() {
  const token = await mintCronToken()
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () => token,
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
}
