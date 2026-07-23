import 'server-only'
import {
  S3Client, PutObjectCommand, ListObjectsV2Command, CopyObjectCommand, DeleteObjectsCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import type { TaskFoldersResult, FolderFile } from '@/lib/google-drive'

/**
 * Pastas de tarefa no bucket S3 (Cloudflare R2) — o disco que o time monta como F:.
 * "Pasta" em S3 é um prefixo: criamos um marcador de zero bytes com a chave
 * terminando em "/" (Mountain Duck/Cyberduck exibem como pasta vazia).
 *
 * Diferença central pro Drive: AQUI O CAMINHO É A IDENTIDADE. Renomear/mover a
 * pasta no Finder quebra o vínculo salvo (no Drive o ID sobrevivia) — por isso o
 * Re-vincular continua existindo e importa mais.
 *
 * Init preguiçoso (nunca conectar no import): só falha quando uma função é
 * chamada sem as envs R2_* configuradas.
 */

const SUBFOLDERS = ['Final', 'Preview', 'Redação', 'Mockup', 'Links'] as const

let _s3: S3Client | null = null
function getS3(): S3Client {
  if (_s3) return _s3
  const endpoint = process.env.R2_ENDPOINT
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Storage S3 não configurado (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY).')
  }
  // O painel do R2 mostra o endpoint SEM esquema; o SDK exige URL completa
  // (endpoint cru = `TypeError: Invalid URL` no primeiro uso). Normaliza aqui
  // pra env colada do painel funcionar dos dois jeitos.
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`
  _s3 = new S3Client({ region: 'auto', endpoint: url, credentials: { accessKeyId, secretAccessKey } })
  return _s3
}

function bucket(): string {
  return process.env.R2_BUCKET || 'oneaone-clientes'
}

export function s3Configured(): boolean {
  return !!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
}

/**
 * Normaliza um caminho colado pelo usuário pro formato do bucket:
 * "F:\IMDM\2026" → "IMDM/2026". Aceita caminho com / ou \, com ou sem letra de
 * unidade, e ignora barras duplicadas/finais.
 */
export function normalizeFolderPath(input: string): string {
  return input.trim()
    .replace(/^[A-Za-z]:[\\/]+/, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim()
}

/** Caminho no formato local (barras invertidas) — casa com joinLocalPath/MachinePath. */
const toWinPath = (path: string) => path.replace(/\//g, '\\')

/** Existe QUALQUER objeto sob este prefixo? (pasta com conteúdo ou só o marcador) */
async function folderExists(path: string): Promise<boolean> {
  const r = await getS3().send(new ListObjectsV2Command({
    Bucket: bucket(), Prefix: `${path}/`, MaxKeys: 1,
  }))
  return (r.KeyCount ?? 0) > 0
}

/** Garante o marcador de pasta (idempotente). */
async function ensureFolder(path: string): Promise<{ id: string; link: string }> {
  if (!(await folderExists(path))) {
    await getS3().send(new PutObjectCommand({
      Bucket: bucket(), Key: `${path}/`, Body: new Uint8Array(0), ContentType: 'application/x-directory',
    }))
  }
  return { id: path, link: '' }
}

/**
 * Cria a pasta da tarefa + subpastas dentro do caminho da campanha.
 * S3 não permite duas pastas homônimas no mesmo nível (o caminho é único), então
 * `forceNew` vira: se o caminho já existe, cria com sufixo " (2)", " (3)"…
 */
export async function createTaskFoldersS3(
  campaignPath: string,
  taskName: string,
  opts?: { forceNew?: boolean },
): Promise<TaskFoldersResult> {
  const safeName = taskName.trim().replace(/[\\/]/g, '-') || 'Tarefa'
  let path = `${campaignPath}/${safeName}`
  if (opts?.forceNew) {
    for (let n = 2; (await folderExists(path)) && n <= 50; n++) {
      path = `${campaignPath}/${safeName} (${n})`
    }
  }
  const task = await ensureFolder(path)
  const sub: Record<string, { id: string; link: string }> = {}
  for (const name of SUBFOLDERS) {
    sub[name] = await ensureFolder(`${path}/${name}`)
  }
  return { taskFolderId: task.id, taskFolderLink: '', sub, drivePath: toWinPath(path) }
}

/** Lista as subpastas (1 nível) de um caminho. Pagina tudo. */
export async function listSubfoldersS3(parentPath: string): Promise<{ id: string; name: string; link: string }[]> {
  const prefix = parentPath ? `${parentPath}/` : ''
  const out: { id: string; name: string; link: string }[] = []
  let token: string | undefined
  do {
    const r = await getS3().send(new ListObjectsV2Command({
      Bucket: bucket(), Prefix: prefix, Delimiter: '/', ContinuationToken: token,
    }))
    for (const p of r.CommonPrefixes ?? []) {
      if (!p.Prefix) continue
      const path = p.Prefix.replace(/\/$/, '')
      const name = path.slice(prefix.length)
      if (name) out.push({ id: path, name, link: '' })
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt'))
}

/** Extensão → mime, pro que o portal do cliente precisa exibir. */
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
  mp3: 'audio/mpeg', wav: 'audio/wav',
}
export const mimeFromKey = (key: string) =>
  MIME_BY_EXT[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'

/** Lista os ARQUIVOS (1 nível, sem marcadores de pasta) de um prefixo. */
export async function listFolderFilesS3(folderPath: string): Promise<FolderFile[]> {
  const prefix = `${folderPath}/`
  const out: FolderFile[] = []
  let token: string | undefined
  do {
    const r = await getS3().send(new ListObjectsV2Command({
      Bucket: bucket(), Prefix: prefix, Delimiter: '/', ContinuationToken: token,
    }))
    for (const o of r.Contents ?? []) {
      if (!o.Key || o.Key.endsWith('/')) continue // marcador de pasta
      const name = o.Key.slice(prefix.length)
      if (!name) continue
      out.push({ ref: o.Key, name, mime: mimeFromKey(name), size: Number(o.Size ?? 0) })
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt', { numeric: true }))
}

/** Baixa um objeto do bucket pela chave. */
export async function readFolderFileS3(key: string): Promise<{ buffer: Buffer; mime: string; name: string }> {
  const r = await getS3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
  const bytes = await r.Body!.transformToByteArray()
  const name = key.split('/').pop() || 'arquivo'
  return { buffer: Buffer.from(bytes), mime: r.ContentType && r.ContentType !== 'application/octet-stream' ? r.ContentType : mimeFromKey(name), name }
}

/** Cria as subpastas padrão que faltarem numa pasta de tarefa existente. */
export async function completarSubpastasS3(taskPath: string): Promise<{ criadas: string[] }> {
  const existentes = await listSubfoldersS3(taskPath)
  const criadas: string[] = []
  for (const name of SUBFOLDERS) {
    const achou = existentes.find(s => s.name.trim().toLowerCase() === name.toLowerCase())
    if (achou) continue
    await ensureFolder(`${taskPath}/${name}`)
    criadas.push(name)
  }
  return { criadas }
}

/** Descobre (sem criar) uma pasta de tarefa existente: subpastas presentes e caminho. */
export async function inspectTaskFolderS3(taskPath: string): Promise<TaskFoldersResult> {
  const subList = await listSubfoldersS3(taskPath)
  const sub: Record<string, { id: string; link: string }> = {}
  for (const name of SUBFOLDERS) {
    const found = subList.find(s => s.name.trim().toLowerCase() === name.toLowerCase())
    if (found) sub[name] = { id: found.id, link: '' }
  }
  return { taskFolderId: taskPath, taskFolderLink: '', sub, drivePath: toWinPath(taskPath) }
}

/** Lista TODAS as chaves sob um prefixo (paginado). */
async function listAllKeys(prefix: string): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined
  do {
    const r = await getS3().send(new ListObjectsV2Command({
      Bucket: bucket(), Prefix: prefix, ContinuationToken: token,
    }))
    for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key)
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  return keys
}

async function deleteKeys(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await getS3().send(new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: keys.slice(i, i + 1000).map(Key => ({ Key })), Quiet: true },
    }))
  }
}

/**
 * "Move" a pasta da tarefa pra outro caminho de campanha: em S3 é copiar chave a
 * chave e apagar o original. Tudo-ou-nada: se alguma cópia falhar (ex.: arquivo
 * acima do limite de CopyObject), desfaz o que copiou e lança — o original fica
 * intacto. Retorna o novo caminho local (drivePath).
 */
export async function moveTaskFolderS3(taskPath: string, newCampaignPath: string): Promise<{ drivePath: string; newPath: string }> {
  const base = taskPath.split('/').pop() || 'Tarefa'
  let destPath = `${newCampaignPath}/${base}`
  if (destPath === taskPath) return { drivePath: toWinPath(taskPath), newPath: taskPath }
  for (let n = 2; (await folderExists(destPath)) && n <= 50; n++) {
    destPath = `${newCampaignPath}/${base} (${n})`
  }

  const oldKeys = await listAllKeys(`${taskPath}/`)
  if (oldKeys.length === 0) {
    await ensureFolder(destPath)
    return { drivePath: toWinPath(destPath), newPath: destPath }
  }

  const copied: string[] = []
  try {
    for (const key of oldKeys) {
      const newKey = `${destPath}/${key.slice(`${taskPath}/`.length)}`
      await getS3().send(new CopyObjectCommand({
        Bucket: bucket(),
        Key: newKey,
        CopySource: `${bucket()}/${encodeURIComponent(key).replace(/%2F/g, '/')}`,
      }))
      copied.push(newKey)
    }
  } catch (e) {
    await deleteKeys(copied).catch(() => { /* rollback de melhor esforço */ })
    throw e
  }
  await deleteKeys(oldKeys)
  return { drivePath: toWinPath(destPath), newPath: destPath }
}
