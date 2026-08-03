/**
 * PDF do espelho de ponto.
 *
 * Se o ciclo está ASSINADO, o conteúdo vem do snapshot congelado junto da
 * assinatura — não de uma releitura do banco. Assim o PDF é exatamente aquilo
 * sobre o que o hash foi calculado; releitura poderia divergir (uma correção
 * posterior mudaria o documento sem mudar o hash impresso nele).
 *
 * Acesso: RH da org, ou o próprio colaborador (a RPC rh_espelho já valida).
 */
import { NextRequest } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { loadOrgDocs } from '@/lib/agency'
import { EspelhoDoc, type EspelhoPdfDados } from '@/lib/pdf/EspelhoDoc'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const user = await getUsuario()
  if (!user) return new Response('Não autenticado', { status: 401 })

  const orgSlug = req.nextUrl.searchParams.get('org') ?? ''
  const colaboradorId = req.nextUrl.searchParams.get('colaborador') ?? ''
  const comp = req.nextUrl.searchParams.get('comp') ?? ''
  if (!orgSlug || !colaboradorId || !/^\d{4}-\d{2}$/.test(comp)) {
    return new Response('Parâmetros inválidos', { status: 400 })
  }

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: org } = await sb.from('organizations').select('id').eq('slug', orgSlug).maybeSingle()
  if (!org) return new Response('Organização não encontrada', { status: 404 })

  const competencia = `${comp}-01`

  // Assinaturas válidas da competência (a mais antiga carrega o snapshot íntegro).
  const { data: assin } = await sb.from('rh_assinatura')
    .select('papel, hash, conteudo, assinado_em, ip, assinado_por')
    .eq('colaborador_id', colaboradorId).eq('tipo', 'espelho')
    .eq('competencia', competencia).is('invalidada_em', null)
    .order('assinado_em', { ascending: true })

  const assinaturas = (assin ?? []) as {
    papel: string; hash: string; conteudo: unknown; assinado_em: string; ip: string | null; assinado_por: string
  }[]

  // Conteúdo: snapshot congelado quando assinado; senão, leitura ao vivo.
  let dados: EspelhoPdfDados | null = null
  if (assinaturas.length && assinaturas[0].conteudo) {
    dados = assinaturas[0].conteudo as EspelhoPdfDados
  } else {
    const { data: esp, error } = await sb.rpc('rh_espelho', {
      p_org_id: org.id, p_colaborador_id: colaboradorId, p_competencia: competencia,
    })
    if (error) return new Response(error.message, { status: 403 })
    dados = esp as EspelhoPdfDados
  }
  if (!dados) return new Response('Espelho não encontrado', { status: 404 })

  // Nome de quem assinou (o snapshot guarda só o id).
  const ids = [...new Set(assinaturas.map(a => a.assinado_por))]
  const { data: perfis } = ids.length
    ? await sb.from('profiles').select('id, full_name').in('id', ids)
    : { data: [] }
  const nomePor = new Map<string, string | null>(
    (perfis ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name]))

  const doc: EspelhoPdfDados = {
    ...dados,
    assinaturas: assinaturas.map(a => ({
      papel: a.papel, por: nomePor.get(a.assinado_por) ?? null,
      assinado_em: a.assinado_em, hash: a.hash, ip: a.ip,
    })),
  }

  const { agency } = await loadOrgDocs(sb, org.id as string)
  const { data: settings } = await sb.from('org_settings').select('logo_url').eq('org_id', org.id).maybeSingle()

  const pdf = await renderToBuffer(
    <EspelhoDoc d={doc} agencia={agency} logoUrl={settings?.logo_url ?? null} />
  )

  const nome = `Espelho de ponto - ${doc.colaborador.nome} - ${comp}.pdf`.replace(/[/\\]/g, '-')
  const ascii = nome.replace(/[^\x20-\x7E]/g, '_')
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${req.nextUrl.searchParams.has('inline') ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      'Cache-Control': 'private, no-store',
    },
  })
}
