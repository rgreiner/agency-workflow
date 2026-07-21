// Mapa mental = ÁRVORE (um pai por nó), não um grafo livre como o Quadro.
// A posição NÃO é do usuário: é calculada (layout tidy horizontal, raiz à esquerda).
// Guardado no mesmo blob `visual_boards.data`, com kind='mapa'.

export interface MindNode {
  id: string
  text: string
  color?: string            // hex; herdado visualmente pelos filhos quando ausente
  textColor?: string        // hex; sobrescreve a cor do texto (senão: branco na raiz, cinza-900)
  bold?: boolean
  italic?: boolean
  collapsed?: boolean
  side?: 'left' | 'right'   // só no nível 1: de que lado da raiz o ramo abre
  dx?: number               // deslocamento manual (arrastar). A subárvore acompanha —
  dy?: number               // por isso é offset do auto-layout, não coordenada absoluta.
  children: MindNode[]
}
export interface MindMapData { root: MindNode }

export const MIND_COLORS = ['#f97316', '#0ea5e9', '#10b981', '#a855f7', '#ef4444', '#eab308', '#64748b'] as const
export const TEXT_COLORS = ['#1f2937', '#ffffff', '#f97316', '#0284c7', '#059669', '#dc2626', '#7c3aed'] as const

export const NODE_MIN_H = 40
export const NODE_MAX_W = 260     // largura máxima: passou disso, o texto quebra em linhas
export const LINE_H     = 19      // altura da linha (texto 13px)
export const PAD_X      = 12      // padding horizontal do nó
export const PAD_Y      = 10      // padding vertical do nó
export const AFFORD_W   = 24      // espaço reservado pro botão "+" dentro da caixa
export const H_GAP      = 56      // distância horizontal entre níveis
export const V_GAP      = 12      // respiro vertical entre irmãos
export const PAD        = 32      // margem do canvas

export function newNode(text = ''): MindNode {
  return { id: crypto.randomUUID(), text, children: [] }
}
export function emptyMap(title: string): MindMapData {
  return { root: { ...newNode(title || 'Tema central'), color: MIND_COLORS[0] } }
}

// ── Medida do nó ────────────────────────────────────────────────────────────
// O layout roda no server (impressão) e no client — não pode medir DOM. Então a
// quebra de linha é calculada aqui e o render usa EXATAMENTE estas linhas
// (`whitespace-pre`), o que garante que caixa e texto nunca discordem.

const charW = (bold?: boolean) => (bold ? 7.5 : 7.1)
const estW = (s: string, bold?: boolean) => s.length * charW(bold)

/** Largura útil de texto: a caixa cheia menos padding e o espaço do botão "+". */
const TEXT_MAX_W = NODE_MAX_W - PAD_X * 2 - AFFORD_W

/** Quebra o texto em linhas que cabem na largura máxima (palavra gigante quebra na força). */
export function wrapLines(text: string, bold?: boolean): string[] {
  const out: string[] = []
  for (const para of (text || '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) { out.push(''); continue }
    let line = ''
    for (const word of words) {
      let w = word
      while (estW(w, bold) > TEXT_MAX_W) {
        const n = Math.max(1, Math.floor(TEXT_MAX_W / charW(bold)))
        if (line) { out.push(line); line = '' }
        out.push(w.slice(0, n))
        w = w.slice(n)
      }
      const cand = line ? `${line} ${w}` : w
      if (line && estW(cand, bold) > TEXT_MAX_W) { out.push(line); line = w }
      else line = cand
    }
    out.push(line)
  }
  return out.length ? out : ['']
}

/** Caixa do nó: largura, altura e as linhas já quebradas. Nada é truncado. */
export function nodeBox(n: Pick<MindNode, 'text' | 'bold'>): { w: number; h: number; lines: string[] } {
  const lines = wrapLines(n.text || 'Novo tópico', n.bold)
  const widest = Math.max(...lines.map(l => estW(l, n.bold)))
  const w = Math.round(Math.min(NODE_MAX_W, Math.max(128, widest + PAD_X * 2 + AFFORD_W)))
  const h = Math.max(NODE_MIN_H, lines.length * LINE_H + PAD_Y * 2)
  return { w, h, lines }
}

export type Side = 'root' | 'left' | 'right'

export interface LaidNode {
  node: MindNode
  parentId: string | null
  x: number; y: number; w: number; h: number
  depth: number
  color: string
  side: Side
}
export interface Layout {
  nodes: LaidNode[]
  edges: { fromId: string; toId: string }[]
  width: number
  height: number
}

/** Altura que a subárvore ocupa (recolhida = só o próprio nó, que pode ter várias linhas). */
function subtreeH(n: MindNode, memo: Map<string, number>): number {
  const hit = memo.get(n.id)
  if (hit != null) return hit
  const own = nodeBox(n).h
  let h: number
  if (n.collapsed || n.children.length === 0) h = own
  else {
    h = n.children.reduce((a, c) => a + subtreeH(c, memo) + V_GAP, 0) - V_GAP
    h = Math.max(own, h)
  }
  memo.set(n.id, h)
  return h
}

/** De que lado cada ramo de nível 1 abre: respeita `side`; senão equilibra pelo peso. */
function assignSides(root: MindNode, memo: Map<string, number>): Map<string, 'left' | 'right'> {
  const m = new Map<string, 'left' | 'right'>()
  let rH = 0, lH = 0
  for (const c of root.children) {
    const h = subtreeH(c, memo)
    const s = c.side ?? (rH <= lH ? 'right' : 'left')
    m.set(c.id, s)
    if (s === 'right') rH += h; else lH += h
  }
  return m
}

/**
 * Layout tidy BALANCEADO: raiz no centro, ramos abrindo pros dois lados.
 * Posiciona pelo CENTRO vertical de cada subárvore e normaliza no fim (a raiz
 * nasce em x=0 e os ramos da esquerda vão pra x negativo).
 * `dx/dy` (arrastar) entram como offset ACUMULADO — por isso a subárvore
 * acompanha o nó movido em vez de descolar dele.
 */
export function layoutMap(root: MindNode): Layout {
  const memo = new Map<string, number>()
  const nodes: LaidNode[] = []
  const edges: { fromId: string; toId: string }[] = []
  const rootColor = root.color ?? MIND_COLORS[0]

  function place(
    n: MindNode, x: number, centerY: number, side: 'left' | 'right',
    depth: number, parentId: string, inherited: string, offX: number, offY: number,
  ) {
    const ox = offX + (n.dx ?? 0)
    const oy = offY + (n.dy ?? 0)
    const { w, h } = nodeBox(n)
    const color = n.color ?? inherited
    nodes.push({ node: n, parentId, x: x + ox, y: centerY - h / 2 + oy, w, h, depth, color, side })
    if (n.collapsed || !n.children.length) return
    const total = n.children.reduce((a, c) => a + subtreeH(c, memo) + V_GAP, 0) - V_GAP
    let cursor = centerY - total / 2
    for (const c of n.children) {
      const ch = subtreeH(c, memo)
      const cx = side === 'left' ? x - H_GAP - nodeBox(c).w : x + w + H_GAP
      edges.push({ fromId: n.id, toId: c.id })
      place(c, cx, cursor + ch / 2, side, depth + 1, n.id, color, ox, oy)
      cursor += ch + V_GAP
    }
  }

  const { w: rootW, h: rootH } = nodeBox(root)
  const rOx = root.dx ?? 0, rOy = root.dy ?? 0
  nodes.push({ node: root, parentId: null, x: rOx, y: -rootH / 2 + rOy, w: rootW, h: rootH, depth: 0, color: rootColor, side: 'root' })

  if (!root.collapsed && root.children.length) {
    const sides = assignSides(root, memo)
    for (const dir of ['right', 'left'] as const) {
      const branch = root.children.filter(c => sides.get(c.id) === dir)
      if (!branch.length) continue
      const total = branch.reduce((a, c) => a + subtreeH(c, memo) + V_GAP, 0) - V_GAP
      let cursor = -total / 2
      for (const c of branch) {
        const ch = subtreeH(c, memo)
        const cx = dir === 'left' ? -H_GAP - nodeBox(c).w : rootW + H_GAP
        edges.push({ fromId: root.id, toId: c.id })
        place(c, cx, cursor + ch / 2, dir, 1, root.id, rootColor, rOx, rOy)
        cursor += ch + V_GAP
      }
    }
  }

  // Normaliza pro canto: o conteúdo pode ter ido pra coordenada negativa.
  const minX = Math.min(...nodes.map(n => n.x))
  const minY = Math.min(...nodes.map(n => n.y))
  for (const n of nodes) { n.x += PAD - minX; n.y += PAD - minY }

  const width  = Math.max(...nodes.map(n => n.x + n.w)) + PAD
  const height = Math.max(...nodes.map(n => n.y + n.h)) + PAD
  return { nodes, edges, width, height }
}

/** Curva do pai pro filho; sai pelo lado em que o ramo abre. */
export function edgePath(from: LaidNode, to: LaidNode): string {
  const rightward = to.side !== 'left'
  const x1 = rightward ? from.x + from.w : from.x
  const x2 = rightward ? to.x : to.x + to.w
  const y1 = from.y + from.h / 2, y2 = to.y + to.h / 2
  const mx = x1 + (x2 - x1) / 2
  return `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
}

// ── Operações na árvore (imutáveis: devolvem uma raiz nova) ──────────────────

export function findParent(root: MindNode, id: string): MindNode | null {
  for (const c of root.children) {
    if (c.id === id) return root
    const hit = findParent(c, id)
    if (hit) return hit
  }
  return null
}
export function findNode(root: MindNode, id: string): MindNode | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const hit = findNode(c, id)
    if (hit) return hit
  }
  return null
}

function mapTree(n: MindNode, fn: (n: MindNode) => MindNode): MindNode {
  const next = fn(n)
  return { ...next, children: next.children.map(c => mapTree(c, fn)) }
}

export function updateNode(root: MindNode, id: string, patch: Partial<MindNode>): MindNode {
  return mapTree(root, n => (n.id === id ? { ...n, ...patch } : n))
}

export function addChild(root: MindNode, parentId: string, child: MindNode): MindNode {
  return mapTree(root, n =>
    n.id === parentId ? { ...n, collapsed: false, children: [...n.children, child] } : n)
}

/** Irmão logo depois de `siblingId`. Na raiz não há irmão — vira filho. */
export function addSibling(root: MindNode, siblingId: string, node: MindNode): MindNode {
  if (root.id === siblingId) return addChild(root, root.id, node)
  return mapTree(root, n => {
    const i = n.children.findIndex(c => c.id === siblingId)
    if (i < 0) return n
    const children = [...n.children]
    children.splice(i + 1, 0, node)
    return { ...n, children }
  })
}

/** Remove o nó e a subárvore. A raiz nunca é removida. */
export function removeNode(root: MindNode, id: string): MindNode {
  if (root.id === id) return root
  return mapTree(root, n => ({ ...n, children: n.children.filter(c => c.id !== id) }))
}

/** Devolve o mapa ao layout automático (limpa todo deslocamento manual). */
export function clearOffsets(root: MindNode): MindNode {
  return mapTree(root, n => {
    if (n.dx == null && n.dy == null) return n
    const next = { ...n }
    delete next.dx
    delete next.dy
    return next
  })
}
export function hasOffsets(n: MindNode): boolean {
  return n.dx != null || n.dy != null || n.children.some(hasOffsets)
}

// ── Export ──────────────────────────────────────────────────────────────────

/** Árvore → markdown (raiz vira H1, ramos viram bullets aninhados por profundidade). */
export function toMarkdown(root: MindNode): string {
  const out: string[] = [`# ${root.text || 'Mapa mental'}`, '']
  const walk = (n: MindNode, depth: number) => {
    for (const c of n.children) {
      out.push(`${'  '.repeat(depth)}- ${c.text || '(vazio)'}`)
      walk(c, depth + 1)
    }
  }
  walk(root, 0)
  return out.join('\n') + '\n'
}

export function slugify(s: string): string {
  return (s || 'mapa-mental')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'mapa-mental'
}
