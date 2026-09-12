/**
 * Cliente das referências da tarefa (rota /api/activities/[id]/referencias):
 * arquivos que vão para a subpasta Links/ da pasta da tarefa. Usado no detalhe
 * da tarefa e no pedido da mídia.
 */
export interface Referencia { ref: string; name: string; mime: string; size: number; link?: string }

export const MAX_REFERENCIA_BYTES = 25 * 1024 * 1024

export async function listarReferencias(activityId: string): Promise<{ pronta: boolean; arquivos: Referencia[] }> {
  const res = await fetch(`/api/activities/${activityId}/referencias`, { cache: 'no-store' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Não deu para listar as referências.')
  return { pronta: !!body.pronta, arquivos: (body.arquivos ?? []) as Referencia[] }
}

/**
 * Sobe um arquivo. Com `esperarPasta`, um 409 "sem pasta" (a pasta ainda está
 * sendo criada em 2º plano, logo depois de a tarefa nascer) espera 3 s e tenta
 * de novo, até ~30 s.
 */
export async function enviarReferencia(
  activityId: string, file: File, opts: { esperarPasta?: boolean } = {},
): Promise<Referencia> {
  if (file.size > MAX_REFERENCIA_BYTES) throw new Error('Arquivo muito grande (máx. 25 MB).')
  const tentativas = opts.esperarPasta ? 10 : 1
  for (let i = 1; ; i++) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/activities/${activityId}/referencias`, { method: 'POST', body: form })
    const body = await res.json().catch(() => ({}))
    if (res.ok) return body.arquivo as Referencia
    if (res.status === 409 && body.semPasta && i < tentativas) {
      await new Promise(r => setTimeout(r, 3000))
      continue
    }
    throw new Error(body.error || 'Falha no envio.')
  }
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1).replace('.0', '')} MB`
}
