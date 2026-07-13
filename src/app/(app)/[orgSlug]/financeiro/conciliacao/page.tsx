import { assertFinanceAccess } from '@/lib/finance'
import { ConciliacaoClient, type MovementView, type LancOption } from './ConciliacaoClient'

/** Sugere o lançamento em aberto mais provável pro movimento: mesmo tipo (credit→entrada,
 * debit→saida), valor exato, e vencimento mais próximo da data do movimento (até 60 dias). */
function suggestMatch(mov: { tipo: string; valor: number; dataMov: string }, candidatos: LancOption[]): string | null {
  const wantTipo = mov.tipo === 'credit' ? 'entrada' : 'saida'
  const pool = candidatos.filter(c => c.tipo === wantTipo && Math.abs(c.valor - mov.valor) < 0.01)
  if (!pool.length) return null
  const movTime = new Date(mov.dataMov).getTime()
  let best: LancOption | null = null
  let bestDiff = Infinity
  for (const c of pool) {
    if (!c.vencimento) continue
    const diff = Math.abs(new Date(c.vencimento).getTime() - movTime)
    if (diff < bestDiff) { bestDiff = diff; best = c }
  }
  if (best && bestDiff <= 60 * 864e5) return best.id
  return best?.id ?? pool[0].id
}

export default async function ConciliacaoPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: movsRaw } = await (supabase as any)
    .from('btg_movements')
    .select('id, tipo, valor, data_mov, descricao, categoria, status')
    .eq('org_id', orgId)
    .order('data_mov', { ascending: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: abertosRaw } = await (supabase as any)
    .from('lancamentos')
    .select('id, tipo, contato_nome, descricao, valor, vencimento')
    .eq('org_id', orgId).eq('situacao', 'em_aberto')
    .order('vencimento', { ascending: true })

  const abertos: LancOption[] = ((abertosRaw ?? []) as Record<string, unknown>[]).map(l => ({
    id: l.id as string,
    tipo: l.tipo as string,
    contatoNome: (l.contato_nome as string | null) ?? null,
    descricao: (l.descricao as string | null) ?? null,
    valor: Number(l.valor ?? 0),
    vencimento: (l.vencimento as string | null) ?? null,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (movsRaw ?? []) as any[]

  const pendentes: MovementView[] = rows.filter(m => m.status === 'pendente').map(m => {
    const base = {
      id: m.id as string, tipo: m.tipo as string, valor: Number(m.valor ?? 0),
      dataMov: m.data_mov as string, descricao: (m.descricao as string | null) ?? null,
      categoria: (m.categoria as string | null) ?? null,
    }
    return { ...base, sugestaoId: suggestMatch(base, abertos) }
  })

  const historico: MovementView[] = rows.filter(m => m.status !== 'pendente').map(m => ({
    id: m.id as string, tipo: m.tipo as string, valor: Number(m.valor ?? 0),
    dataMov: m.data_mov as string, descricao: (m.descricao as string | null) ?? null,
    categoria: (m.categoria as string | null) ?? null, sugestaoId: null,
    status: m.status as string,
  }))

  return <ConciliacaoClient orgSlug={orgSlug} pendentes={pendentes} historico={historico} abertos={abertos} />
}
