import Link from 'next/link'
import { CalendarClock, CalendarDays, Inbox, Truck, Users } from 'lucide-react'
import { assertMidiaAccess } from '@/lib/midia-hub'
import { carregarFilaMidia } from '@/lib/midia-fila'
import { unwrap } from '@/lib/supabase/unwrap'
import { PainelMidia, type PedidoRow, type RotinaRow } from '../PainelMidia'
import { EntregasResumo, type EntregaResumoRow } from '../EntregasResumo'
import { ImplantacaoResumo, type ImplantacaoRow } from '../ImplantacaoResumo'

export const metadata = { title: 'Mídia — Visão geral' }

export default async function MidiaVisaoGeralPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertMidiaAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [fila, resItens, resEstados] = await Promise.all([
    carregarFilaMidia(sb, orgId),
    sb.from('midia_implantacao_item').select('id').eq('org_id', orgId).eq('ativo', true),
    sb.from('midia_implantacao_estado').select('workspace_id, item_id, estado').eq('org_id', orgId),
  ])
  const itens = unwrap<{ id: string }>(resItens, 'itens de implantação')
  const estados = unwrap<{ workspace_id: string; item_id: string; estado: string }>(resEstados, 'implantação')

  const pedidos: PedidoRow[] = fila.tarefas.filter(t => !t.rotina).map(t => ({
    id: t.id, titulo: t.titulo, status: t.status, prazo: t.prazo,
    cliente: t.cliente, campanha: t.campanha,
    workspaceId: t.workspaceId, campaignId: t.campaignId,
    pastaUrl: t.pastaUrl, pastaPath: t.pastaPath,
    redacaoUrl: t.redacaoUrl, previewUrl: t.previewUrl, finalUrl: t.finalUrl,
  }))

  const rotinas: RotinaRow[] = fila.tarefas.filter(t => t.rotina).map(t => ({
    id: t.id, titulo: t.titulo, status: t.status, prazo: t.prazo,
    cliente: t.cliente, frequencia: t.rotina?.frequencia ?? '',
    workspaceId: t.workspaceId, campaignId: t.campaignId,
  }))

  // Implantação por cliente com mídia ativa: 'na' (não se aplica) sai do
  // denominador — item que nunca vai existir naquele cliente não pode segurar
  // o percentual para sempre.
  const totalItens = itens.length
  const implantacoes: ImplantacaoRow[] = fila.operacoes.map(o => {
    const doCliente = estados.filter(e => e.workspace_id === o.workspaceId)
    const na = doCliente.filter(e => e.estado === 'na').length
    const ok = doCliente.filter(e => e.estado === 'ok').length
    const perdidos = doCliente.filter(e => e.estado === 'perdido').length
    const vale = Math.max(totalItens - na, 0)
    return {
      workspaceId: o.workspaceId,
      cliente: o.cliente,
      pct: vale ? Math.round((ok / vale) * 100) : 100,
      ok, vale, perdidos,
    }
  }).filter(i => i.pct < 100 || i.perdidos > 0)
    .sort((a, b) => (b.perdidos - a.perdidos) || (a.pct - b.pct))

  const entregas: EntregaResumoRow[] = fila.entregas.map(e => ({
    id: e.id, titulo: e.titulo, cliente: e.cliente, veiculo: e.veiculo,
    prazoEnvio: e.prazoEnvio, conflito: e.conflito,
    tarefaTitulo: e.tarefaTitulo,
    materialPronto: e.materialPronto,
  }))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Visão geral</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            O retrato da operação: fila, rotinas por cliente, entregas e implantação.
            Para tocar o dia, use <Link href={`/${orgSlug}/midia`} className="text-orange-600 hover:text-orange-700">Trabalhar</Link>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/${orgSlug}/midia/agenda`}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors">
            <CalendarDays className="w-4 h-4" /> Agenda do mês
          </Link>
          <Link href={`/${orgSlug}/midia/clientes`}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
            <Users className="w-4 h-4" /> Clientes e rotinas
          </Link>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <Resumo icon={<Inbox className="w-4 h-4" />} label="Pedidos na fila" valor={pedidos.length} />
        <Resumo icon={<CalendarClock className="w-4 h-4" />} label="Rotinas ativas" valor={rotinas.length} />
        <Resumo icon={<Truck className="w-4 h-4" />} label="Entregas pendentes" valor={entregas.length} />
        <Resumo icon={<Users className="w-4 h-4" />} label="Clientes com mídia" valor={fila.operacoes.length} />
      </div>

      <EntregasResumo orgSlug={orgSlug} entregas={entregas} />

      <ImplantacaoResumo orgSlug={orgSlug} clientes={implantacoes} />

      <PainelMidia orgSlug={orgSlug} pedidos={pedidos} rotinas={rotinas} statusCfg={fila.statusCfg} />
    </div>
  )
}

function Resumo({ icon, label, valor }: { icon: React.ReactNode; label: string; valor: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-[11px] text-gray-400 inline-flex items-center gap-1.5">{icon} {label}</p>
      <p className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{valor}</p>
    </div>
  )
}
