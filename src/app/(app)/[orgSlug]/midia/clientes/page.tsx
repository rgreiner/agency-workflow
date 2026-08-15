import { assertMidiaAccess } from '@/lib/midia-hub'
import { unwrap } from '@/lib/supabase/unwrap'
import { porNome } from '@/lib/utils'
import { ClientesMidia, type ClienteRow, type RotinaCatalogo, type ItemImplantacao } from './ClientesMidia'

export const metadata = { title: 'Mídia — Clientes e rotinas' }

export default async function MidiaClientesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertMidiaAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [resWs, resOper, resRot, resMembros, resItens, resEstados] = await Promise.all([
    sb.from('workspaces').select('id, name, archived').eq('org_id', orgId),
    sb.from('midia_cliente')
      .select('id, ano, ativo, workspace_id, campaign_id, plano_url, specs_url, crm_url, drive_folder_id, observacao, midia_cliente_rotina(id, ativo, rotina_id, activity_id, activities!activity_id(id, title, due_date, status, archived))')
      .eq('org_id', orgId),
    sb.from('midia_rotina').select('id, nome, descricao, frequencia, dia_mes, dia_semana, pasta, padrao, ordem, ativo')
      .eq('org_id', orgId).eq('ativo', true).order('ordem'),
    sb.from('organization_members')
      // `profiles!user_id`: organization_members tem mais de uma FK para
      // profiles, e sem dizer qual o PostgREST recusa o embed inteiro.
      .select('user_id, arquivado, profiles!user_id(id, full_name)')
      .eq('org_id', orgId).eq('arquivado', false),
    sb.from('midia_implantacao_item').select('id, bloco, nome, ordem')
      .eq('org_id', orgId).eq('ativo', true).order('bloco').order('ordem'),
    sb.from('midia_implantacao_estado').select('workspace_id, item_id, estado, nota').eq('org_id', orgId),
  ])

  const workspaces = unwrap<{ id: string; name: string; archived: boolean }>(resWs, 'clientes').filter(w => !w.archived)
  const operacoes = unwrap<{
    id: string; ano: number; ativo: boolean; workspace_id: string; campaign_id: string | null
    plano_url: string | null; specs_url: string | null; crm_url: string | null
    drive_folder_id: string | null; observacao: string | null
    midia_cliente_rotina: {
      id: string; ativo: boolean; rotina_id: string; activity_id: string | null
      activities: { id: string; title: string; due_date: string | null; status: string; archived: boolean } | null
    }[]
  }>(resOper, 'operações de mídia')
  const rotinas = unwrap<RotinaCatalogo>(resRot, 'rotinas')
  const membros = unwrap<{ user_id: string; profiles: { id: string; full_name: string | null } | null }>(resMembros, 'membros')
  const itens = unwrap<ItemImplantacao>(resItens, 'itens de implantação')
  const estados = unwrap<{ workspace_id: string; item_id: string; estado: string; nota: string | null }>(resEstados, 'implantação')

  // Sem linha = pendente: cliente novo já aparece com a lista inteira sem seed.
  const estadoPorCliente = new Map<string, Record<string, { estado: string; nota: string | null }>>()
  for (const e of estados) {
    const m = estadoPorCliente.get(e.workspace_id) ?? {}
    m[e.item_id] = { estado: e.estado, nota: e.nota }
    estadoPorCliente.set(e.workspace_id, m)
  }

  const anoCorrente = Number(
    new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 4))

  const porWorkspace = new Map(operacoes.map(o => [o.workspace_id, o]))
  const clientes: ClienteRow[] = [...workspaces].sort(porNome(w => w.name)).map(w => {
    const op = porWorkspace.get(w.id)
    return {
      workspaceId: w.id,
      nome: w.name,
      implantacao: estadoPorCliente.get(w.id) ?? {},
      operacao: op
        ? {
            id: op.id, ano: op.ano, ativo: op.ativo, campaignId: op.campaign_id,
            planoUrl: op.plano_url, specsUrl: op.specs_url, crmUrl: op.crm_url,
            driveFolderId: op.drive_folder_id, observacao: op.observacao,
            rotinas: op.midia_cliente_rotina
              .filter(r => r.ativo)
              .map(r => ({
                vinculoId: r.id, rotinaId: r.rotina_id,
                activityId: r.activity_id,
                // Tarefa arquivada/excluída = rotina sem tarefa viva: a tela
                // oferece recriar em vez de mentir que está rodando.
                viva: !!r.activities && !r.activities.archived,
                prazo: r.activities?.due_date ?? null,
              })),
          }
        : null,
    }
  })

  const pessoas = membros
    .map(m => ({ id: m.profiles?.id ?? m.user_id, nome: m.profiles?.full_name ?? '—' }))
  return (
    <ClientesMidia
      orgSlug={orgSlug}
      clientes={clientes}
      rotinas={rotinas}
      itensImplantacao={itens}
      pessoas={pessoas.sort(porNome(p => p.nome))}
      anoCorrente={anoCorrente}
    />
  )
}
