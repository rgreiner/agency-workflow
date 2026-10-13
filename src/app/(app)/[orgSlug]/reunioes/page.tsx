import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NotebookPen, Globe, ChevronRight, Plus } from 'lucide-react'
import { dataBR, type Pendencia } from '@/lib/reunioes'
import { carregarPendencias } from '@/lib/reunioes-pendencias'
import { porNome } from '@/lib/utils'
import { FiltrosReunioes } from './FiltrosReunioes'
import { PendenciasChecklist } from './PendenciasChecklist'

export const metadata = { title: 'Reuniões — Flow' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Sem filtro, cada cliente mostra as últimas atas; o resto fica a um clique.
const ATAS_POR_CLIENTE = 4

interface Linha {
  id: string
  titulo: string
  realizada_em: string
  publicada: boolean
  workspace_id: string
  workspaces: { name: string } | null
  campaigns: { name: string } | null
}

/**
 * Reuniões por CLIENTE (13/10/2026): cada cliente traz o check-list do que ficou
 * em aberto em todas as atas dele — a pauta da próxima conversa — e as atas
 * mais recentes. Filtro ?ws=&c= continua (o botão do cliente e o da campanha
 * caem aqui já filtrados).
 */
export default async function ReunioesPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ ws?: string; c?: string }>
}) {
  const { orgSlug } = await params
  const sp = await searchParams
  const ws = sp.ws && UUID_RE.test(sp.ws) ? sp.ws : ''
  const c = ws && sp.c && UUID_RE.test(sp.c) ? sp.c : ''
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).maybeSingle()
  if (!org) notFound()

  let q = sb.from('reunioes')
    .select('id, titulo, realizada_em, publicada, workspace_id, workspaces(name), campaigns(name)')
    .eq('org_id', org.id)
    .order('realizada_em', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(300)
  if (ws) q = q.eq('workspace_id', ws)
  if (c) q = q.eq('campaign_id', c)

  const [{ data: rows }, { data: podeGerir }, { data: clientes }, { data: campanhas }, pendencias] = await Promise.all([
    q,
    sb.rpc('portal_pode_gerir', { p_org: org.id }),
    supabase.from('workspaces').select('id, name').eq('org_id', org.id).eq('archived', false),
    ws
      ? supabase.from('campaigns').select('id, name').eq('workspace_id', ws).eq('archived', false).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    carregarPendencias(sb, { orgId: org.id, orgSlug, workspaceId: ws || undefined }),
  ])
  const reunioes = (rows ?? []) as Linha[]
  const listaClientes = ((clientes ?? []) as { id: string; name: string }[]).sort(porNome(x => x.name))
  const pode = podeGerir === true

  // Agrupa por cliente, na ordem da reunião mais recente.
  const grupos: { workspaceId: string; nome: string; atas: Linha[]; pend: Pendencia[] }[] = []
  for (const r of reunioes) {
    let g = grupos.find(x => x.workspaceId === r.workspace_id)
    if (!g) { g = { workspaceId: r.workspace_id, nome: r.workspaces?.name ?? 'Cliente', atas: [], pend: [] }; grupos.push(g) }
    g.atas.push(r)
  }
  for (const p of pendencias) grupos.find(g => g.workspaceId === p.workspaceId)?.pend.push(p)
  const totalPend = pendencias.length

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <NotebookPen className="w-5 h-5 text-orange-600" /> Reuniões
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Por cliente: o que ficou em aberto nas atas (a pauta da próxima conversa) e as reuniões mais recentes.
            {totalPend > 0 && <> <span className="font-medium text-gray-700">{totalPend} pendência(s)</span> em aberto.</>}
          </p>
        </div>
      </div>

      <FiltrosReunioes
        orgSlug={orgSlug}
        clientes={listaClientes}
        campanhas={(campanhas ?? []) as { id: string; name: string }[]}
        ws={ws}
        c={c}
        podeCriar={pode}
      />

      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-12 text-center">
          <p className="text-sm font-medium text-gray-700">Nenhuma ata {ws ? 'com este filtro' : 'ainda'}</p>
          <p className="text-sm text-gray-500 mt-1">
            {pode
              ? 'Depois da reunião, cole as notas do Granola em "Nova ata". A IA separa o resumo e os próximos passos.'
              : 'O Atendimento registra aqui as atas das reuniões com os clientes.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.map(g => {
            const atas = ws ? g.atas : g.atas.slice(0, ATAS_POR_CLIENTE)
            const resto = g.atas.length - atas.length
            return (
              <details key={g.workspaceId} open className="group rounded-2xl bg-white border border-gray-200">
                <summary className="flex items-center gap-3 px-4 py-3.5 cursor-pointer list-none select-none">
                  <ChevronRight className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-90 shrink-0" />
                  <h2 className="text-sm font-semibold text-gray-900 truncate">{g.nome}</h2>
                  <span className="text-xs text-gray-500 tabular-nums">{g.atas.length} {g.atas.length === 1 ? 'reunião' : 'reuniões'}</span>
                  {g.pend.length > 0 && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-600 tabular-nums">
                      {g.pend.length} em aberto
                    </span>
                  )}
                  {pode && (
                    <Link href={`/${orgSlug}/workspaces/${g.workspaceId}/reunioes/nova`}
                      title={`Nova ata de ${g.nome}`}
                      className="press ml-auto inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg transition-colors">
                      <Plus className="w-3.5 h-3.5" /> Nova ata
                    </Link>
                  )}
                </summary>

                <div className="px-4 pb-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <section>
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-1">Em aberto</h3>
                    <PendenciasChecklist orgSlug={orgSlug} cliente={g.nome} itens={g.pend} podeEditar={pode} />
                  </section>

                  <section>
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-2">Reuniões</h3>
                    <ul className="space-y-1">
                      {atas.map(r => (
                        <li key={r.id}>
                          <Link href={`/${orgSlug}/workspaces/${r.workspace_id}/reunioes/${r.id}`}
                            className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-gray-50 transition-colors">
                            <span className="text-xs text-gray-500 tabular-nums shrink-0">{dataBR(r.realizada_em).slice(0, 5)}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm text-gray-900 truncate">{r.titulo}</span>
                              {r.campaigns?.name && <span className="block text-[11px] text-gray-400 truncate">{r.campaigns.name}</span>}
                            </span>
                            {r.publicada && <Globe className="w-3.5 h-3.5 text-green-600 shrink-0" aria-label="No portal do cliente" />}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {resto > 0 && (
                      <Link href={`/${orgSlug}/reunioes?ws=${g.workspaceId}`}
                        className="mt-1 inline-block text-xs font-medium text-gray-500 hover:text-gray-800 px-2.5 py-1 transition-colors">
                        Ver as outras {resto}
                      </Link>
                    )}
                  </section>
                </div>
              </details>
            )
          })}
        </div>
      )}
    </div>
  )
}
