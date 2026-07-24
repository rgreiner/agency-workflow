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

/** Prefixo padrão do caminho local por backend (org_settings.drive_path_prefix sobrepõe). */
export function defaultPathPrefix(backend: FolderProvider = folderProvider() ?? 'drive'): string {
  return backend === 's3' ? 'F:\\' : 'G:\\Drives compartilhados\\'
}

/**
 * Prefixo do caminho local pra este backend. Um prefixo salvo pra Drive
 * ("G:\Drives compartilhados\") não vale numa referência S3 e vice-versa —
 * durante a transição as duas coexistem, então o backend manda.
 */
export function resolvePathPrefix(orgPrefix: string | null | undefined, backend: FolderProvider = folderProvider() ?? 'drive'): string {
  if (backend === 's3') {
    // Prefixo da era Drive não serve pro disco novo → cai no F:\ padrão.
    if (!orgPrefix || /compartilhad|google/i.test(orgPrefix)) return defaultPathPrefix('s3')
    return orgPrefix
  }
  return orgPrefix || defaultPathPrefix('drive')
}

/** Parece um ID de pasta do Drive (e não um caminho de bucket)? */
const looksLikeDriveId = (ref: string) => /^[a-zA-Z0-9_-]{20,}$/.test(ref) && !ref.includes('/') && !ref.includes(' ')

/**
 * Backend de UMA referência existente pelo formato dela — NÃO pelo modo global.
 * É o coração da transição: uma campanha com ID do Drive continua no Drive
 * mesmo com o S3 ativo; um caminho "IMDM/2026/…" vai pro S3. Assim a virada é
 * gradual (re-vincula campanha por campanha) em vez de um flip que quebra todas.
 */
export function backendForRef(ref: string): FolderProvider {
  return looksLikeDriveId(ref) ? 'drive' : 's3'
}

/**
 * Normaliza o que a pessoa colou no campo "pasta" da campanha — por CONTEÚDO,
 * aceitando os dois formatos ao mesmo tempo (durante a transição o time pode
 * colar link do Drive OU caminho F:\ do disco novo):
 * - Link/ID do Drive → ID.
 * - Caminho "F:\Cliente\2026\Projeto" (ou com /) → "Cliente/2026/Projeto".
 */
export function extractCampaignFolderRef(input: string | null): string | null {
  const s = (input ?? '').trim()
  if (!s) return null
  // Link do Drive (com /folders/<id> ou ?id=<id>)
  const m = s.match(/\/folders\/([a-zA-Z0-9-_]+)/) || s.match(/[?&]id=([a-zA-Z0-9-_]+)/)
  if (m) return m[1]
  // Um link do Drive que não deu pra extrair o id → inválido (não vira caminho).
  if (/drive\.google\.com/i.test(s)) return null
  // ID puro do Drive.
  if (looksLikeDriveId(s)) return s
  // Senão, caminho do bucket (disco novo).
  return s3.normalizeFolderPath(s) || null
}

export async function createTaskFolders(
  campaignRef: string, taskName: string, opts?: { forceNew?: boolean },
): Promise<drive.TaskFoldersResult> {
  return backendForRef(campaignRef) === 's3'
    ? s3.createTaskFoldersS3(campaignRef, taskName, opts)
    : drive.createTaskFolders(campaignRef, taskName, opts)
}

export async function listSubfolders(parentRef: string): Promise<{ id: string; name: string; link: string }[]> {
  return backendForRef(parentRef) === 's3' ? s3.listSubfoldersS3(parentRef) : drive.listSubfolders(parentRef)
}

export async function inspectTaskFolder(taskRef: string): Promise<drive.TaskFoldersResult> {
  return backendForRef(taskRef) === 's3' ? s3.inspectTaskFolderS3(taskRef) : drive.inspectTaskFolder(taskRef)
}

/**
 * Peças da pasta **Preview** de uma tarefa — a base do ambiente de aprovação do
 * portal. A pasta **Final** (arquivo de impressão) NUNCA é exposta ao cliente.
 * Devolve [] se a tarefa não tem pasta ou não tem Preview.
 */
export async function listPreviewFiles(taskRef: string): Promise<drive.FolderFile[]> {
  const info = await inspectTaskFolder(taskRef)
  const preview = info.sub['Preview']
  if (!preview?.id) return []
  return backendForRef(preview.id) === 's3'
    ? s3.listFolderFilesS3(preview.id)
    : drive.listFolderFiles(preview.id)
}

/** Baixa uma peça pela ref devolvida por `listPreviewFiles`. */
export async function readFolderFile(fileRef: string): Promise<{ buffer: Buffer; mime: string; name: string }> {
  return backendForRef(fileRef) === 's3'
    ? s3.readFolderFileS3(fileRef)
    : drive.readFolderFile(fileRef)
}

export async function completarSubpastas(taskRef: string): Promise<{ criadas: string[] }> {
  return backendForRef(taskRef) === 's3' ? s3.completarSubpastasS3(taskRef) : drive.completarSubpastas(taskRef)
}

/**
 * Move a pasta da tarefa pra outra campanha. Roteia pelo backend do DESTINO. No
 * S3 o caminho MUDA (é a identidade) — devolve `newRef` pra regravar o vínculo;
 * no Drive o ID sobrevive e `newRef` vem null (mantém o que está salvo).
 */
export async function moveTaskFolder(taskRef: string, newParentRef: string): Promise<{ drivePath: string; newRef: string | null }> {
  if (backendForRef(newParentRef) === 's3') {
    const r = await s3.moveTaskFolderS3(taskRef, newParentRef)
    return { drivePath: r.drivePath, newRef: r.newPath }
  }
  const r = await drive.moveTaskFolder(taskRef, newParentRef)
  return { drivePath: r.drivePath, newRef: null }
}
