import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runCron } from '@/lib/cron/jobs'

export const dynamic = 'force-dynamic'

// Executor de tarefas agendadas. Batido pelo crontab do VPS a cada 15min:
//   */15 * * * * curl -s -H "x-cron-secret: $CRON_SECRET" https://flow.oneaone.com.br/api/cron
// Protegido por header secreto. "?job=nome" força um job específico (debug).
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  }

  const onlyJob = request.nextUrl.searchParams.get('job') || undefined
  try {
    const supabase = await createClient()
    const results = await runCron(supabase, onlyJob)
    return NextResponse.json({ ok: true, results })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'erro' }, { status: 500 })
  }
}
