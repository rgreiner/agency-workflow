// Carga de dados da conciliação (movimentos do extrato × lançamentos em aberto),
// compartilhada entre a tela global e a tela por-conta. Ver btg_movements (extrato
// genérico: btg + ofx) e a migration 119.
import type { MovementView, LancOption, ContaOpt } from '@/app/(app)/[orgSlug]/financeiro/conciliacao/ConciliacaoClient'

const STOP = new Set([
  'ltda', 'me', 'epp', 'sa', 'eireli', 'cia', 'comercio', 'comercial', 'servicos', 'servico',
  'industria', 'e', 'de', 'da', 'do', 'das', 'dos', 'the', 'pix', 'ted', 'doc', 'tef',
  'recebido', 'recebida', 'enviado', 'enviada', 'pagamento', 'transferencia', 'credito', 'debito',
])
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
function tokens(s: string | null | undefined): string[] {
  return norm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t))
}
function nameMatch(descricao: string | null, contatoNome: string | null): boolean {
  const d = norm(descricao)
  const ct = tokens(contatoNome)
  if (!d || !ct.length) return false
  return ct.some(t => d.includes(t))
}
/** Sugere o lançamento pro movimento: mesmo tipo + saldo exato; `auto` quando o nome também bate. */
function suggestMatch(
  mov: { tipo: string; valor: number; dataMov: string; descricao: string | null },
  candidatos: LancOption[],
): { lancId: string; auto: boolean } | null {
  const want = mov.tipo === 'credit' ? 'entrada' : 'saida'
  const pool = candidatos.filter(c => c.tipo === want && Math.abs(c.saldo - mov.valor) < 0.01)
  if (!pool.length) return null
  const movT = new Date(mov.dataMov).getTime()
  const byDate = (arr: LancOption[]) =>
    arr.slice().sort((a, b) =>
      Math.abs(new Date(a.vencimento ?? 0).getTime() - movT) - Math.abs(new Date(b.vencimento ?? 0).getTime() - movT))
  const named = pool.filter(c => nameMatch(mov.descricao, c.contatoNome))
  if (named.length) return { lancId: byDate(named)[0].id, auto: true }
  return { lancId: byDate(pool)[0].id, auto: false }
}

export interface ConciliacaoData {
  pendentes: MovementView[]
  historico: MovementView[]
  abertos: LancOption[]
  contas: ContaOpt[]
  categoriasEntrada: string[]
  categoriasSaida: string[]
}

/** Carrega tudo que a ConciliacaoClient precisa. `contaId` filtra os movimentos por conta. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadConciliacao(sb: any, orgId: string, contaId?: string): Promise<ConciliacaoData> {
  let movQ = sb.from('btg_movements')
    .select('id, tipo, valor, data_mov, descricao, categoria, status, conciliado_modo, conciliado_em')
    .eq('org_id', orgId).order('data_mov', { ascending: false })
  if (contaId) movQ = movQ.eq('conta_id', contaId)

  const [{ data: movsRaw }, { data: abertosRaw }, { data: itensRaw }, { data: contasRaw }, { data: settings }] =
    await Promise.all([
      movQ,
      sb.from('lancamentos')
        .select('id, tipo, contato_nome, descricao, valor, valor_realizado, vencimento')
        .eq('org_id', orgId).eq('situacao', 'em_aberto').order('vencimento', { ascending: true }),
      sb.from('btg_conciliacao_itens')
        // doc_serie/doc_numero NÃO existem aqui — são da view lancamentos_doc, não da tabela.
        .select('movement_id, valor, lancamentos(id, contato_nome, descricao, vencimento)')
        .eq('org_id', orgId),
      sb.from('contas_financeiras')
        .select('id, nome').eq('org_id', orgId).eq('ativo', true).order('ordem', { ascending: true }),
      sb.from('org_settings').select('finance_categorias').eq('org_id', orgId).maybeSingle(),
    ])

  const abertos: LancOption[] = ((abertosRaw ?? []) as Record<string, unknown>[]).map(l => {
    const valor = Number(l.valor ?? 0)
    const realizado = Number(l.valor_realizado ?? 0)
    return {
      id: l.id as string,
      tipo: l.tipo as string,
      contatoNome: (l.contato_nome as string | null) ?? null,
      descricao: (l.descricao as string | null) ?? null,
      valor,
      saldo: Math.round((valor - realizado) * 100) / 100,
      vencimento: (l.vencimento as string | null) ?? null,
    }
  }).filter(l => l.saldo > 0.005)

  const itensPorMov = new Map<string, { nome: string; descricao: string | null; vencimento: string | null; valor: number }[]>()
  for (const it of (itensRaw ?? []) as Record<string, unknown>[]) {
    const mid = it.movement_id as string
    const lanc = it.lancamentos as
      { contato_nome?: string | null; descricao?: string | null; vencimento?: string | null } | null
    const nome = lanc?.contato_nome || lanc?.descricao || 'Lançamento'
    const arr = itensPorMov.get(mid) ?? []
    arr.push({
      nome,
      // Só repete a descrição quando ela não É o nome (senão a coluna Flow fica duplicada).
      descricao: lanc?.contato_nome ? (lanc?.descricao ?? null) : null,
      vencimento: lanc?.vencimento ?? null,
      valor: Number(it.valor ?? 0),
    })
    itensPorMov.set(mid, arr)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (movsRaw ?? []) as any[]
  const pendentes: MovementView[] = rows.filter(m => m.status === 'pendente').map(m => {
    const base = {
      id: m.id as string, tipo: m.tipo as string, valor: Number(m.valor ?? 0),
      dataMov: m.data_mov as string, descricao: (m.descricao as string | null) ?? null,
      categoria: (m.categoria as string | null) ?? null,
    }
    return { ...base, sugestao: suggestMatch(base, abertos), itens: null }
  })
  const historico: MovementView[] = rows.filter(m => m.status !== 'pendente').map(m => ({
    id: m.id as string, tipo: m.tipo as string, valor: Number(m.valor ?? 0),
    dataMov: m.data_mov as string, descricao: (m.descricao as string | null) ?? null,
    categoria: (m.categoria as string | null) ?? null, sugestao: null, status: m.status as string,
    // null = conciliação anterior à migration 131; a tela mostra só "Conciliado".
    modo: (m.conciliado_modo as 'auto' | 'manual' | null) ?? null,
    conciliadoEm: (m.conciliado_em as string | null) ?? null,
    itens: itensPorMov.get(m.id as string) ?? null,
  }))

  const contas: ContaOpt[] = ((contasRaw ?? []) as Record<string, unknown>[])
    .map(c => ({ id: c.id as string, nome: c.nome as string }))

  const grupos = (settings?.finance_categorias ?? []) as { nome: string; tipo?: string; filhos?: { nome: string }[] }[]
  const catNames = (dir: 'entrada' | 'saida') => {
    const out: string[] = []
    for (const g of grupos) {
      if (g.tipo && g.tipo !== dir && g.tipo !== 'ambos') continue
      out.push(g.nome)
      for (const f of g.filhos ?? []) out.push(f.nome)
    }
    return Array.from(new Set(out))
  }

  return { pendentes, historico, abertos, contas, categoriasEntrada: catNames('entrada'), categoriasSaida: catNames('saida') }
}
