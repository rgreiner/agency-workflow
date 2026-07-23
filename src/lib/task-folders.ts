import 'server-only'
import * as drive from '@/lib/google-drive'
import * as s3 from '@/lib/s3-folders'

/**
 * Fachada do robô de pastas de tarefa — provider trocável pela chave presente no
 * ambiente (R2_* → S3/disco novo; senão GOOGLE_SERVICE_ACCOUNT_KEY → Drive).
 * Todo o app fala com ESTE módulo; google-drive.ts/s3-folders.ts são detalhe.
 *
 * A "referência" de pasta (campanha ou tarefa) é uma string cujo formato depende
 * do provider: ID do Drive OU caminho no bucket ("IMDM/2026/Institucional").
 */

export type { TaskFoldersResult } from '@/lib/google-drive'

export type FolderProvider = 's3' | 'drive'

export function folderProvider(): FolderProvider | null {
  if (s3.s3Configured()) return 's3'
  if (drive.driveConfigured()) return 'drive'
  return null
}

export function folderConfigured(): boolean {
  return folderProvider() !== null
}

/** Prefixo padrão do caminho local por provider (org_settings.drive_path_prefix sobrepõe). */
export function defaultPathPrefix(): string {
  return folderProvider() === 's3' ? 'F:\\' : 'G:\\Drives compartilhados\\'
}

/**
 * Com o S3 ativo, um prefixo da era Drive salvo na org ("G:\Drives compartilhados\")
 * não vale mais — cai no padrão do disco novo sem precisar reconfigurar a org.
 */
export function resolvePathPrefix(orgPrefix: string | null | undefined): string {
  if (!orgPrefix) return defaultPathPrefix()
  if (folderProvider() === 's3' && /compartilhad|google/i.test(orgPrefix)) return defaultPathPrefix()
  return orgPrefix
}

/** Parece um ID de pasta do Drive (e não um caminho de bucket)? */
const looksLikeDriveId = (ref: string) => /^[a-zA-Z0-9_-]{20,}$/.test(ref) && !ref.includes('/') && !ref.includes(' ')

/**
 * Vínculo antigo do Drive numa campanha com o S3 ativo: erro claro em vez de
 * criar uma pasta-lixo com o nome do ID na raiz do bucket.
 */
function assertRefForProvider(ref: string): void {
  if (folderProvider() === 's3' && looksLikeDriveId(ref)) {
    throw new Error('Esta campanha ainda aponta pra pasta antiga do Drive — edite a campanha e cole o caminho novo (F:\\…).')
  }
}

/**
 * Normaliza o que a pessoa colou no campo "pasta" da campanha:
 * - Drive: link ou ID puro → ID.
 * - S3: caminho "F:\Cliente\2026\Projeto" (ou com /) → "Cliente/2026/Projeto".
 */
export function extractCampaignFolderRef(input: string | null): string | null {
  const s = (input ?? '').trim()
  if (!s) return null
  if (folderProvider() === 's3') {
    // Se colaram um link do Drive por costume, não vira caminho válido.
    if (/drive\.google\.com/.test(s)) return null
    return s3.normalizeFolderPath(s) || null
  }
  const m = s.match(/\/folders\/([a-zA-Z0-9-_]+)/) || s.match(/[?&]id=([a-zA-Z0-9-_]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s
  return null
}

export async function createTaskFolders(
  campaignRef: string, taskName: string, opts?: { forceNew?: boolean },
): Promise<drive.TaskFoldersResult> {
  assertRefForProvider(campaignRef)
  return folderProvider() === 's3'
    ? s3.createTaskFoldersS3(campaignRef, taskName, opts)
    : drive.createTaskFolders(campaignRef, taskName, opts)
}

export async function listSubfolders(parentRef: string): Promise<{ id: string; name: string; link: string }[]> {
  assertRefForProvider(parentRef)
  return folderProvider() === 's3' ? s3.listSubfoldersS3(parentRef) : drive.listSubfolders(parentRef)
}

export async function inspectTaskFolder(taskRef: string): Promise<drive.TaskFoldersResult> {
  assertRefForProvider(taskRef)
  return folderProvider() === 's3' ? s3.inspectTaskFolderS3(taskRef) : drive.inspectTaskFolder(taskRef)
}

export async function completarSubpastas(taskRef: string): Promise<{ criadas: string[] }> {
  assertRefForProvider(taskRef)
  return folderProvider() === 's3' ? s3.completarSubpastasS3(taskRef) : drive.completarSubpastas(taskRef)
}

/**
 * Move a pasta da tarefa pra outra campanha. No S3 o caminho MUDA (é a
 * identidade) — devolve `newRef` pra regravar o vínculo; no Drive o ID sobrevive
 * e `newRef` vem null (mantém o que está salvo).
 */
export async function moveTaskFolder(taskRef: string, newParentRef: string): Promise<{ drivePath: string; newRef: string | null }> {
  assertRefForProvider(taskRef)
  assertRefForProvider(newParentRef)
  if (folderProvider() === 's3') {
    const r = await s3.moveTaskFolderS3(taskRef, newParentRef)
    return { drivePath: r.drivePath, newRef: r.newPath }
  }
  const r = await drive.moveTaskFolder(taskRef, newParentRef)
  return { drivePath: r.drivePath, newRef: null }
}
