// Mapa mental = ÁRVORE (um pai por nó), não um grafo livre como o Quadro.
// A posição NÃO é do usuário: é calculada (layout tidy horizontal, raiz à esquerda).
// Guardado no mesmo blob `visual_boards.data`, com kind='mapa'.

export interface MindNode {
  id: string
  text: string
  color?: string            // hex; herdado visualmente pelos filhos quando ausente
  collapsed?: boolean
  side?: 'left' | 'right'   // só no nível 1: de que lado da raiz o ramo abre
  dx?: number               // deslocamento manual (arrastar). A subárvore acompanha —
  dy?: number               // por isso é offset do auto-layout, não coordenada absoluta.
  children: MindNode[]
}
export interface MindMapData { root: MindNode }

export const MIND_COLORS = ['#f97316', '#0ea5e9', '#10b981', '#a855f7', '#ef4444', '#eab308', '#64748b'] as const

export const NODE_H = 40
export const H_GAP  = 56          // distância horizontal entre níveis
export const V_GAP  = 12          // respiro vertical entre irmãos
export const PAD    = 32          // margem do canvas

export function newNode(text = ''): MindNode {
  return { id: crypto.randomUUID(), text, children: [] }
}
export function emptyMap(title: string): MindMapData {
  return { root: { ...newNode(title || 'Tema central'), color: MIND_COLORS[0] } }
}

/** Largura do nó estimada pelo texto (o layout roda no server e no client — sem medir DOM).
 *  A folga cobre o padding + o botão "+" que mora no fim da caixa. */
export function nodeW(text: string): number {
  const t = text || 'Novo tópico'
  return Math.min(280, Math.max(128, Math.round(t.length * 7.1) + 52))
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

/** Altura que a subárvore ocupa (recolhida = só o próprio nó). */
function subtreeH(n: MindNode, memo: Map<string, number>): number {
  const hit = memo.get(n.id)
  if (hit != null) return hit
  let h: number
  if (n.collapsed || n.children.length === 0) h = NODE_H
  else {
    h = n.children.reduce((a, c) => a + subtreeH(c, memo) + V_GAP, 0) - V_GAP
    h = Math.max(NODE_H, h)
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
    const w = nodeW(n.text)
    const color = n.color ?? inherited
    nodes.push({ node: n, parentId, x: x + ox, y: centerY - NODE_H / 2 + oy, w, h: NODE_H, depth, color, side })
    if (n.collapsed || !n.children.length) return
    const total = n.children.reduce((a, c) => a + subtreeH(c, memo) + V_GAP, 0) - V_GAP
    let cursor = centerY - total / 2
    for (const c of n.children) {
      const ch = subtreeH(c, memo)
      const cx = side === 'left' ? x - H_GAP - nodeW(c.text) : x + w + H_GAP
      edges.push({ fromId: n.id, toId: c.id })
      place(c, cx, cursor + ch / 2, side, depth + 1, n.id, color, ox, oy)
      cursor += ch + V_GAP
    }
  }

  const rootW = nodeW(root.text)
  const rOx = root.dx ?? 0, rOy = root.dy ?? 0
  nodes.push({ node: root, parentId: null, x: rOx, y: -NODE_H / 2 + rOy, w: rootW, h: NODE_H, depth: 0, color: rootColor, side: 'root' })

  if (!root.collapsed && root.children.length) {
    const sides = assignSides(root, memo)
    for (const dir of ['right', 'left'] as const) {
      const branch = root.children.filter(c => sides.get(c.id) === dir)
      if (!branch.length) continue
      const total = branch.reduce((a, c) => a + subtreeH(c, memo) + V_GAP, 0) - V_GAP
      let cursor = -total / 2
      for (const c of branch) {
        const ch = subtreeH(c, memo)
        const cx = dir === 'left' ? -H_GAP - nodeW(c.text) : rootW + H_GAP
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
  const y1 = from.y + NODE_H / 2, y2 = to.y + NODE_H / 2
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
