/**
 * Cliente supabase-js para o SERVIDOR (RSC / Server Actions). Aponta pro
 * PostgREST self-hosted e carrega NOSSO JWT (cookie `flow-jwt`) via a opção
 * `accessToken` — sem GoTrue, sem @supabase/ssr. Só faz `.from()`/`.rpc()`.
 * Quando não há token (deslogado), vai como anon e a RLS nega.
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { COOKIE_TOKEN } from '@/lib/auth/jwt'
import { Database } from '@/types/database'

export async function createClient() {
  const jar = await cookies()
  const token = jar.get(COOKIE_TOKEN)?.value ?? null

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () => token,
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
}
