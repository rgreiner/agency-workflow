import 'server-only'
import { google, type drive_v3 } from 'googleapis'

/**
 * Cliente de Drive via conta de serviço (env GOOGLE_SERVICE_ACCOUNT_KEY — JSON
 * em base64 ou cru). Init preguiçoso: importar este módulo nunca quebra; só
 * falha quando uma função é chamada sem a chave configurada.
 */

const SUBFOLDERS = ['Final', 'Preview', 'Redação', 'Mockup', 'Links'] as const

function parseCreds(raw: string): { client_email: string; private_key: string } {
  const txt = raw.trim()
  try { return JSON.parse(txt) } catch { /* tenta base64 */ }
  try { return JSON.parse(Buffer.from(txt, 'base64').toString('utf8')) } catch { /* inválida */ }
  throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY inválida (esperado JSON ou base64).')
}

let _drive: drive_v3.Drive | null = null
function getDrive(): drive_v3.Drive {
  if (_drive) return _drive
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) throw new Error('Integração com o Drive não configurada (GOOGLE_SERVICE_ACCOUNT_KEY).')
  const creds = parseCreds(raw)
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  _drive = google.drive({ version: 'v3', auth })
  return _drive
}

export function driveConfigured(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY
}

export const folderLink = (id: string) => `https://drive.google.com/drive/folders/${id}`

/** Extrai o ID de pasta de um link do Drive (ou devolve a própria string se já for um ID). */
export function extractFolderId(input: string): string | null {
  const s = input.trim()
  const m = s.match(/\/folders\/([a-zA-Z0-9-_]+)/) || s.match(/[?&]id=([a-zA-Z0-9-_]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s
  return null
}

async function findFolder(parentId: string, name: string): Promise<string | null> {
  const drive = getDrive()
  const q = `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const r = await drive.files.list({
    q, fields: 'files(id)', pageSize: 1,
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  return r.data.files?.[0]?.id ?? null
}

/** Cria a pasta (ou reusa se já existir uma com o mesmo nome no pai). */
async function ensureFolder(parentId: string, name: string): Promise<{ id: string; link: string }> {
  const existing = await findFolder(parentId, name)
  if (existing) return { id: existing, link: folderLink(existing) }
  const drive = getDrive()
  const res = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  })
  const id = res.data.id!
  return { id, link: res.data.webViewLink ?? folderLink(id) }
}

/** Reconstrói o caminho da pasta no Drive (ex.: "Clientes\One a One\2026\Institucional\<tarefa>"). */
async function buildDrivePath(folderId: string): Promise<string> {
  const drive = getDrive()
  const parts: string[] = []
  let cur: string | undefined = folderId
  let driveId: string | undefined
  let guard = 0
  while (cur && guard++ < 30) {
    const data: drive_v3.Schema$File =
      (await drive.files.get({ fileId: cur, fields: 'id, name, parents, driveId', supportsAllDrives: true })).data
    driveId = data.driveId ?? driveId
    if (driveId && data.id === driveId) break   // raiz do Drive Compartilhado (nome vem do drives.get)
    if (data.name) parts.unshift(data.name)
    cur = data.parents?.[0]
  }
  // Nome canônico do Drive Compartilhado (a raiz via files.get às vezes volta como "Drive")
  if (driveId) {
    try {
      const d = (await drive.drives.get({ driveId, fields: 'name' })).data
      if (d.name) parts.unshift(d.name)
    } catch { /* sem permissão de listar o drive — ignora */ }
  }
  return parts.join('\\')
}

export interface TaskFoldersResult {
  taskFolderId: string
  taskFolderLink: string
  sub: Record<string, { id: string; link: string }>
  drivePath: string   // caminho relativo no Drive (sem o prefixo local)
}

/** Cria a pasta da tarefa + subpastas dentro da pasta da campanha. Idempotente. */
export async function createTaskFolders(campaignFolderId: string, taskName: string): Promise<TaskFoldersResult> {
  const safeName = taskName.trim().replace(/[\\/:*?"<>|]/g, '-') || 'Tarefa'
  const task = await ensureFolder(campaignFolderId, safeName)
  const sub: Record<string, { id: string; link: string }> = {}
  for (const name of SUBFOLDERS) {
    sub[name] = await ensureFolder(task.id, name)
  }
  const drivePath = await buildDrivePath(task.id)
  return { taskFolderId: task.id, taskFolderLink: task.link, sub, drivePath }
}

/**
 * Move (reparenta) a pasta da tarefa pra dentro de outra pasta de campanha.
 * No Drive, reparentar leva TODO o conteúdo junto (subpastas/arquivos/links) e o
 * ID da pasta não muda — então os links já salvos na tarefa seguem válidos.
 * Retorna o novo caminho local (drivePath) pra atualizar na atividade.
 */
export async function moveTaskFolder(taskFolderId: string, newParentId: string): Promise<{ drivePath: string }> {
  const drive = getDrive()
  const cur = (await drive.files.get({ fileId: taskFolderId, fields: 'parents', supportsAllDrives: true })).data
  const removeParents = (cur.parents ?? []).join(',')
  await drive.files.update({
    fileId: taskFolderId,
    addParents: newParentId,
    removeParents: removeParents || undefined,
    fields: 'id, parents',
    supportsAllDrives: true,
  })
  const drivePath = await buildDrivePath(taskFolderId)
  return { drivePath }
}

// ── Leitura de conteúdo (revisão de Redação) ────────────────────────────────

const DOC_MIME    = 'application/vnd.google-apps.document'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Exporta um Google Doc como texto puro. */
async function exportDocText(fileId: string): Promise<string> {
  const drive = getDrive()
  const r = await drive.files.export({ fileId, mimeType: 'text/plain' }, { responseType: 'text' })
  return typeof r.data === 'string' ? r.data : String(r.data ?? '')
}

/**
 * Lê o texto do entregável de Redação a partir do link (Doc único OU pasta).
 * - Link de Doc do Google → exporta o texto dele.
 * - Link de pasta → exporta todos os Google Docs dentro dela.
 * Outros tipos de arquivo são ignorados. Retorna o texto concatenado + os nomes.
 */
export async function readRedacaoText(link: string): Promise<{ text: string; sources: string[] }> {
  const id = extractFolderId(link)   // mesma regex serve p/ ?id= de arquivo e /folders/
  if (!id) return { text: '', sources: [] }
  const drive = getDrive()

  const meta = (await drive.files.get({
    fileId: id, fields: 'id, name, mimeType', supportsAllDrives: true,
  })).data

  // Arquivo único
  if (meta.mimeType !== FOLDER_MIME) {
    if (meta.mimeType !== DOC_MIME) return { text: '', sources: [] }
    const text = await exportDocText(id)
    return { text, sources: meta.name ? [meta.name] : [] }
  }

  // Pasta: exporta cada Google Doc lá dentro
  const r = await drive.files.list({
    q: `'${id}' in parents and mimeType = '${DOC_MIME}' and trashed = false`,
    fields: 'files(id, name)', pageSize: 50, orderBy: 'name',
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  const files = r.data.files ?? []
  const parts: string[] = []
  const sources: string[] = []
  for (const f of files) {
    if (!f.id) continue
    const t = await exportDocText(f.id)
    if (t.trim()) { parts.push(`### ${f.name ?? 'Documento'}\n${t}`); sources.push(f.name ?? 'Documento') }
  }
  return { text: parts.join('\n\n'), sources }
}

// ── Leitura de peças (revisão multimodal: imagens / PDF) ────────────────────

const PDF_MIME    = 'application/pdf'
const SLIDES_MIME = 'application/vnd.google-apps.presentation'
const IMAGE_MIME_RE = /^image\/(png|jpe?g|webp|gif)$/i

// Limites p/ controlar custo/latência e ficar abaixo dos tetos das APIs de visão.
// base64 infla ~33%, então 12MB de binário ≈ 16MB no corpo do request (Gemini
// inline aceita ~20MB de request total).
const MAX_ASSETS      = 12
const MAX_FILE_BYTES  = 6  * 1024 * 1024
const MAX_TOTAL_BYTES = 12 * 1024 * 1024

export interface DriveAsset {
  name: string
  mimeType: string   // image/png | image/jpeg | application/pdf
  base64: string
}

function isReviewable(mime: string): boolean {
  return IMAGE_MIME_RE.test(mime) || mime === PDF_MIME || mime === SLIDES_MIME
}

async function downloadBase64(fileId: string): Promise<{ base64: string; bytes: number }> {
  const drive = getDrive()
  const r = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  )
  const buf = Buffer.from(r.data as ArrayBuffer)
  return { base64: buf.toString('base64'), bytes: buf.length }
}

async function exportBase64(fileId: string, mimeType: string): Promise<{ base64: string; bytes: number }> {
  const drive = getDrive()
  const r = await drive.files.export({ fileId, mimeType }, { responseType: 'arraybuffer' })
  const buf = Buffer.from(r.data as ArrayBuffer)
  return { base64: buf.toString('base64'), bytes: buf.length }
}

/**
 * Baixa as peças (imagens / PDF; Google Slides é exportado como PDF) de um link
 * do Drive — arquivo único OU pasta — em base64, p/ revisão por visão. Ignora o
 * que não for imagem/PDF/apresentação. Respeita limites de quantidade/tamanho.
 */
export async function readReviewAssets(link: string): Promise<{ assets: DriveAsset[]; truncated: boolean }> {
  const id = extractFolderId(link)
  if (!id) return { assets: [], truncated: false }
  const drive = getDrive()

  const meta = (await drive.files.get({
    fileId: id, fields: 'id, name, mimeType', supportsAllDrives: true,
  })).data

  const candidates: { id: string; name: string; mimeType: string }[] = []
  if (meta.mimeType === FOLDER_MIME) {
    let pageToken: string | undefined
    do {
      const r: drive_v3.Schema$FileList = (await drive.files.list({
        q: `'${id}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType)',
        pageSize: 200, orderBy: 'name',
        supportsAllDrives: true, includeItemsFromAllDrives: true, pageToken,
      })).data
      for (const f of r.files ?? []) {
        if (f.id && f.mimeType && isReviewable(f.mimeType)) candidates.push({ id: f.id, name: f.name ?? '', mimeType: f.mimeType })
      }
      pageToken = r.nextPageToken ?? undefined
    } while (pageToken)
  } else if (meta.id && meta.mimeType && isReviewable(meta.mimeType)) {
    candidates.push({ id: meta.id, name: meta.name ?? '', mimeType: meta.mimeType })
  }

  let truncated = candidates.length > MAX_ASSETS
  const limited = candidates.slice(0, MAX_ASSETS)

  const assets: DriveAsset[] = []
  let total = 0
  for (const c of limited) {
    try {
      const isSlides = c.mimeType === SLIDES_MIME
      const data = isSlides ? await exportBase64(c.id, PDF_MIME) : await downloadBase64(c.id)
      if (data.bytes > MAX_FILE_BYTES) { truncated = true; continue }
      if (total + data.bytes > MAX_TOTAL_BYTES) { truncated = true; break }
      total += data.bytes
      assets.push({ name: c.name, mimeType: isSlides ? PDF_MIME : c.mimeType, base64: data.base64 })
    } catch (e) {
      console.error('[drive] download de peça falhou:', c.name, e)
    }
  }
  return { assets, truncated }
}

// ── Reconciliação campanha ↔ Drive ──────────────────────────────────────────

/** Lista as subpastas (1 nível) de uma pasta. Pagina tudo. */
export async function listSubfolders(parentId: string): Promise<{ id: string; name: string; link: string }[]> {
  const drive = getDrive()
  const out: { id: string; name: string; link: string }[] = []
  let pageToken: string | undefined
  do {
    const r: drive_v3.Schema$FileList = (await drive.files.list({
      q: `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'nextPageToken, files(id, name, webViewLink)',
      pageSize: 200, orderBy: 'name',
      supportsAllDrives: true, includeItemsFromAllDrives: true,
      pageToken,
    })).data
    for (const f of r.files ?? []) {
      if (f.id) out.push({ id: f.id, name: f.name ?? '', link: f.webViewLink ?? folderLink(f.id) })
    }
    pageToken = r.nextPageToken ?? undefined
  } while (pageToken)
  return out
}

/** Descobre (sem criar) uma pasta de tarefa já existente: link, subpastas presentes e caminho. */
export async function inspectTaskFolder(folderId: string): Promise<TaskFoldersResult> {
  const subList = await listSubfolders(folderId)
  const sub: Record<string, { id: string; link: string }> = {}
  for (const name of SUBFOLDERS) {
    const found = subList.find(s => s.name.trim().toLowerCase() === name.toLowerCase())
    if (found) sub[name] = { id: found.id, link: found.link }
  }
  const drivePath = await buildDrivePath(folderId)
  return { taskFolderId: folderId, taskFolderLink: folderLink(folderId), sub, drivePath }
}
