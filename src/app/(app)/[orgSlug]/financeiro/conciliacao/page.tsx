import { assertFinanceAccess } from '@/lib/finance'
import { ConciliacaoClient, type MovementView, type LancOption, type ContaOpt } from './ConciliacaoClient'

const STOP = new Set([
  'ltda', 'me', 'epp', 'sa', 'eireli', 'cia', 'comercio', 'comercial', 'servicos', 'servico',
  'industria', 'e', 'de', 'da', 'do', 'das', 'dos', 'the', 'pix', 'ted', 'doc', 'tef',
  'recebido', 'recebida', 'enviado', 'enviada', 'pagamento', 'transferencia', 'credito', 'debito',
])
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
function tokens(s: string | null | undefined): string[] {
  return norm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t))
}
/** O nome do contato do lançamento aparece na descrição do movimento? (ex.: "PIX ACME LTDA" ~ "Acme Comércio") */
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

export default async function ConciliacaoPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [{ data: movsRaw }, { data: abertosRaw }, { data: itensRaw }, { data: contasRaw }, { data: settings }] =
    await Promise.all([
      sb.from('btg_movements')
        .select('id, tipo, valor, data_mov, descricao, categoria, status')
        .eq('org_id', orgId).order('data_mov', { ascending: false }),
      sb.from('lancamentos')
        .select('id, tipo, contato_nome, descricao, valor, valor_realizado, vencimento')
        .eq('org_id', orgId).eq('situacao', 'em_aberto').order('vencimento', { ascending: true }),
      sb.from('btg_conciliacao_itens')
        .select('movement_id, valor, lancamentos(contato_nome, descricao)')
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

  // Lançamentos ligados a cada movimento conciliado (pra mostrar no histórico).
  const itensPorMov = new Map<string, { nome: string; valor: number }[]>()
  for (const it of (itensRaw ?? []) as Record<string, unknown>[]) {
    const mid = it.movement_id as string
    const lanc = it.lancamentos as { contato_nome?: string | null; descricao?: string | null } | null
    const nome = lanc?.contato_nome || lanc?.descricao || 'Lançamento'
    const arr = itensPorMov.get(mid) ?? []
    arr.push({ nome, valor: Number(it.valor ?? 0) })
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

  return (
    <ConciliacaoClient
      orgSlug={orgSlug}
      pendentes={pendentes}
      historico={historico}
      abertos={abertos}
      contas={contas}
      categoriasEntrada={catNames('entrada')}
      categoriasSaida={catNames('saida')}
    />
  )
}
