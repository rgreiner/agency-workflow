import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Landmark, Plug } from 'lucide-react'
import { assertFinanceAccess } from '@/lib/finance'
import { loadConciliacao } from '@/lib/conciliacao'
import { ConciliacaoClient } from '../../conciliacao/ConciliacaoClient'
import { BtgCard } from '../BtgCard'
import { btgConfigured, btgEnv } from '@/lib/btg/config'
import { getBtgConnection } from '@/lib/btg/store'
import { ImportarOfxButton } from './ImportarOfxButton'
import { ContaExtratoView, type Mov } from './ContaExtratoView'

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
  // SÓ REALIZADO: a tela da conta mostra o que aconteceu no banco + a fila do OFX a
  // conciliar. Previsto (Em aberto/Atrasado) é assunto de Lançamentos — decisão do
  // Rafael. Filtrar aqui também corta ~560 linhas do tráfego na BTG.
  const REALIZADO_EXTRATO = ['Conciliado', 'Quitado', 'Transferido']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const movRaw: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('extrato_importado')
      .select('data_mov, contato, descricao, categoria, valor, situacao')
      .eq('org_id', orgId).eq('conta', conta.nome)
      .in('situacao', REALIZADO_EXTRATO)
      .order('data_mov', { ascending: false })
      // Desempate obrigatório: data_mov tem milhares de empates e, sem 2ª chave, a
      // ordem varia entre as requisições — a paginação duplicava e perdia linhas.
      .order('id', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    movRaw.push(...data)
    if (data.length < PAGE) break
  }
  const movimentos: Mov[] = movRaw.map(e => ({
    data: (e.data_mov as string) ?? null,
    contato: (e.contato as string) ?? null,
    descricao: (e.descricao as string) ?? null,
    categoria: (e.categoria as string) ?? null,
    valor: Number(e.valor ?? 0),
    situacao: (e.situacao as string) ?? null,
    origem: 'extrato',
  }))

  // Baixas do Flow (lançamentos já pagos/recebidos) entram no MESMO timeline do
  // extrato — sem isso o "saldo do dia" das linhas não chega no "Saldo atual" do topo
  // (que vem da view contas_saldo e já soma essas baixas). origem_ref is null exclui
  // os promovidos do extrato, senão o mesmo dinheiro apareceria duas vezes.
  const { data: lancRaw } = await sb
    .from('lancamentos')
    .select('tipo, valor, valor_realizado, vencimento, data_liquidacao, descricao, contato_nome, categoria')
    .eq('org_id', orgId).eq('conta_id', contaId).is('origem_ref', null)
    .in('situacao', ['pago', 'recebido'])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const l of (lancRaw ?? []) as any[]) {
    const bruto = Number(l.valor_realizado ?? l.valor ?? 0)
    movimentos.push({
      data: (l.data_liquidacao as string) ?? (l.vencimento as string) ?? null,
      contato: (l.contato_nome as string) ?? null,
      descricao: (l.descricao as string) ?? null,
      categoria: (l.categoria as string) ?? null,
      valor: l.tipo === 'saida' ? -bruto : bruto,
      situacao: l.tipo === 'saida' ? 'Pago' : 'Recebido',
      origem: 'flow',
    })
  }

  // Integração bancária desta conta (migration 128) — o card mora aqui, não na listagem.
  const conn = await getBtgConnection(orgId)
  const btg = conn?.contaId === contaId ? {
    configured: btgConfigured(),
    env: btgEnv(),
    connected: !!conn.refreshToken && conn.status !== 'revoked',
    status: conn.status ?? null,
    companyId: conn.companyId ?? null,
    accountId: conn.accountId ?? null,
    lastSyncAt: conn.lastSyncAt ?? null,
    lastError: conn.lastError ?? null,
  } : null

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
        saldoInicial={Number(conta.saldo_inicial ?? 0)}
        saldoAtual={Number(conta.saldo_atual ?? 0)}
        saldoBanco={conta.saldo_banco != null ? Number(conta.saldo_banco) : null}
        saldoBancoData={(conta.saldo_banco_data as string) ?? null}
        temOfx={temOfx}
        today={today}
        slotConciliacao={temOfx ? <ConciliacaoClient orgSlug={orgSlug} {...conc} /> : null}
        slotIntegracao={btg ? (
          <BtgCard orgSlug={orgSlug} btg={btg}
            voltarPara={`/${orgSlug}/financeiro/contas/${contaId}`} />
        ) : null}
      />
    </div>
  )
}
