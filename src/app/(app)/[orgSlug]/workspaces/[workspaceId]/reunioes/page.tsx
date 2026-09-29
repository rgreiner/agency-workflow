import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NotebookPen, Plus, Globe, ListChecks } from 'lucide-react'
import { dataBR } from '@/lib/reunioes'

export const metadata = { title: 'Reuniões — Flow' }

interface Linha {
  id: string
  titulo: string
  realizada_em: string
  publicada: boolean
  campaigns: { name: string } | null
  reuniao_passos: { responsavel: string; activity_id: string | null }[]
}

/**
 * Atas de reunião do cliente (mig. 306). Todo membro lê; o Atendimento (ou
 * admin) cria e publica. Publicada = o cliente vê resumo e próximos passos no portal.
 */
export default async function ReunioesPage({ params }: {
  params: Promise<{ orgSlug: string; workspaceId: string }>
}) {
  const { orgSlug, workspaceId } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: workspace } = await supabase
    .from('workspaces').select('id, name, org_id').eq('id', workspaceId).maybeSingle()
  if (!workspace) notFound()

  const [{ data: rows }, { data: podeGerir }] = await Promise.all([
    sb.from('reunioes')
      .select('id, titulo, realizada_em, publicada, campaigns(name), reuniao_passos(responsavel, activity_id)')
      .eq('workspace_id', workspaceId)
      .order('realizada_em', { ascending: false })
      .order('created_at', { ascending: false }),
    sb.rpc('portal_pode_gerir', { p_org: workspace.org_id }),
  ])
  const reunioes = (rows ?? []) as Linha[]
  const base = `/${orgSlug}/workspaces/${workspaceId}/reunioes`

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-1 text-xs text-gray-400">
        <Link href={`/${orgSlug}/workspaces`} className="hover:text-gray-600 transition-colors">Clientes</Link>
        {' / '}
        <Link href={`/${orgSlug}/workspaces/${workspaceId}`} className="hover:text-gray-600 transition-colors">{workspace.name}</Link>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <NotebookPen className="w-5 h-5 text-orange-600" /> Reuniões
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Atas com o cliente. Os próximos passos da agência viram tarefa com o briefing já rascunhado.
          </p>
        </div>
        {podeGerir && (
          <Link href={`${base}/nova`}
            className="press inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-xl text-[#fff] bg-orange-600 hover:bg-orange-700 transition-colors">
            <Plus className="w-4 h-4" /> Nova ata
          </Link>
        )}
      </div>

      {reunioes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-12 text-center">
          <p className="text-sm font-medium text-gray-700">Nenhuma ata ainda</p>
          <p className="text-sm text-gray-500 mt-1">
            {podeGerir
              ? 'Depois da reunião, cole as notas do Granola em "Nova ata". A IA separa o resumo e os próximos passos.'
              : 'O Atendimento registra aqui as atas das reuniões com o cliente.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {reunioes.map(r => {
            const daAgencia = r.reuniao_passos.filter(p => p.responsavel === 'agencia')
            const pendentes = daAgencia.filter(p => !p.activity_id).length
            return (
              <li key={r.id}>
                <Link href={`${base}/${r.id}`}
                  className="flex items-center gap-4 rounded-2xl bg-white border border-gray-200 px-4 py-3.5 hover:bg-gray-50 transition-colors">
                  <div className="w-14 shrink-0 text-center">
                    <p className="text-xs text-gray-400 tabular-nums">{dataBR(r.realizada_em).slice(0, 5)}</p>
                    <p className="text-[11px] text-gray-400 tabular-nums">{r.realizada_em.slice(0, 4)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{r.titulo}</p>
                    {r.campaigns?.name && <p className="text-xs text-gray-500 truncate mt-0.5">{r.campaigns.name}</p>}
                  </div>
                  {daAgencia.length > 0 && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-xs text-gray-500 tabular-nums"
                      title={pendentes ? `${pendentes} passo(s) da agência ainda sem tarefa` : 'Todos os passos da agência viraram tarefa'}>
                      <ListChecks className={pendentes ? 'w-3.5 h-3.5 text-orange-600' : 'w-3.5 h-3.5 text-green-600'} />
                      {daAgencia.length - pendentes}/{daAgencia.length}
                    </span>
                  )}
                  {r.publicada && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700" title="O cliente vê esta ata no portal">
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
