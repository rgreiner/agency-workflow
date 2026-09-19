import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createDocument } from '@/app/actions/docs'
import { FileText, Plus, Lock, Building2, Target } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'
import { SubmitButton } from '@/components/ui/SubmitButton'

/**
 * Início de Documentos. A estrutura (dono → pasta → documento) mora na árvore da
 * sidebar desde 19/09/2026; aqui fica o que a árvore não mostra: o que mexeu por
 * último. Antes esta tela repetia a árvore agrupada por cliente — a mesma lista
 * duas vezes, lado a lado.
 */
export default async function DocsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', orgSlug)
    .single()
  if (!org) notFound()

  // Pastas vêm junto só para dar nome ao "em <pasta>" de cada documento.
  const { data: raw } = await supabase
    .from('documents')
    .select('id, title, visibility, updated_at, workspace_id, parent_id, is_folder, briefing_workspace_id, briefing_campaign_id, workspaces!workspace_id(name, color)')
    .eq('org_id', org.id)
    .eq('archived', false)
    .order('updated_at', { ascending: false })

  type Row = {
    id: string; title: string; visibility: string; updated_at: string
    workspace_id: string | null; parent_id: string | null; is_folder: boolean
    briefing_workspace_id: string | null; briefing_campaign_id: string | null
    workspaces: { name: string; color: string | null } | null
  }
  const rows = (raw ?? []) as unknown as Row[]
  const pastaDe = new Map(rows.filter(r => r.is_folder).map(r => [r.id, r.title]))
  const docs = rows.filter(r => !r.is_folder)

  async function handleCreate() {
    'use server'
    await createDocument(org!.id, orgSlug, null)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 md:px-8 md:py-8 max-w-3xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">Documentos</h1>
            <p className="text-sm text-gray-500 mt-0.5">Anotações e documentos internos da equipe</p>
          </div>
          <form action={handleCreate} className="shrink-0">
            <SubmitButton
              pendingLabel="Criando…"
              className="press px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Novo documento</span>
              <span className="sm:hidden">Novo</span>
            </SubmitButton>
          </form>
        </div>

        {docs.length === 0 ? (
          <div className="text-center py-20">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">Nenhum documento ainda</p>
            <p className="text-sm text-gray-500 mt-1">Crie o primeiro documento da sua equipe</p>
          </div>
        ) : (
          <section>
            <div className="flex items-baseline gap-2 mb-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recentes</h2>
              <span className="text-xs text-gray-400 tabular-nums">{docs.length}</span>
            </div>
            <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
              {docs.map(doc => {
                const briefing = !!(doc.briefing_workspace_id || doc.briefing_campaign_id)
                const pasta = doc.parent_id ? pastaDe.get(doc.parent_id) : null
                return (
                  <li key={doc.id}>
                    <Link
                      href={`/${orgSlug}/docs/${doc.id}`}
                      className="no-press flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                    >
                      {briefing
                        ? <Target className="w-4 h-4 text-orange-500 shrink-0" />
                        : <FileText className="w-4 h-4 text-gray-400 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium text-gray-800">
                          <span className="truncate">{doc.title || 'Sem título'}</span>
                          {briefing && (
                            <span className="shrink-0 rounded-md bg-orange-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-orange-600">
                              Briefing
                            </span>
                          )}
                          {doc.visibility === 'custom' && (
                            <Lock aria-label="Acesso restrito" className="w-3 h-3 text-gray-400 shrink-0" />
                          )}
                        </p>
                        {/* De quem é e onde está: "Senhas" existe em quase todo cliente. */}
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500 min-w-0">
                          {doc.workspace_id ? (
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: doc.workspaces?.color || '#f97316' }} />
                          ) : (
                            <Building2 className="w-3 h-3 text-gray-400 shrink-0" />
                          )}
                          <span className="truncate">
                            {doc.workspaces?.name ?? 'Organização'}
                            {pasta && <span className="text-gray-400"> / {pasta}</span>}
                          </span>
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-gray-400 tabular-nums">
                        {formatDistanceToNow(doc.updated_at)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
