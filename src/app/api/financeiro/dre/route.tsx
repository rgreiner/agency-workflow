/**
 * DRE mensal para enviar à contabilidade ou ao banco (?formato=pdf|xlsx).
 * Mesma conta da tela (lib/dre-calculo) e mesma estrutura da org. O acesso é o
 * da própria RPC dashboard_financeiro: quem não pode ver a Gestão recebe erro.
 */
import { NextRequest } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { loadOrgDocs } from '@/lib/agency'
import { calcularDre, rotuloDre, type CatMesV, type DreLinhaCalc } from '@/lib/dre-calculo'
import type { DreConfig } from '@/lib/dre-template'
import { DreDoc, mesCurto } from '@/lib/pdf/DreDoc'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const user = await getUsuario()
  if (!user) return new Response('Não autenticado', { status: 401 })

  const orgSlug = req.nextUrl.searchParams.get('org') ?? ''
  const mesParam = req.nextUrl.searchParams.get('mes') ?? ''
  const formato = req.nextUrl.searchParams.get('formato') === 'xlsx' ? 'xlsx' : 'pdf'
  const mes = /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : new Date().toISOString().slice(0, 7)

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: org } = await sb.from('organizations').select('id').eq('slug', orgSlug).maybeSingle()
  if (!org) return new Response('Organização não encontrada', { status: 404 })

  const [{ data: fin, error }, { data: cfg }, { agency }] = await Promise.all([
    sb.rpc('dashboard_financeiro', { p_user_id: user.id, p_org_id: org.id, p_mes: mes }),
    sb.from('org_settings').select('logo_url, dre_estrutura').eq('org_id', org.id).maybeSingle(),
    loadOrgDocs(sb, org.id as string),
  ])
  if (error || !fin) return new Response('Sem acesso à DRE', { status: 403 })

  const meses = (fin.dre_meses ?? []) as string[]
  const linhas = calcularDre(meses, (fin.dre_real ?? []) as CatMesV[], (fin.dre_prev ?? []) as CatMesV[],
    (cfg?.dre_estrutura ?? null) as DreConfig | null)
  const parcial = meses[meses.length - 1] === new Date().toISOString().slice(0, 7)
  const periodo = `${mesCurto(meses[0])} a ${mesCurto(meses[meses.length - 1])}`
  const nome = `DRE ${agency.nome} (${periodo.replace(/\//g, '-')}).${formato}`

  let corpo: Uint8Array<ArrayBuffer>, tipo: string
  if (formato === 'pdf') {
    const pdf = await renderToBuffer(<DreDoc d={{ meses, linhas, parcial }} agencia={agency} logoUrl={cfg?.logo_url ?? null} />)
    corpo = new Uint8Array(pdf); tipo = 'application/pdf'
  } else {
    const wb = XLSX.utils.book_new()
    const cab = [`Demonstração do Resultado (DRE) — ${agency.nome}`, `${periodo} · regime de caixa · valores em R$${parcial ? ' · último mês parcial' : ''}`]
    XLSX.utils.book_append_sheet(wb, planilha(cab, meses, linhas, 'vr'), 'Realizado')
    XLSX.utils.book_append_sheet(wb, planilha([cab[0], `${periodo} · PREVISTO (em aberto) · valores em R$`], meses, linhas, 'vp'), 'Previsto')
    corpo = new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
    tipo = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }

  const ascii = nome.replace(/[^\x20-\x7E]/g, '_')
  return new Response(corpo, {
    headers: {
      'Content-Type': tipo,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      'Cache-Control': 'private, no-store',
    },
  })
}

/** Uma aba: números como NÚMERO (a contabilidade soma e confere), recuo no rótulo. */
function planilha(cab: string[], meses: string[], linhas: DreLinhaCalc[], campo: 'vr' | 'vp') {
  const recuo = (r: DreLinhaCalc) => {
    const k = r.line.kind
    if (k === 'sub') return r.line.code.split('.').length > 2 ? '    ' : '  '
    if (k === 'folha') return r.line.sub.split('.').length > 2 ? '      ' : '    '
    return ''
  }
  const linhasAoa = linhas.map(r => {
    const vals = meses.map(m => Math.round((r[campo][m] ?? 0) * 100) / 100)
    return [recuo(r) + rotuloDre(r.line), ...vals, Math.round(vals.reduce((a, v) => a + v, 0) * 100) / 100]
  })
  const ws = XLSX.utils.aoa_to_sheet([cab.slice(0, 1), cab.slice(1), [], ['Linha', ...meses.map(mesCurto), 'Total'], ...linhasAoa])
  const fmt = '#,##0.00;-#,##0.00;"–"'
  for (let r = 4; r < 4 + linhasAoa.length; r++) {
    for (let c = 1; c <= meses.length + 1; c++) {
      const cel = ws[XLSX.utils.encode_cell({ r, c })]
      if (cel) cel.z = fmt
    }
  }
  ws['!cols'] = [{ wch: 48 }, ...meses.map(() => ({ wch: 14 })), { wch: 15 }]
  return ws
}
