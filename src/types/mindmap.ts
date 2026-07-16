// Mapa mental = ÁRVORE (um pai por nó), não um grafo livre como o Quadro.
// A posição NÃO é do usuário: é calculada (layout tidy horizontal, raiz à esquerda).
// Guardado no mesmo blob `visual_boards.data`, com kind='mapa'.

export interface MindNode {
  id: string
  text: string
  color?: string        // hex; herdado visualmente pelos filhos quando ausente
  collapsed?: boolean
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

export interface LaidNode {
  node: MindNode
  parentId: string | null
  x: number; y: number; w: number; h: number
  depth: number
  color: string
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

/** Layout tidy horizontal: raiz à esquerda, cada nível uma coluna à direita. */
export function layoutMap(root: MindNode): Layout {
  const memo = new Map<string, number>()
  const nodes: LaidNode[] = []
  const edges: { fromId: string; toId: string }[] = []

  function place(n: MindNode, x: number, yTop: number, depth: number, parentId: string | null, inherited: string) {
    const h = subtreeH(n, memo)
    const w = nodeW(n.text)
    const color = n.color ?? inherited
    nodes.push({ node: n, parentId, x, y: yTop + h / 2 - NODE_H / 2, w, h: NODE_H, depth, color })
    if (n.collapsed || !n.children.length) return
    let cy = yTop
    for (const c of n.children) {
      edges.push({ fromId: n.id, toId: c.id })
      place(c, x + w + H_GAP, cy, depth + 1, n.id, color)
      cy += subtreeH(c, memo) + V_GAP
    }
  }
  place(root, PAD, PAD, 0, null, MIND_COLORS[0])

  const width  = Math.max(...nodes.map(n => n.x + n.w), 0) + PAD
  const height = Math.max(...nodes.map(n => n.y + n.h), 0) + PAD
  return { nodes, edges, width, height }
}

/** Curva do pai pro filho (mesma linguagem visual das setas do Quadro). */
export function edgePath(from: LaidNode, to: LaidNode): string {
  const x1 = from.x + from.w, y1 = from.y + NODE_H / 2
  const x2 = to.x,            y2 = to.y + NODE_H / 2
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
