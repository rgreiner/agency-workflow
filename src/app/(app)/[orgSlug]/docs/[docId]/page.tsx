import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { notFound } from 'next/navigation'
import { DocumentEditor } from '@/components/docs/DocumentEditor'
import { DocsSidebar } from '../DocsSidebar'

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
    .select('id, title, content, visibility, created_by, workspace_id, parent_id, workspaces(name)')
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

  // Documentos + pastas para a sidebar (navegar/organizar sem voltar à listagem)
  const { data: allDocs } = await supabase
    .from('documents')
    .select('id, title, visibility, workspace_id, parent_id, is_folder, workspaces(name)')
    .eq('org_id', org.id)
    .order('is_folder', { ascending: false })
    .order('title', { ascending: true })

  // Clientes para associar o documento
  const { data: workspaces } = await supabase
    .from('workspaces').select('id, name').eq('org_id', org.id).neq('archived', true).order('name')

  // Se o doc está dentro de uma pasta, o acesso herda da pasta-RAIZ (mostra o nome).
  const docParentId = (doc as { parent_id: string | null }).parent_id
  let parentFolderName: string | null = null
  if (docParentId) {
    const byId = new Map(((allDocs ?? []) as { id: string; title: string; parent_id: string | null }[]).map(d => [d.id, d]))
    let node = byId.get(docParentId)
    while (node?.parent_id) node = byId.get(node.parent_id)
    parentFolderName = node?.title ?? null
  }

  return (
    <div className="flex h-full">
      <DocsSidebar
        orgSlug={orgSlug}
        orgId={org.id}
        currentDocId={doc.id}
        currentUserId={user.id}
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
          parentFolderName={parentFolderName}
        />
      </div>
    </div>
  )
}
