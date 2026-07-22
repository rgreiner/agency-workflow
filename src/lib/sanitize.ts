import DOMPurify from 'isomorphic-dompurify'

/**
 * Sanitiza HTML de rich-text (Tiptap) antes de renderizar com
 * dangerouslySetInnerHTML. Chokepoint único do XSS armazenado: briefing e
 * comentários guardam HTML cru no banco, então TODO render passa por aqui —
 * cobre dado novo e o legado. Funciona no SSR e no client (isomorphic).
 *
 * Usa o profile HTML padrão do DOMPurify (preserva toda a saída do editor:
 * formatação, listas de tarefas, imagens, @menção com data-*), que já remove os
 * vetores de XSS: handlers `on*`, URIs `javascript:`/`data:` executáveis,
 * <script>/<style>. Reforço explícito contra tags de embed.
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty ?? '', {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
  })
}
