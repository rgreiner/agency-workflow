import { assertFinanceAccess } from '@/lib/finance'
import { unwrap } from '@/lib/supabase/unwrap'
import { isRealizado, isIgnorado } from '@/lib/extrato'
import { InadimplentesClient, type AbertoItem } from './InadimplentesClient'

// Busca da própria API — o builder não alcança o IP público do VPS.
export const dynamic = 'force-dynamic'
const PAGE = 1000

export default async function InadimplentesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Flow: lançamentos em aberto (a receber / a pagar não liquidados).
  const resLanc = await sb.from('lancamentos')
    .select('id, tipo, contato_nome, descricao, categoria, vencimento, valor, situacao, origem_tipo, origem_ref')
    .eq('org_id', orgId).eq('situacao', 'em_aberto')

  // Extrato importado (Conta Azul) em aberto e ainda não promovido (mesma dedup do Lançamentos).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const importadasRaw: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('extrato_importado')
      .select('import_ref, contato, descricao, categoria, tipo, valor, valor_original, situacao, venc_original, data_prevista, data_mov')
      .eq('org_id', orgId).range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    importadasRaw.push(...data)
    if (data.length < PAGE) break
  }

  // Espelha o select acima — tipar aqui é o que faz o unwrap valer a pena.
  interface LancRaw {
    id: string; tipo: string; contato_nome: string | null; descricao: string | null
    categoria: string | null; vencimento: string | null; valor: number | string
    situacao: string; origem_tipo: string | null; origem_ref: string | null
  }
  const lanc = unwrap<LancRaw>(resLanc, 'lançamentos')

  // A dedup precisa olhar TODOS os lançamentos vindos do extrato, não só os em
  // aberto. Montar o set a partir de `lanc` (que já vem filtrado por
  // situacao='em_aberto') fazia o título voltar a aparecer como atrasado assim
  // que era PAGO: o lançamento saía da lista, a linha do extrato deixava de ser
  // reconhecida como promovida e ressuscitava. Eram 3 títulos, R$ 3.906,82
  // inflando o total de "a pagar atrasado" — entre eles o FGTS já conciliado.
  const resPromo = await sb.from('lancamentos')
    .select('origem_ref')
    .eq('org_id', orgId).eq('origem_tipo', 'conta_azul').not('origem_ref', 'is', null)
  const promoted = new Set(
    unwrap<{ origem_ref: string | null }>(resPromo, 'lançamentos promovidos')
      .map(l => l.origem_ref)
      .filter((r): r is string => !!r),
  )

  const itens: AbertoItem[] = []
  for (const l of lanc) {
    itens.push({
      id: l.id,
      tipo: l.tipo === 'saida' ? 'saida' : 'entrada',
      contato: (l.contato_nome as string)?.trim() || 'Sem contato',
      descricao: l.descricao ?? null,
      categoria: l.categoria ?? null,
      vencimento: l.vencimento ?? null,
      valor: Math.abs(Number(l.valor ?? 0)),
    })
  }
  for (const e of importadasRaw) {
    if (isRealizado(e.situacao) || isIgnorado(e.situacao)) continue          // só em aberto
    if (e.import_ref && promoted.has(e.import_ref)) continue                 // já virou lançamento
    const valorNum = Number(e.valor ?? 0)
    const tipo: 'entrada' | 'saida' =
      e.tipo === 'despesa' ? 'saida' : e.tipo === 'receita' ? 'entrada' : (valorNum < 0 ? 'saida' : 'entrada')
    itens.push({
      id: `imp:${e.import_ref}`,
      tipo,
      contato: (e.contato as string)?.trim() || 'Sem contato',
      descricao: e.descricao ?? null,
      categoria: e.categoria ?? null,
      // data_prevista = data real/repactuada (ver page.tsx do Lançamentos).
      vencimento: e.data_prevista ?? e.venc_original ?? e.data_mov ?? null,
      valor: Math.abs(valorNum || Number(e.valor_original ?? 0)),
    })
  }

  const today = new Date().toISOString().slice(0, 10)
  return <InadimplentesClient itens={itens} today={today} />
}
