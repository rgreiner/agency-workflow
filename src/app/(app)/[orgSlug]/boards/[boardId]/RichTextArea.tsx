'use client'

import { useRef, useEffect } from 'react'

interface Props {
  html: string
  editing: boolean
  placeholder: string
  style: React.CSSProperties
  onStopEdit: (html: string) => void
}

/**
 * Editor de texto rico (contentEditable) usado por notas e blocos de texto.
 *
 * Formatação é por seleção (inline): negrito/itálico/sublinhado/cor valem só
 * no trecho selecionado — o toolbar dispara document.execCommand e ⌘B/⌘I/⌘U
 * funcionam nativamente. O conteúdo é salvo como HTML.
 *
 * Enquanto edita, o DOM é a fonte da verdade (não re-injetamos innerHTML a
 * cada tecla), então o cursor nunca "pula". Fora de edição, sincronizamos o
 * innerHTML com a prop.
 */
export function RichTextArea({ html, editing, placeholder, style, onStopEdit }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const lastHtml = useRef(html)

  // Entrar em edição: semeia o conteúdo atual e posiciona o cursor no fim.
  useEffect(() => {
    if (!editing || !ref.current) return
    const node = ref.current
    if (node.innerHTML !== html) node.innerHTML = html
    lastHtml.current = html
    requestAnimationFrame(() => {
      node.focus()
      const range = document.createRange()
      range.selectNodeContents(node)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fora de edição: mantém o DOM em sincronia com a prop.
  useEffect(() => {
    if (!editing && ref.current && ref.current.innerHTML !== html) {
      ref.current.innerHTML = html
    }
  }, [html, editing])

  // Salvar ao sair da edição, mesmo quando o blur não dispara.
  const wasEditing = useRef(false)
  useEffect(() => {
    if (!editing && wasEditing.current) onStopEdit(lastHtml.current)
    wasEditing.current = editing
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={ref}
      contentEditable={editing}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      className="board-richtext"
      onInput={() => { lastHtml.current = ref.current?.innerHTML ?? '' }}
      onBlur={() => onStopEdit(lastHtml.current)}
      onPointerDown={e => { if (editing) e.stopPropagation() }}
      onKeyDown={e => {
        // O canvas ignora eventos vindos de contentEditable (ver onKey em
        // BoardCanvas), então só tratamos o Escape aqui.
        if (e.key === 'Escape') { e.preventDefault(); ref.current?.blur() }
      }}
      style={style}
    />
  )
}
