'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'
import { provisionActivitiesDrive } from '@/lib/drive-provision'
import { logSystemError } from '@/lib/system-error'

export interface SpecRow {
  title: string
  dueDate: string | null   // YYYY-MM-DD
  briefing: string
}

// ── CSV parser (trata aspas e campos com várias linhas) ─────────────────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += c
    } else {
      if (c === '"') q = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (c === '\r') { /* ignora */ }
      else field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')

type Cols = { platform: number; peca: number; fase: number; tamanho: number; espec: number; obs: number; prazo: number; job: number }

function isHeader(cells: string[]): boolean {
  const n = cells.map(norm)
  return n.some(c => c.includes('peca')) && n.some(c => c.includes('plataforma') || c.includes('veiculo'))
}

function mapCols(cells: string[]): Cols {
  const c: Cols = { platform: -1, peca: -1, fase: -1, tamanho: -1, espec: -1, obs: -1, prazo: -1, job: -1 }
  cells.forEach((h, i) => {
    const n = norm(h)
    if (c.platform < 0 && (n.includes('plataforma') || n.includes('veiculo'))) c.platform = i
    if (c.peca < 0 && n.includes('peca')) c.peca = i
    if (c.fase < 0 && n.includes('funil')) c.fase = i
    if (c.tamanho < 0 && n.includes('tamanho')) c.tamanho = i
    if (c.espec < 0 && n.includes('especific')) c.espec = i
    if (c.obs < 0 && /\bobs\b/.test(n)) c.obs = i
    if (c.prazo < 0 && (n.includes('prazo') || n === 'data')) c.prazo = i
    if (c.job < 0 && (n.includes('job') || n.includes('link'))) c.job = i
  })
  return c
}

function parseDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (!m) return null
  const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0')
  const y = m[3].length === 2 ? '20' + m[3] : m[3]
  return `${y}-${mo}-${d}`
}
const yymmdd = (iso: string) => { const [y, m, d] = iso.split('-'); return `${y.slice(2)}${m}${d}` }

function rowsToSpecs(grid: string[][]): SpecRow[] {
  const out: SpecRow[] = []
  let cols: Cols | null = null
  for (const cells of grid) {
    if (isHeader(cells)) { cols = mapCols(cells); continue }
    if (!cols) continue
    const g = (i: number) => (i >= 0 && i < cells.length ? cells[i].trim() : '')
    const platform = g(cols.platform), peca = g(cols.peca), fase = g(cols.fase)
    const tamanho = g(cols.tamanho), espec = g(cols.espec), obs = g(cols.obs)
    const prazo = g(cols.prazo), job = g(cols.job)
    if (!peca && !espec && !platform && !tamanho) continue   // linha vazia

    const due = parseDate(prazo)
    const title = [due ? yymmdd(due) : '', platform, fase, peca].filter(Boolean).join(' - ')

    const parts: string[] = []
    if (tamanho) parts.push(`Tamanho:\n${tamanho}`)
    if (espec) parts.push(`Especificações:\n${espec}`)
    if (obs) parts.push(`OBS:\n${obs}`)
    if (job) parts.push(`Job (ref): ${job}`)

    out.push({ title: title || peca || 'Sem título', dueDate: due, briefing: parts.join('\n\n') })
  }
  return out
}

// ── Lê o link do Google (CSV export público) e devolve a prévia ─────────────
export async function parseSpecsSheet(sheetUrl: string): Promise<{ rows: SpecRow[] } | { error: string }> {
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const id = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1]
  if (!id) return { error: 'Link inválido — cole o link da planilha do Google Sheets.' }
  const gid = sheetUrl.match(/[?&#]gid=(\d+)/)?.[1]

  // monto a URL de export eu mesmo (evita SSRF — só docs.google.com export)
  const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`

  let text: string
  try {
    const res = await fetch(exportUrl, { redirect: 'follow' })
    text = await res.text()
    const ct = res.headers.get('content-type') ?? ''
    if (!res.ok || ct.includes('text/html') || text.startsWith('<!DOCTYPE')) {
      return { error: 'Não consegui acessar a planilha. Deixe-a como "qualquer pessoa com o link: Leitor" e tente de novo.' }
    }
  } catch (e) {
    const supabase = await createClient()
    await logSystemError(supabase, { userId: user.id, context: 'import:specs', error: e })
    return { error: 'Falha ao buscar a planilha. Verifique o link e o compartilhamento.' }
  }

  const rows = rowsToSpecs(parseCSV(text))
  if (rows.length === 0) return { error: 'Nenhuma linha reconhecida. Confira se a aba tem as colunas (Plataforma/Veículo, Peça, Prazo…).' }
  return { rows }
}

// ── Cria as atividades em lote dentro da campanha ───────────────────────────
export async function createActivitiesFromSpecs(orgSlug: string, campaignId: string, items: SpecRow[]) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }

  const valid = items.filter(i => i.title?.trim())
  if (valid.length === 0) return { error: 'Nenhuma atividade selecionada.' }

  const created: { activityId: string; title: string }[] = []
  for (let i = 0; i < valid.length; i += 6) {
    const batch = valid.slice(i, i + 6)
    const res = await Promise.all(batch.map(it =>
      supabase.rpc('create_activity', {
        p_user_id: user.id,
        p_campaign_id: campaignId,
        p_title: it.title.trim(),
        p_description: it.briefing ?? '',
        p_status: 'briefing',
        p_priority: 'medium',
        p_complexity: 'medium',
        p_due_date: it.dueDate ?? null,
        p_estimated_hours: null,
        p_start_date: null,
      }).then(r => ({ error: r.error, id: r.data as string | null, title: it.title.trim() }))))
    const err = res.find(r => r.error)?.error
    if (err) return { error: err.message }
    for (const r of res) if (r.id) created.push({ activityId: r.id, title: r.title })
  }

  // Cria as pastas no Drive em 2º plano (se a campanha tiver pasta vinculada)
  await provisionActivitiesDrive(supabase, { campaignId, userId: user.id, items: created })

  revalidatePath('/', 'layout')
  return { created: valid.length }
}
