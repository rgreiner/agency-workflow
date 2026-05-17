import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createDocument } from '@/app/actions/docs'
import { FileText, Plus, Globe, Lock, Building2 } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

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

  const { data: docs } = await supabase
    .from('documents')
    .select('id, title, visibility, created_at, updated_at, workspace_id, workspaces(name), profiles!created_by(full_name)')
    .eq('org_id', org.id)
    .is('parent_id', null)
    .order('updated_at', { ascending: false })

  const orgDocs = (docs ?? []).filter(d => !d.workspace_id)
  const workspaceDocs = (docs ?? []).filter(d => d.workspace_id)

  const workspaceGroups = workspaceDocs.reduce<Record<string, { name: string; docs: typeof workspaceDocs }>>((acc, doc) => {
    const wsId = doc.workspace_id!
    const wsName = (doc.workspaces as unknown as { name: string } | null)?.name ?? 'Cliente'
    if (!acc[wsId]) acc[wsId] = { name: wsName, docs: [] }
    acc[wsId].docs.push(doc)
    return acc
  }, {})

  async function handleCreate(formData: FormData) {
    'use server'
    const workspaceId = formData.get('workspace_id') as string | null
    await createDocument(org!.id, orgSlug, workspaceId || null)
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documentos</h1>
          <p className="text-sm text-gray-500 mt-0.5">Anotações e documentos internos da equipe</p>
        </div>
        <form action={handleCreate}>
          <button
            type="submit"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition"
          >
            <Plus className="w-4 h-4" />
            Novo documento
          </button>
        </form>
      </div>

      {docs?.length === 0 && (
        <div className="text-center py-20">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 font-medium">Nenhum documento ainda</p>
          <p className="text-sm text-gray-400 mt-1">Crie o primeiro documento da sua equipe</p>
        </div>
      )}

      {/* Org-level docs */}
      {orgDocs.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Organização</h2>
          </div>
          <DocList docs={orgDocs} orgSlug={orgSlug} />
        </section>
      )}

      {/* Workspace-grouped docs */}
      {Object.entries(workspaceGroups).map(([wsId, group]) => (
        <section key={wsId} className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2.5 h-2.5 rounded-sm bg-indigo-400" />
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{group.name}</h2>
          </div>
          <DocList docs={group.docs} orgSlug={orgSlug} />
        </section>
      ))}
    </div>
  )
}

function DocList({
  docs,
  orgSlug,
}: {
  docs: {
    id: string
    title: string
    visibility: string
    updated_at: string
    profiles?: unknown
  }[]
  orgSlug: string
}) {
  return (
    <div className="space-y-1">
      {docs.map(doc => {
        const author = (doc.profiles as { full_name: string | null } | null)?.full_name
        return (
          <Link
            key={doc.id}
            href={`/${orgSlug}/docs/${doc.id}`}
            className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-50 border border-transparent hover:border-gray-200 transition group"
          >
            <FileText className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="flex-1 text-sm font-medium text-gray-800 truncate">
              {doc.title || 'Sem título'}
            </span>
            <span className="text-xs text-gray-400 shrink-0">
              {formatDistanceToNow(doc.updated_at)}
            </span>
            {doc.visibility === 'org'
              ? <Globe className="w-3.5 h-3.5 text-gray-300 shrink-0" title="Todo o time" />
              : <Lock className="w-3.5 h-3.5 text-gray-300 shrink-0" title="Restrito" />
            }
          </Link>
        )
      })}
    </div>
  )
}
