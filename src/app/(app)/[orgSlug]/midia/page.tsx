import { assertMidiaAccess } from '@/lib/midia-hub'
import { carregarFilaMidia } from '@/lib/midia-fila'
import { Trabalhar, type ItemFila } from './Trabalhar'

export const metadata = { title: 'Mídia — Trabalhar' }

export default async function MidiaTrabalharPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId, userId } = await assertMidiaAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fila = await carregarFilaMidia(supabase as any, orgId)

  // Uma linha por trabalho. Entrega vinculada a uma tarefa que já está na fila
  // apareceria DUAS vezes; a entrega vence, porque o prazo do veículo é o que
  // manda e ela já carrega o status e as pastas da tarefa junto.
  const porId = new Map(fila.tarefas.map(t => [t.id, t]))
  const comEntrega = new Set(fila.entregas.map(e => e.activityId).filter(Boolean) as string[])

  const daEntrega: ItemFila[] = fila.entregas.map(e => {
    const t = e.activityId ? porId.get(e.activityId) ?? null : null
    return {
      chave: `e:${e.id}`,
      tipo: 'entrega',
      titulo: e.titulo,
      cliente: e.cliente,
      data: e.prazoEnvio,
      activityId: e.activityId,
      status: e.tarefaStatus,
      workspaceId: t?.workspaceId ?? null,
      campaignId: t?.campaignId ?? null,
      pastaPath: t?.pastaPath ?? null,
      previewUrl: t?.previewUrl ?? null,
      finalUrl: t?.finalUrl ?? null,
      entregaId: e.id,
      veiculo: e.veiculo,
      conflito: e.conflito,
      esperandoCriacao: !!e.activityId && !e.materialPronto,
      frequencia: null,
      // A entrega não tem responsável; herda o da tarefa quando há uma.
      assigneeIds: t?.assigneeIds ?? [],
      pedidoPor: t?.pedidoPor ?? null,
      entrouEm: t?.entrouEm ?? null,
      criadaEm: t?.criadaEm ?? null,
      prioridade: t?.prioridade ?? 'medium',
      complexidade: t?.complexidade ?? 'medium',
      checklist: t && t.checklist.total > 0 ? { feitos: t.checklist.feitos, total: t.checklist.total } : null,
    }
  })

  const dasTarefas: ItemFila[] = fila.tarefas
    .filter(t => !comEntrega.has(t.id))
    .map(t => ({
      chave: `t:${t.id}`,
      tipo: t.rotina ? 'rotina' : 'pedido',
      titulo: t.titulo,
      cliente: t.cliente,
      data: t.prazo,
      activityId: t.id,
      status: t.status,
      workspaceId: t.workspaceId,
      campaignId: t.campaignId,
      pastaPath: t.pastaPath,
      previewUrl: t.previewUrl,
      finalUrl: t.finalUrl,
      entregaId: null,
      veiculo: null,
      conflito: false,
      esperandoCriacao: false,
      frequencia: t.rotina?.frequencia ?? null,
      assigneeIds: t.assigneeIds,
      pedidoPor: t.pedidoPor,
      entrouEm: t.entrouEm,
      criadaEm: t.criadaEm,
      prioridade: t.prioridade,
      complexidade: t.complexidade,
      checklist: t.checklist.total > 0 ? { feitos: t.checklist.feitos, total: t.checklist.total } : null,
    }))

  // Sem data vai para o fim: não dá para priorizar o que ninguém datou.
  const itens = [...daEntrega, ...dasTarefas].sort((a, b) =>
    (a.data ?? '9999-12-31').localeCompare(b.data ?? '9999-12-31'))

  return <Trabalhar orgSlug={orgSlug} itens={itens} statusCfg={fila.statusCfg} meuId={userId} />
}
