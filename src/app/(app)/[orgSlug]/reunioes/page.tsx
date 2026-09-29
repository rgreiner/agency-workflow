import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NotebookPen, Globe, ListChecks } from 'lucide-react'
import { dataBR } from '@/lib/reunioes'
import { porNome } from '@/lib/utils'
import { FiltrosReunioes } from './FiltrosReunioes'

export const metadata = { title: 'Reuniões — Flow' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Linha {
  id: string
  titulo: string
  realizada_em: string
  publicada: boolean
  workspace_id: string
  workspaces: { name: string } | null
  campaigns: { name: string } | null
  reuniao_passos: { responsavel: string; activity_id: string | null }[]
}

/**
 * Atas de reunião de todos os clientes (mig. 306), com filtro por cliente e
 * campanha (?ws=, ?c=). O botão do cliente e o da campanha caem aqui já
 * filtrados. Todo membro lê; o Atendimento (ou admin) cria e publica.
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
    .select('id, titulo, realizada_em, publicada, workspace_id, workspaces(name), campaigns(name), reuniao_passos(responsavel, activity_id)')
    .eq('org_id', org.id)
    .order('realizada_em', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)
  if (ws) q = q.eq('workspace_id', ws)
  if (c) q = q.eq('campaign_id', c)

  const [{ data: rows }, { data: podeGerir }, { data: clientes }, { data: campanhas }] = await Promise.all([
    q,
    sb.rpc('portal_pode_gerir', { p_org: org.id }),
    supabase.from('workspaces').select('id, name').eq('org_id', org.id).eq('archived', false),
    ws
      ? supabase.from('campaigns').select('id, name').eq('workspace_id', ws).eq('archived', false).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const reunioes = (rows ?? []) as Linha[]
  const listaClientes = ((clientes ?? []) as { id: string; name: string }[]).sort(porNome(x => x.name))

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <NotebookPen className="w-5 h-5 text-orange-600" /> Reuniões
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Atas com os clientes. Os próximos passos da agência viram tarefa com o briefing já rascunhado.
          </p>
        </div>
      </div>

      <FiltrosReunioes
        orgSlug={orgSlug}
        clientes={listaClientes}
        campanhas={(campanhas ?? []) as { id: string; name: string }[]}
        ws={ws}
        c={c}
        podeCriar={podeGerir === true}
      />

      {reunioes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-12 text-center">
          <p className="text-sm font-medium text-gray-700">Nenhuma ata {ws ? 'com este filtro' : 'ainda'}</p>
          <p className="text-sm text-gray-500 mt-1">
            {podeGerir
              ? 'Depois da reunião, cole as notas do Granola em "Nova ata". A IA separa o resumo e os próximos passos.'
              : 'O Atendimento registra aqui as atas das reuniões com os clientes.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {reunioes.map(r => {
            const daAgencia = r.reuniao_passos.filter(p => p.responsavel === 'agencia')
            const pendentes = daAgencia.filter(p => !p.activity_id).length
            const sub = [ws ? null : r.workspaces?.name, r.campaigns?.name].filter(Boolean).join(' · ')
            return (
              <li key={r.id}>
                <Link href={`/${orgSlug}/workspaces/${r.workspace_id}/reunioes/${r.id}`}
                  className="flex items-center gap-4 rounded-2xl bg-white border border-gray-200 px-4 py-3.5 hover:bg-gray-50 transition-colors">
                  <div className="w-14 shrink-0 text-center">
                    <p className="text-xs text-gray-500 tabular-nums">{dataBR(r.realizada_em).slice(0, 5)}</p>
                    <p className="text-[11px] text-gray-400 tabular-nums">{r.realizada_em.slice(0, 4)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{r.titulo}</p>
                    {sub && <p className="text-xs text-gray-500 truncate mt-0.5">{sub}</p>}
                  </div>
                  {daAgencia.length > 0 && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-xs text-gray-500 tabular-nums"
                      title={pendentes ? `${pendentes} passo(s) da agência ainda sem tarefa` : 'Todos os passos da agência viraram tarefa'}>
                      <ListChecks className={pendentes ? 'w-3.5 h-3.5 text-orange-600' : 'w-3.5 h-3.5 text-green-600'} />
                      {daAgencia.length - pendentes}/{daAgencia.length}
                    </span>
                  )}
                  {r.publicada && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-600" title="O cliente vê esta ata no portal">
                      <Globe className="w-3 h-3" /> No portal
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
