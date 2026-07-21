// Regra ÚNICA de "quais categorias valem para um lançamento de entrada/saída".
//
// O grupo tem tipo 'entrada' | 'saida' | 'ambos'. O 'ambos' não é enfeite: o
// import do extrato (lib/extrato.ts) marca assim toda categoria que apareceu nas
// duas direções — é o caso de "Numerários em Trânsito", "Empréstimos" e
// "Empréstimos de Sócios", dinheiro que entra e sai pela mesma conta contábil.
//
// Existia em três versões diferentes: a tela de Categorias e a conciliação
// aceitavam 'ambos', mas o modal de Lançamentos comparava com igualdade estrita
// (`g.tipo !== form.tipo`) e escondia justamente essas três — a categoria estava
// cadastrada e simplesmente não aparecia na busca. Módulo puro de propósito,
// para poder ser usado no client e no server.

export interface CategoriaGrupoLike {
  nome: string
  tipo?: string | null
  filhos?: { nome: string }[]
}

/** O grupo serve para lançamentos desta direção? Sem tipo definido, serve para as duas. */
export function grupoServeA(grupo: CategoriaGrupoLike, direcao: 'entrada' | 'saida'): boolean {
  const t = grupo.tipo
  if (!t) return true
  return t === direcao || t === 'ambos'
}

/**
 * Nomes selecionáveis para a direção pedida: o grupo sem filhos vale por si; com
 * filhos, valem os filhos (o grupo vira só cabeçalho). Sem duplicatas — o mesmo
 * nome pode aparecer em grupos de direções diferentes.
 */
export function categoriaNomes(
  grupos: CategoriaGrupoLike[], direcao: 'entrada' | 'saida',
): string[] {
  const out: string[] = []
  for (const g of grupos) {
    if (!grupoServeA(g, direcao)) continue
    const filhos = g.filhos ?? []
    if (filhos.length === 0) out.push(g.nome)
    else for (const f of filhos) out.push(f.nome)
  }
  return Array.from(new Set(out))
}
