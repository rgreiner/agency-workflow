/**
 * Upload de arquivo a partir do browser → rota server (/api/upload) → volume
 * no VPS. Substitui o `supabase.storage.from(...).upload()` + getPublicUrl.
 * Devolve a URL pública (absoluta) pra guardar no banco.
 */
export async function uploadFile(bucket: string, path: string, file: File): Promise<string> {
  const form = new FormData()
  form.append('bucket', bucket)
  form.append('path', path)
  form.append('file', file)

  const res = await fetch('/api/upload', { method: 'POST', body: form })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Falha no upload')
  }
  const { url } = await res.json()
  return url as string
}
