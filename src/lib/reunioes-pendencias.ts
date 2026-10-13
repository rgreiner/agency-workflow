import 'server-only'
import { getStatusConfig } from '@/lib/status'
import { docNumero } from '@/lib/doc-series'
import type { Pendencia } from '@/lib/reunioes'

interface Row {
  id: string
  texto: string
  responsavel: 'agencia' | 'cliente'
  ordem: number
  activity_id: string | null
  producao_id: string | null
  todo_id: string | null
  reunioes: { id: string; titulo: string; realizada_em: string; workspace_id: string; workspaces: { name: string } | null } | null
  activities: { id: string; title: string; status: string; campaign_id: string } | null
  producao: { id: string; numero: number | null; serie: string | null; titulo: string } | null
}

/**
 * Passos ainda em aberto das atas (mig. 306/307/341) — o check-list que vira a
 * pauta da próxima conversa com o cliente. "Em aberto" = não marcado feito E,
 * quando virou tarefa, a tarefa ainda não chegou num status de encerramento
 * (o desfecho conta pelo trabalho, não pelo vínculo).
 *
 * `antesDe` (YYYY-MM-DD) recorta só atas anteriores: é o que a ata nova mostra
 * como "o que ficou da última vez".
 */
export async function carregarPendencias(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  opts: { orgId: string; orgSlug: string; workspaceId?: string; excetoReuniao?: string; antesDe?: string },
): Promise<Pendencia[]> {
  let q = sb.from('reuniao_passos')
    .select('id, texto, responsavel, ordem, activity_id, producao_id, todo_id, reunioes!inner(id, titulo, realizada_em, workspace_id, workspaces(name)), activities(id, title, status, campaign_id), producao(id, numero, serie, titulo)')
    .eq('org_id', opts.orgId)
    .is('feito_em', null)
    .limit(500)
  if (opts.workspaceId) q = q.eq('reunioes.workspace_id', opts.workspaceId)
  if (opts.excetoReuniao) q = q.neq('reuniao_id', opts.excetoReuniao)
  if (opts.antesDe) q = q.lte('reunioes.realizada_em', opts.antesDe)
  const [{ data }, status] = await Promise.all([q, getStatusConfig(sb, opts.orgId)])
  const encerrado = new Set(status.filter(s => s.group === 'done').map(s => s.value as string))
  const rotulo = Object.fromEntries(status.map(s => [s.value as string, s.label]))

  return ((data ?? []) as Row[])
    .filter(p => p.reunioes && p.texto.trim())
    .filter(p => !(p.activities && encerrado.has(p.activities.status)))
    .map(p => {
      const r = p.reunioes!
      let andamento: Pendencia['andamento'] = null
      if (p.activities) {
        andamento = {
          tipo: 'tarefa', rotulo: rotulo[p.activities.status] ?? p.activities.status,
          href: `/${opts.orgSlug}/workspaces/${r.workspace_id}/campaigns/${p.activities.campaign_id}/activities/${p.activities.id}`,
        }
      } else if (p.producao) {
        andamento = { tipo: 'orcamento', rotulo: docNumero(p.producao.serie, p.producao.numero), href: `/${opts.orgSlug}/producao/orcamento/${p.producao.id}` }
      } else if (p.todo_id) {
        andamento = { tipo: 'anotacao', rotulo: 'Nas anotações', href: `/${opts.orgSlug}/inbox` }
      }
      return {
        passoId: p.id, reuniaoId: r.id, reuniaoTitulo: r.titulo, realizadaEm: r.realizada_em,
        workspaceId: r.workspace_id, cliente: r.workspaces?.name ?? '', texto: p.texto,
        responsavel: p.responsavel, andamento, ordem: p.ordem,
      }
    })
    .sort((a, b) => b.realizadaEm.localeCompare(a.realizadaEm) || a.ordem - b.ordem)
    .map(({ ordem: _o, ...p }) => p) // eslint-disable-line @typescript-eslint/no-unused-vars
}
