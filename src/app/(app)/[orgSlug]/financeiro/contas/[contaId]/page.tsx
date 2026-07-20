import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Landmark, Plug } from 'lucide-react'
import { assertFinanceAccess } from '@/lib/finance'
import { loadConciliacao } from '@/lib/conciliacao'
import { ConciliacaoClient } from '../../conciliacao/ConciliacaoClient'
import { ImportarOfxButton } from './ImportarOfxButton'
import { ContaExtratoView, type Mov, type Previsto } from './ContaExtratoView'

// Busca da própria API — o builder não alcança o IP público do VPS.
export const dynamic = 'force-dynamic'
const PAGE = 1000

export default async function ContaPage({
  params,
}: {
  params: Promise<{ orgSlug: string; contaId: string }>
}) {
  const { orgSlug, contaId } = await params
  const { supabase, orgId } = await assertFinanceAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // contas_saldo é a fonte única do saldo (migration 127) — mesma fórmula da lista e do painel.
  const { data: conta } = await sb
    .from('contas_saldo')
    .select('id, nome, tipo, cor, saldo_inicial, saldo_atual, saldo_banco, saldo_banco_data')
    .eq('id', contaId).eq('org_id', orgId).maybeSingle()
  if (!conta) notFound()

  // Extrato do Conta Azul desta conta (casado pelo nome da conta), paginado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const movRaw: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('extrato_importado')
      .select('data_mov, contato, descricao, categoria, valor, situacao')
      .eq('org_id', orgId).eq('conta', conta.nome)
      .order('data_mov', { ascending: false })
      // Desempate obrigatório: data_mov tem milhares de empates e, sem 2ª chave, a
      // ordem varia entre as requisições — a paginação duplicava e perdia linhas.
      .order('id', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    movRaw.push(...data)
    if (data.length < PAGE) break
  }
  const REALIZADO_EXTRATO = new Set(['Conciliado', 'Quitado', 'Transferido'])
  const movimentos: Mov[] = movRaw.map(e => ({
    data: (e.data_mov as string) ?? null,
    contato: (e.contato as string) ?? null,
    descricao: (e.descricao as string) ?? null,
    categoria: (e.categoria as string) ?? null,
    valor: Number(e.valor ?? 0),
    situacao: (e.situacao as string) ?? null,
    realizado: REALIZADO_EXTRATO.has((e.situacao as string) ?? ''),
    origem: 'extrato',
  }))

  // Lançamentos da própria conta. Os realizados entram no MESMO timeline do extrato —
  // sem isso o "saldo do dia" das linhas não chega no "Saldo atual" do topo (que vem
  // da view contas_saldo e já soma as baixas do Flow). origem_ref is null exclui os
  // promovidos do extrato, senão o mesmo dinheiro apareceria duas vezes.
  const { data: lancRaw } = await sb
    .from('lancamentos')
    .select('tipo, situacao, valor, valor_realizado, vencimento, data_liquidacao, descricao, contato_nome, categoria')
    .eq('org_id', orgId).eq('conta_id', contaId).is('origem_ref', null)

  const PAGO = new Set(['pago', 'recebido'])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const l of (lancRaw ?? []) as any[]) {
    if (!PAGO.has(l.situacao as string)) continue
    const bruto = Number(l.valor_realizado ?? l.valor ?? 0)
    movimentos.push({
      data: (l.data_liquidacao as string) ?? (l.vencimento as string) ?? null,
      contato: (l.contato_nome as string) ?? null,
      descricao: (l.descricao as string) ?? null,
      categoria: (l.categoria as string) ?? null,
      valor: l.tipo === 'saida' ? -bruto : bruto,
      situacao: l.tipo === 'saida' ? 'Pago' : 'Recebido',
      realizado: true,
      origem: 'flow',
    })
  }

  // Previstos (em aberto) da conta — alimentam "a receber / a pagar" e o saldo
  // projetado do mês no cabeçalho.
  const previstos: Previsto[] = ((lancRaw ?? []) as Record<string, unknown>[])
    .filter(l => !PAGO.has(l.situacao as string))
    .map(l => ({
      vencimento: (l.vencimento as string) ?? null,
      tipo: (l.tipo as string) === 'saida' ? 'saida' : 'entrada',
      valor: Number(l.valor ?? 0),
    }))
    .filter(p => p.vencimento && p.valor > 0) as Previsto[]

  // Conciliação OFX (banco × Flow) — só entra na tela quando há extrato bancário importado.
  const conc = await loadConciliacao(sb, orgId, contaId)
  const temOfx = conc.pendentes.length + conc.historico.length > 0
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div>
      <div className="p-6 pb-0">
        <Link href={`/${orgSlug}/financeiro/contas`} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-3">
          <ArrowLeft className="w-4 h-4" /> Contas
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center text-[#fff]" style={{ backgroundColor: conta.cor || '#f97316' }}>
              <Landmark className="w-4 h-4" />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{conta.nome}</h1>
              <p className="text-gray-500 text-sm mt-0.5">Conta {conta.tipo}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              title="Em breve: conectar a integração automática do banco"
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 text-gray-400 cursor-not-allowed"
            >
              <Plug className="w-4 h-4" /> Integração automática (em breve)
            </button>
            <ImportarOfxButton orgSlug={orgSlug} contaId={contaId} />
          </div>
        </div>
      </div>

      <ContaExtratoView
        movimentos={movimentos}
        previstos={previstos}
        saldoInicial={Number(conta.saldo_inicial ?? 0)}
        saldoAtual={Number(conta.saldo_atual ?? 0)}
        saldoBanco={conta.saldo_banco != null ? Number(conta.saldo_banco) : null}
        saldoBancoData={(conta.saldo_banco_data as string) ?? null}
        temOfx={temOfx}
        today={today}
      />

      {temOfx && <ConciliacaoClient orgSlug={orgSlug} {...conc} />}
    </div>
  )
}
