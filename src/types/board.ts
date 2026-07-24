// ── Board element types ───────────────────────────────────────────────────────

export type BoardElementType = 'note' | 'text' | 'image' | 'color' | 'link' | 'frame' | 'checklist'

export interface BaseElement {
  id: string
  x: number
  y: number
  w: number
  h: number
}

// Formatação de texto compartilhada por nota e texto (todos opcionais p/
// compatibilidade com blocos antigos).
export interface TextFormat {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  align?: 'left' | 'center' | 'right'
  fontSize?: number       // px — sobrepõe o tamanho-base quando presente
  textColor?: string      // hex — sobrepõe a cor padrão do texto
}

export interface NoteElement extends BaseElement, TextFormat {
  type: 'note'
  content: string
  color: string
}

export interface TextElement extends BaseElement, TextFormat {
  type: 'text'
  content: string
  size: 'h1' | 'h2' | 'body'
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
}

export interface ImageElement extends BaseElement {
  type: 'image'
  url: string
  caption: string
}

export interface ColorElement extends BaseElement {
  type: 'color'
  color: string   // hex
  name: string
}

export interface LinkElement extends BaseElement {
  type: 'link'
  url: string
  title: string
}

export interface FrameElement extends BaseElement {
  type: 'frame'
  title: string
  color: string   // cor da borda/cabeçalho
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface ChecklistElement extends BaseElement {
  type: 'checklist'
  title: string
  items: ChecklistItem[]
}

export type BoardElement = NoteElement | TextElement | ImageElement | ColorElement | LinkElement | FrameElement | ChecklistElement

export interface Arrow {
  id: string
  fromId: string
  toId: string
}

export interface BoardData {
  elements: BoardElement[]
  arrows: Arrow[]
}

// ── Note color palette ────────────────────────────────────────────────────────

export const NOTE_COLORS = [
  { bg: '#ffffff', border: '#e5e7eb', label: 'Branco'   },
  { bg: '#fef9c3', border: '#fde047', label: 'Amarelo'  },
  { bg: '#fce7f3', border: '#f9a8d4', label: 'Rosa'     },
  { bg: '#f3e8ff', border: '#c084fc', label: 'Roxo'     },
  { bg: '#dbeafe', border: '#93c5fd', label: 'Azul'     },
  { bg: '#dcfce7', border: '#86efac', label: 'Verde'    },
  { bg: '#ffedd5', border: '#fdba74', label: 'Laranja'  },
  { bg: '#f1f5f9', border: '#cbd5e1', label: 'Cinza'    },
]

// ── Text color palette ────────────────────────────────────────────────────────

export const TEXT_COLORS = [
  { hex: '#0f172a', label: 'Padrão'   },
  { hex: '#64748b', label: 'Cinza'    },
  { hex: '#ef4444', label: 'Vermelho' },
  { hex: '#f97316', label: 'Laranja'  },
  { hex: '#16a34a', label: 'Verde'    },
  { hex: '#2563eb', label: 'Azul'     },
]

// ── Tamanho de fonte ──────────────────────────────────────────────────────────

export const FONT_MIN  = 8
export const FONT_MAX  = 96
export const FONT_STEP = 2

// Presets do bloco de texto → px base de cada tamanho.
export const TEXT_SIZE_PX: Record<TextElement['size'], number> = { h1: 28, h2: 20, body: 14 }
export const NOTE_BASE_PX = 13

// Tamanho efetivo (px) considerando o override numérico.
export function effectiveFontSize(el: NoteElement | TextElement): number {
  if (el.fontSize != null) return el.fontSize
  return el.type === 'text' ? TEXT_SIZE_PX[el.size] : NOTE_BASE_PX
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createElement(type: BoardElementType, x: number, y: number): BoardElement {
  const id = crypto.randomUUID()
  switch (type) {
    case 'note':
      return { id, type: 'note',  x, y, w: 200, h: 160, content: '', color: '#ffffff', bold: false, italic: false, align: 'left' }
    case 'text':
      return { id, type: 'text',  x, y, w: 320, h: 56,  content: '', size: 'body', bold: false, italic: false, align: 'left' }
    case 'image':
      return { id, type: 'image', x, y, w: 240, h: 200, url: '', caption: '' }
    case 'color':
      return { id, type: 'color', x, y, w: 150, h: 170, color: '#0047cc', name: '' }
    case 'link':
      return { id, type: 'link',  x, y, w: 280, h: 72,  url: '', title: '' }
    case 'frame':
      return { id, type: 'frame', x, y, w: 380, h: 300, title: 'Grupo', color: '#94a3b8' }
    case 'checklist':
      return { id, type: 'checklist', x, y, w: 240, h: 190, title: 'Checklist', items: [{ id: crypto.randomUUID(), text: '', done: false }] }
  }
}
