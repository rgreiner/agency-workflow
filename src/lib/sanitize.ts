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
// Link no comentário/briefing SEMPRE abre em nova aba: o conteúdo vive dentro do
// modal da tarefa — sair na mesma aba perde o contexto (e o rascunho do
// comentário). O DOMPurify remove `target` por padrão, então reforçamos aqui,
// depois da sanitização; o `rel` fecha o tabnabbing que o `_blank` abriria.
let hooked = false
function forceBlankTarget() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.nodeName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer nofollow')
    }
  })
}

export function sanitizeHtml(dirty: string): string {
  forceBlankTarget()
  return DOMPurify.sanitize(dirty ?? '', {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
  })
}
