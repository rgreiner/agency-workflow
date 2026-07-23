import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { loadActivityList } from '@/lib/activity-list'
import { ListaClient } from '../../views/lista/ListaClient'
import { WorkspaceEditButton } from './WorkspaceEditButton'
import { PortalAccessButton, type PortalUserRow } from './PortalAccessButton'
import { UnarchiveButton } from '@/components/ui/UnarchiveButton'
import { ImportSpecsButton } from './campaigns/[campaignId]/ImportSpecsButton'

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; workspaceId: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { orgSlug, workspaceId } = await params
  const { view } = await searchParams
  const archivedView = view === 'arquivadas'
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: workspace } = await (supabase as any)
    .from('workspaces')
    .select('id, name, color, description, archived, legal_name, trade_name, tax_id, state_registration, city_registration, finance_email, phone, contact_name, address_zip, address_street, address_number, address_complement, address_district, address_city, address_state, payment_terms, atividade, cobranca_auto, enderecos, telefones, emails, contas_bancarias')
    .eq('id', workspaceId).single()
  if (!workspace) return null

  const { data: archivedCampaigns } = await supabase
    .from('campaigns').select('id, name').eq('workspace_id', workspaceId).eq('archived', true)
    .order('name', { ascending: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: portalUsers } = await (supabase as any)
    .from('portal_users')
    .select('id, nome, email, ativo, last_login_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  const data = await loadActivityList(orgSlug, { scopeWorkspaceId: workspaceId, archived: archivedView })
  if (!data) return null

  const campaignOptions = Object.entries(data.campMap).map(([id, c]) => ({ id, name: c.name }))

  return (
    <>
      <ListaClient
        orgSlug={orgSlug}
        activities={data.activities}
        campMap={data.campMap}
        members={data.members}
        view={archivedView ? 'arquivadas' : 'ativas'}
        title={workspace.name}
        routeBase={`workspaces/${workspaceId}`}
        breadcrumb={<Link href={`/${orgSlug}/workspaces`} className="hover:text-gray-600 transition">Clientes</Link>}
        titleActions={
          <>
          <PortalAccessButton
            orgSlug={orgSlug}
            workspaceId={workspaceId}
            contatos={(portalUsers ?? []) as PortalUserRow[]}
          />
          <WorkspaceEditButton
            orgSlug={orgSlug}
            workspaceId={workspaceId}
            name={workspace.name}
            archived={workspace.archived ?? false}
            initial={{
              name: workspace.name ?? '',
              description: workspace.description ?? '',
              color: workspace.color ?? '#6366f1',
              legal_name: workspace.legal_name ?? '',
              trade_name: workspace.trade_name ?? '',
              tax_id: workspace.tax_id ?? '',
              state_registration: workspace.state_registration ?? '',
              city_registration: workspace.city_registration ?? '',
              finance_email: workspace.finance_email ?? '',
              phone: workspace.phone ?? '',
              contact_name: workspace.contact_name ?? '',
              address_zip: workspace.address_zip ?? '',
              address_street: workspace.address_street ?? '',
              address_number: workspace.address_number ?? '',
              address_complement: workspace.address_complement ?? '',
              address_district: workspace.address_district ?? '',
              address_city: workspace.address_city ?? '',
              address_state: workspace.address_state ?? '',
              payment_terms: workspace.payment_terms ?? '',
              atividade: workspace.atividade ?? '',
              cobranca_auto: workspace.cobranca_auto ? 'true' : 'false',
            }}
            initialContato={{
              enderecos: workspace.enderecos ?? [],
              telefones: workspace.telefones ?? [],
              emails: workspace.emails ?? [],
              contas_bancarias: workspace.contas_bancarias ?? [],
            }}
          />
          </>
        }
        secondaryActions={
          <>
            {campaignOptions.length > 0 && (
              <ImportSpecsButton orgSlug={orgSlug} campaigns={campaignOptions} />
            )}
            <Link
              href={`/${orgSlug}/workspaces/${workspaceId}/campaigns/new`}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
            >
              <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Nova campanha</span>
            </Link>
          </>
        }
      />

      {/* Campanhas arquivadas */}
      {archivedCampaigns && archivedCampaigns.length > 0 && (
        <div className="px-6 pb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Campanhas arquivadas</h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {archivedCampaigns.map(camp => (
              <div key={camp.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-gray-600">{camp.name}</span>
                <UnarchiveButton orgSlug={orgSlug} workspaceId={workspaceId} campaignId={camp.id} />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
