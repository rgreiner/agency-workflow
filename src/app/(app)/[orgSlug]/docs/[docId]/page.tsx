import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { notFound } from 'next/navigation'
import { DocumentEditor } from '@/components/docs/DocumentEditor'
import { DocsSidebar } from './DocsSidebar'

export default async function DocPage({
  params,
}: {
  params: Promise<{ orgSlug: string; docId: string }>
}) {
  const { orgSlug, docId } = await params
  const supabase = await createClient()

  const user = await getUsuario()
  if (!user) notFound()

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .single()
  if (!org) notFound()

  const { data: doc } = await supabase
    .from('documents')
    .select('id, title, content, visibility, created_by, workspace_id, workspaces(name)')
    .eq('id', docId)
    .single()
  if (!doc) notFound()

  const { data: sharedMembers } = await supabase
    .from('document_members')
    .select('user_id')
    .eq('document_id', docId)

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', org.id)
    .eq('user_id', user.id)
    .single()

  const { data: membersRaw } = await supabase
    .from('organization_members')
    .select('user_id, profiles!user_id(full_name, email)')
    .eq('org_id', org.id)

  const members = (membersRaw ?? []).map(m => {
    const p = m.profiles as unknown as { full_name: string | null; email: string } | null
    return { userId: m.user_id, fullName: p?.full_name ?? null, email: p?.email ?? '' }
  })

  const canManage =
    doc.created_by === user.id ||
    ['owner', 'admin'].includes(membership?.role ?? '')

  const workspaceName = (doc.workspaces as unknown as { name: string } | null)?.name ?? null

  // Lista de documentos para a sidebar (navegar sem voltar à listagem)
  const { data: allDocs } = await supabase
    .from('documents')
    .select('id, title, visibility, workspace_id, workspaces(name)')
    .eq('org_id', org.id)
    .is('parent_id', null)
    .order('updated_at', { ascending: false })

  // Clientes para associar o documento
  const { data: workspaces } = await supabase
    .from('workspaces').select('id, name').eq('org_id', org.id).neq('archived', true).order('name')

  return (
    <div className="flex h-full">
      <DocsSidebar
        orgSlug={orgSlug}
        orgId={org.id}
        currentDocId={doc.id}
        docs={(allDocs ?? []) as unknown as Parameters<typeof DocsSidebar>[0]['docs']}
      />
      <div className="flex-1 min-w-0">
        <DocumentEditor
          docId={doc.id}
          orgSlug={orgSlug}
          orgId={org.id}
          currentUserId={user.id}
          canManage={canManage}
          initialTitle={doc.title}
          initialContent={doc.content as object}
          initialVisibility={doc.visibility as 'org' | 'custom'}
          initialMemberIds={(sharedMembers ?? []).map(m => m.user_id)}
          members={members}
          workspaceName={workspaceName}
          workspaces={workspaces ?? []}
          initialWorkspaceId={doc.workspace_id ?? null}
        />
      </div>
    </div>
  )
}
