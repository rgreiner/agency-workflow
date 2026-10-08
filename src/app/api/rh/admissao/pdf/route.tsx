/**
 * PDF da ficha de admissão — o documento que vai para a contabilidade, no
 * formato que ela já recebe. Acesso: quem enxerga a admissão pela RLS (rh_can).
 */
import { NextRequest } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { loadOrgDocs } from '@/lib/agency'
import { FichaAdmissaoDoc } from '@/lib/pdf/FichaAdmissaoDoc'
import { nomeLegivel } from '@/lib/nomes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const user = await getUsuario()
  if (!user) return new Response('Não autenticado', { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Parâmetros inválidos', { status: 400 })

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  // A RLS de rh_admissao (rh_can) filtra: sem permissão, não vem linha.
  const { data: a } = await sb.from('rh_admissao')
    .select('org_id, nome, cargo, tipo_vinculo, salario, data_inicio, jornada, beneficios, exame_em, ficha')
    .eq('id', id).maybeSingle()
  if (!a) return new Response('Não encontrado', { status: 404 })

  const { data: docs } = await sb.from('rh_admissao_doc').select('tipo, nome').eq('admissao_id', id)
  const { data: cfg } = await sb.from('org_settings').select('logo_url').eq('org_id', a.org_id).maybeSingle()
  const { agency } = await loadOrgDocs(sb, a.org_id)

  const pdf = await renderToBuffer(
    FichaAdmissaoDoc({
      d: { ...a, nome: nomeLegivel(a.nome), anexos: docs ?? [] },
      agencia: agency, logoUrl: cfg?.logo_url ?? null,
    }))

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(`Ficha de admissão — ${nomeLegivel(a.nome)}.pdf`)}`,
      'Cache-Control': 'private, no-store',
    },
  })
}
