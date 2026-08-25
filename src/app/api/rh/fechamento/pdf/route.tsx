/**
 * PDF do fechamento do ponto: o time inteiro num documento só, uma pessoa por
 * página, cada uma no período PRÓPRIO da sua linha (o do desligado estica até
 * a demissão — mig. 256). Mesmo papel do relatório que a contabilidade
 * recebia do Pontomais.
 *
 * Acesso: a RLS de rh_fechamento_run (rh_can) corta quem não é do RH — o run
 * simplesmente não aparece e a rota devolve 404.
 */
import { NextRequest } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { loadOrgDocs } from '@/lib/agency'
import { EspelhoLoteDoc } from '@/lib/pdf/EspelhoDoc'
import { montarEspelhosDoRun, type RunLinhaRef } from '@/lib/pdf/fechamento-ponto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const user = await getUsuario()
  if (!user) return new Response('Não autenticado', { status: 401 })

  const orgSlug = req.nextUrl.searchParams.get('org') ?? ''
  const runId = req.nextUrl.searchParams.get('run') ?? ''
  if (!orgSlug || !runId) return new Response('Parâmetros inválidos', { status: 400 })

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: org } = await sb.from('organizations').select('id').eq('slug', orgSlug).maybeSingle()
  if (!org) return new Response('Organização não encontrada', { status: 404 })

  const { data: run } = await sb.from('rh_fechamento_run')
    .select('id, competencia, ini, fim, rh_fechamento_run_linha(colaborador_id, ini, fim, nome)')
    .eq('id', runId).eq('org_id', org.id).maybeSingle()
  if (!run) return new Response('Fechamento não encontrado', { status: 404 })

  const linhas = (run.rh_fechamento_run_linha as (RunLinhaRef & { nome: string })[])
    .slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  let dados
  try {
    dados = await montarEspelhosDoRun(sb, org.id as string, run.competencia, linhas)
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'Falha ao montar os espelhos', { status: 500 })
  }

  const { agency } = await loadOrgDocs(sb, org.id as string)
  const { data: settings } = await sb.from('org_settings').select('logo_url').eq('org_id', org.id).maybeSingle()

  const pdf = await renderToBuffer(
    <EspelhoLoteDoc dados={dados} agencia={agency} logoUrl={settings?.logo_url ?? null} />
  )

  const dBR = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
  const nome = `Espelho de ponto (${dBR(run.ini)} - ${dBR(run.fim)}).pdf`
  const ascii = nome.replace(/[^\x20-\x7E]/g, '_')
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      'Cache-Control': 'private, no-store',
    },
  })
}
