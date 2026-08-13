import { assertFinanceAccess, fetchDescartados } from '@/lib/finance'
import { unwrap } from '@/lib/supabase/unwrap'
import { isRealizado, isIgnorado } from '@/lib/extrato'
import {
  InadimplentesClient,
  type AbertoItem, type ClienteInfo, type ReguaInfo,
} from './InadimplentesClient'

// Busca da própria API — o builder não alcança o IP público do VPS.
export const dynamic = 'force-dynamic'
const PAGE = 1000

const REGUA_DEFAULT = [-3, 0, 3, 7, 15, 30, 60, 90]

export default async function InadimplentesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Flow: lançamentos em aberto (a receber / a pagar não liquidados).
  const resLanc = await sb.from('lancamentos')
    .select('id, tipo, contato_nome, descricao, categoria, vencimento, valor, valor_realizado, situacao, origem_tipo, origem_ref, workspace_id, promessa_data, promessa_obs')
    .eq('org_id', orgId).eq('situacao', 'em_aberto')

  const [resClientes, resAvisos, resCfg, resAliases] = await Promise.all([
    sb.from('workspaces').select('id, name, finance_email, cobranca_auto')
      .eq('org_id', orgId).eq('archived', false).order('name'),
    sb.from('cobranca_avisos').select('lancamento_id, bucket, canal, sent_at, email').eq('org_id', orgId),
    sb.from('org_settings').select('payment_info, cobranca_ativa, cobranca_regua').eq('org_id', orgId).maybeSingle(),
    // Quem paga ≠ cliente do job. O `workspace_id` do lançamento vem do documento de
    // origem (a PP da Comil), e isso é CENTRO DE CUSTO — usá-lo para agrupar fazia a
    // dívida da Positiva aparecer no nome da Comil. O único vínculo que diz "esta
    // grafia é este cliente" é o alias, criado à mão no botão "Vincular cliente".
    sb.from('cliente_aliases').select('alias, workspace_id').eq('org_id', orgId),
  ])

  // Mesma normalização do banco (fin_norm_nome): trim + lower + sem acento.
  const norm = (v: string | null | undefined) =>
    (v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

  const aliasParaCliente = new Map<string, string>(
    ((resAliases?.data ?? []) as { alias: string; workspace_id: string }[])
      .map(a => [norm(a.alias), a.workspace_id]),
  )
  const nomeDoWorkspace = new Map<string, string>(
    ((resClientes?.data ?? []) as { id: string; name: string }[]).map(w => [w.id, w.name]),
  )

  // Extrato importado (Conta Azul) em aberto e ainda não promovido (mesma dedup do
  // Lançamentos). O filtro de situação é feito NO BANCO: das ~6,9 mil linhas, só as
  // 'Em aberto'/'Atrasado' podem ser inadimplência — o resto era baixado e jogado
  // fora no cliente (auditoria 02/08, Financeiro #5). Mesma régua de lib/extrato:
  // realizado = Conciliado/Quitado/Transferido, ignorado = Perdido/nulo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const importadasRaw: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('extrato_importado')
      .select('import_ref, contato, descricao, categoria, tipo, valor, valor_original, situacao, venc_original, data_prevista, data_mov')
      .eq('org_id', orgId).in('situacao', ['Em aberto', 'Atrasado'])
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    importadasRaw.push(...data)
    if (data.length < PAGE) break
  }

  // Espelha o select acima — tipar aqui é o que faz o unwrap valer a pena.
  interface LancRaw {
    id: string; tipo: string; contato_nome: string | null; descricao: string | null
    categoria: string | null; vencimento: string | null; valor: number | string
    valor_realizado: number | string | null
    situacao: string; origem_tipo: string | null; origem_ref: string | null
    workspace_id: string | null; promessa_data: string | null; promessa_obs: string | null
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

  // Descartes (migration 132). A dedup por `origem_ref` só pega o título PROMOVIDO;
  // quando o título foi refeito NATIVO no Flow (origem_tipo='producao', sem
  // origem_ref) não há vínculo nenhum e o descarte é a única marca de "esta linha
  // não vale mais". Sem este filtro o Fee 63 do IMDM — recebido em 28/07 pelo
  // lançamento nativo — voltava aqui como inadimplente pela linha do Conta Azul.
  const descartados = await fetchDescartados(sb, orgId)

  // Último aviso por título — a tela precisa responder "já cobramos isso?".
  interface AvisoRaw { lancamento_id: string; bucket: string; canal: string; sent_at: string; email: string | null }
  const ultimoAviso = new Map<string, AbertoItem['ultimoAviso']>()
  for (const a of ((resAvisos?.data ?? []) as AvisoRaw[])) {
    const atual = ultimoAviso.get(a.lancamento_id)
    if (atual && atual.data >= a.sent_at) continue
    ultimoAviso.set(a.lancamento_id, { data: a.sent_at, canal: a.canal, bucket: a.bucket })
  }

  /** Nome do cliente do job — só quando difere de quem paga (senão é repetição). */
  const centroDeCusto = (wsId: string | null, contato: string | null): string | null => {
    if (!wsId) return null
    const nome = nomeDoWorkspace.get(wsId)
    return nome && norm(nome) !== norm(contato) ? nome : null
  }

  const itens: AbertoItem[] = []
  for (const l of lanc) {
    // Baixa parcial: o que ainda falta é o valor cheio MENOS o já realizado. A
    // Lista trata isso desde julho; aqui e no Painel o total vinha inflado.
    const cheio = Math.abs(Number(l.valor ?? 0))
    const realizado = Math.abs(Number(l.valor_realizado ?? 0))
    const falta = Math.round(Math.max(cheio - realizado, 0) * 100) / 100
    if (falta <= 0) continue
    itens.push({
      id: l.id,
      lancamentoId: l.id,
      tipo: l.tipo === 'saida' ? 'saida' : 'entrada',
      contato: (l.contato_nome as string)?.trim() || 'Sem contato',
      clienteId: aliasParaCliente.get(norm(l.contato_nome)) ?? null,
      centroCusto: centroDeCusto(l.workspace_id, l.contato_nome),
      descricao: l.descricao ?? null,
      categoria: l.categoria ?? null,
      vencimento: l.vencimento ?? null,
      valor: falta,
      valorCheio: cheio,
      parcial: realizado > 0,
      promessaData: l.promessa_data ?? null,
      promessaObs: l.promessa_obs ?? null,
      ultimoAviso: ultimoAviso.get(l.id) ?? null,
    })
  }
  for (const e of importadasRaw) {
    if (isRealizado(e.situacao) || isIgnorado(e.situacao)) continue          // só em aberto
    if (e.import_ref && promoted.has(e.import_ref)) continue                 // já virou lançamento
    if (e.import_ref && descartados.has(e.import_ref)) continue              // descartada na mão
    const valorNum = Number(e.valor ?? 0)
    const tipo: 'entrada' | 'saida' =
      e.tipo === 'despesa' ? 'saida' : e.tipo === 'receita' ? 'entrada' : (valorNum < 0 ? 'saida' : 'entrada')
    const cheio = Math.abs(valorNum || Number(e.valor_original ?? 0))
    itens.push({
      id: `imp:${e.import_ref}`,
      // Linha do extrato ainda não promovida: aparece no total (é dinheiro
      // devido de verdade), mas não dá pra cobrar — não existe título no Flow.
      lancamentoId: null,
      tipo,
      contato: (e.contato as string)?.trim() || 'Sem contato',
      clienteId: aliasParaCliente.get(norm(e.contato)) ?? null,
      centroCusto: null,
      descricao: e.descricao ?? null,
      categoria: e.categoria ?? null,
      // data_prevista = data real/repactuada (ver page.tsx do Lançamentos).
      vencimento: e.data_prevista ?? e.venc_original ?? e.data_mov ?? null,
      valor: cheio,
      valorCheio: cheio,
      parcial: false,
      promessaData: null,
      promessaObs: null,
      ultimoAviso: null,
    })
  }

  interface ClienteRaw { id: string; name: string; finance_email: string | null; cobranca_auto: boolean }
  const clientes: ClienteInfo[] = ((resClientes?.data ?? []) as ClienteRaw[]).map(c => ({
    id: c.id, nome: c.name, financeEmail: c.finance_email, cobrancaAuto: !!c.cobranca_auto,
  }))

  const cfg = resCfg?.data ?? null
  const regua: ReguaInfo = {
    ativa: !!cfg?.cobranca_ativa,
    degraus: Array.isArray(cfg?.cobranca_regua) && cfg.cobranca_regua.length
      ? (cfg.cobranca_regua as number[])
      : REGUA_DEFAULT,
    temPaymentInfo: !!(cfg?.payment_info ?? '').trim(),
    clientesLigados: clientes.filter(c => c.cobrancaAuto && (c.financeEmail ?? '').trim()).length,
  }

  const today = new Date().toISOString().slice(0, 10)
  return (
    <InadimplentesClient
      orgSlug={orgSlug} itens={itens} today={today} clientes={clientes} regua={regua}
    />
  )
}
