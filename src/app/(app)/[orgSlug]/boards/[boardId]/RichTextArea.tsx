'use client'

import { useRef, useEffect } from 'react'

/**
 * Aplica um tamanho de fonte (px) só ao trecho selecionado do editor em foco,
 * via um span inline. Retorna false se não há seleção — aí quem chamou deve
 * redimensionar o bloco inteiro. Usa o truque font[size=7]→span (execCommand
 * só aceita os buckets 1–7, então trocamos pela medida real em px).
 */
export function applyInlineFontSize(px: number): boolean {
  const sel = window.getSelection()
  const editable = document.activeElement as HTMLElement | null
  if (!sel || sel.isCollapsed || !editable?.isContentEditable) return false
  document.execCommand('styleWithCSS', false, 'false')
  document.execCommand('fontSize', false, '7')
  editable.querySelectorAll('font[size="7"]').forEach(f => {
    const span = document.createElement('span')
    span.style.fontSize = `${px}px`
    while (f.firstChild) span.appendChild(f.firstChild)
    f.replaceWith(span)
  })
  editable.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

/** Tamanho (px) renderizado no ponto da seleção, ou null se não há seleção
 *  dentro de um editor. Considera spans inline. */
export function currentSelectionFontSize(): number | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const n = sel.getRangeAt(0).startContainer
  const host = n.nodeType === 3 ? n.parentElement : (n as HTMLElement | null)
  if (!host?.closest('.board-richtext')) return null
  const v = parseFloat(getComputedStyle(host).fontSize)
  return Number.isFinite(v) ? Math.round(v) : null
}

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
/** Range no ponto (x,y); cai no fim do conteúdo quando não há ponto. */
function caretRangeAt(pt: { x: number; y: number } | null, host: HTMLElement): Range {
  const d = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (pt) {
    const r = d.caretRangeFromPoint?.(pt.x, pt.y)
    if (r && host.contains(r.startContainer)) return r
    const p = d.caretPositionFromPoint?.(pt.x, pt.y)
    if (p && host.contains(p.offsetNode)) {
      const r2 = document.createRange()
      r2.setStart(p.offsetNode, p.offset)
      r2.collapse(true)
      return r2
    }
  }
  const end = document.createRange()
  end.selectNodeContents(host)
  end.collapse(false)
  return end
}

export function RichTextArea({ html, editing, placeholder, style, onStopEdit }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const lastHtml = useRef(html)
  // Onde o duplo-clique caiu, lido antes do elemento virar editável.
  const enterPoint = useRef<{ x: number; y: number } | null>(null)

  // Entrar em edição: semeia o conteúdo e põe o cursor ONDE a pessoa clicou —
  // cair sempre no fim do texto obriga a navegar de seta pra corrigir no meio.
  // Sem ponto de clique (ex.: bloco recém-criado), vai pro fim.
  useEffect(() => {
    if (!editing || !ref.current) return
    const node = ref.current
    if (node.innerHTML !== html) node.innerHTML = html
    lastHtml.current = html
    const pt = enterPoint.current
    enterPoint.current = null
    requestAnimationFrame(() => {
      node.focus()
      const sel = window.getSelection()
      const range = caretRangeAt(pt, node)
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
      // Guarda o ponto ANTES de entrar em edição: é o que leva o cursor pro
      // lugar clicado em vez do fim do texto.
      onDoubleClick={e => { if (!editing) enterPoint.current = { x: e.clientX, y: e.clientY } }}
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
