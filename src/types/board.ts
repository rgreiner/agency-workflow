// ── Board element types ───────────────────────────────────────────────────────

export type BoardElementType = 'note' | 'text' | 'image'

export interface BaseElement {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface NoteElement extends BaseElement {
  type: 'note'
  content: string
  color: string
}

export interface TextElement extends BaseElement {
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

export type BoardElement = NoteElement | TextElement | ImageElement

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
  { bg: '#fef9c3', border: '#fde047', label: 'Amarelo'  },
  { bg: '#fce7f3', border: '#f9a8d4', label: 'Rosa'     },
  { bg: '#f3e8ff', border: '#c084fc', label: 'Roxo'     },
  { bg: '#dbeafe', border: '#93c5fd', label: 'Azul'     },
  { bg: '#dcfce7', border: '#86efac', label: 'Verde'    },
  { bg: '#ffedd5', border: '#fdba74', label: 'Laranja'  },
  { bg: '#f1f5f9', border: '#cbd5e1', label: 'Cinza'    },
  { bg: '#ffffff', border: '#e5e7eb', label: 'Branco'   },
]

// ── Factory ───────────────────────────────────────────────────────────────────

export function createElement(type: BoardElementType, x: number, y: number): BoardElement {
  const id = crypto.randomUUID()
  switch (type) {
    case 'note':
      return { id, type: 'note',  x, y, w: 200, h: 160, content: '', color: '#fef9c3' }
    case 'text':
      return { id, type: 'text',  x, y, w: 320, h: 56,  content: '', size: 'body', bold: false, italic: false, align: 'left' }
    case 'image':
      return { id, type: 'image', x, y, w: 240, h: 200, url: '', caption: '' }
  }
}
