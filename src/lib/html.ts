// Helpers de texto a partir de HTML (comentários do TipTap são HTML).

export function stripHtml(s: string): string {
  return (s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Prévia de um comentário p/ listas: texto puro; se for só imagem, rotula. */
export function commentPreview(html: string): string {
  const text = stripHtml(html)
  if (text) return text
  if (/<img\b/i.test(html ?? '')) return '📷 Imagem'
  return ''
}
