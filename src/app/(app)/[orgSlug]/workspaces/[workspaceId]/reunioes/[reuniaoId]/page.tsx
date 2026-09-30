import { notFound } from 'next/navigation'
import { ReuniaoEditor } from '../ReuniaoEditor'
import { docNumero } from '@/lib/doc-series'
import { contextoReuniao } from '../dados'
import type { Reuniao, LinkPasso } from '@/lib/reunioes'

export const metadata = { title: 'Ata de reunião — Flow' }

interface Row {
  id: string; titulo: string; realizada_em: string; campaign_id: string | null
  participantes: string | null; notas: string | null; transcricao: string | null
  resumo: string | null; publicada: boolean
  reuniao_passos: {
    id: string; ordem: number; texto: string; responsavel: 'agencia' | 'cliente'
    rascunho: string | null; activity_id: string | null
    producao_id: string | null; feito_em: string | null
    activities: { id: string; title: string; campaign_id: string } | null
    producao: { id: string; numero: number | null; serie: string | null; titulo: string } | null
  }[]
}

export default async function ReuniaoPage({ params }: {
  params: Promise<{ orgSlug: string; workspaceId: string; reuniaoId: string }>
}) {
  const { orgSlug, workspaceId, reuniaoId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(reuniaoId)) notFound()
  const ctx = await contextoReuniao(workspaceId)
  if (!ctx) notFound()

  const { data } = await ctx.sb.from('reunioes')
    .select('id, titulo, realizada_em, campaign_id, participantes, notas, transcricao, resumo, publicada, reuniao_passos(id, ordem, texto, responsavel, rascunho, activity_id, producao_id, feito_em, activities(id, title, campaign_id), producao(id, numero, serie, titulo))')
    .eq('id', reuniaoId).eq('workspace_id', workspaceId).maybeSingle()
  const r = data as Row | null
  if (!r) notFound()

  const passos = [...r.reuniao_passos].sort((a, b) => a.ordem - b.ordem)
  // Campanha arquivada some das opções, mas a da ata continua aparecendo.
  const campanhas = r.campaign_id && !ctx.campanhas.some(c => c.id === r.campaign_id)
    ? [...ctx.campanhas, { id: r.campaign_id, name: '(campanha arquivada)' }]
    : ctx.campanhas

  const tarefas: Record<string, LinkPasso> = {}
  const orcamentos: Record<string, LinkPasso> = {}
  for (const p of passos) {
    if (p.producao) {
      orcamentos[p.id] = {
        titulo: `${docNumero(p.producao.serie, p.producao.numero)} · ${p.producao.titulo}`,
        href: `/${orgSlug}/producao/orcamento/${p.producao.id}`,
      }
    }
    if (p.activities) {
      tarefas[p.id] = {
        titulo: p.activities.title,
        href: `/${orgSlug}/workspaces/${workspaceId}/campaigns/${p.activities.campaign_id}/activities/${p.activities.id}`,
      }
    }
  }

  const inicial: Reuniao = {
    id: r.id,
    titulo: r.titulo,
    realizadaEm: r.realizada_em,
    campaignId: r.campaign_id,
    participantes: r.participantes ?? '',
    notas: r.notas ?? '',
    transcricao: r.transcricao ?? '',
    resumo: r.resumo ?? '',
    publicada: r.publicada,
    passos: passos.map(p => ({
      id: p.id, texto: p.texto, responsavel: p.responsavel,
      rascunho: p.rascunho ?? '', activityId: p.activity_id,
      producaoId: p.producao_id, feito: !!p.feito_em,
    })),
  }

  return (
    <ReuniaoEditor
      key={r.id}
      orgSlug={orgSlug}
      workspaceId={workspaceId}
      clienteNome={ctx.clienteNome}
      campanhas={campanhas}
      tarefas={tarefas}
      orcamentos={orcamentos}
      podeEditar={ctx.podeGerir}
      inicial={inicial}
    />
  )
}
