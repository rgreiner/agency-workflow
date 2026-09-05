import { assertMidiaAccess, statusDaMidia } from '@/lib/midia-hub'
import { unwrap } from '@/lib/supabase/unwrap'
import { porNome } from '@/lib/utils'
import { contatoDoVeiculo } from '@/lib/veiculo-contato'
import { EntregasMidia, type EntregaRow, type VeiculoOpt } from './EntregasMidia'

export const metadata = { title: 'Mídia — Entregas' }

interface ViewRow {
  id: string; workspace_id: string; campaign_id: string | null
  titulo: string; veiculo: string | null; formato: string | null
  veiculo_id: string | null; veiculo_emails: unknown; veiculo_telefones: unknown
  prazo_envio: string | null; activity_id: string | null
  situacao: string; liberado_em: string | null; observacao: string | null
  cliente: string; campanha: string | null
  tarefa_titulo: string | null; tarefa_status: string | null; tarefa_prazo: string | null
  tarefa_arquivada: boolean | null
  tarefa_campaign_id: string | null; tarefa_workspace_id: string | null
  preview_url: string | null; finalizacao_url: string | null; drive_folder_url: string | null
  conflito_prazo: boolean | null
}

export default async function EntregasPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertMidiaAccess(orgSlug)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const statusMidia = await statusDaMidia(sb, orgId)
  const [resEntregas, resWs, resStatus, resVeic] = await Promise.all([
    sb.from('midia_entrega_view').select('*').eq('org_id', orgId).order('prazo_envio', { ascending: true, nullsFirst: false }),
    sb.from('workspaces').select('id, name, archived').eq('org_id', orgId),
    sb.from('org_status').select('valor, label, bg, txt, papel').eq('org_id', orgId),
    // O mesmo cadastro que o comercial usa em PI/MX (mig. 278): a entrega escolhe daqui.
    sb.from('veiculos').select('id, name, emails, telefones').eq('org_id', orgId).eq('archived', false),
  ])

  const rows = unwrap<ViewRow>(resEntregas, 'entregas')
  const workspaces = unwrap<{ id: string; name: string; archived: boolean }>(resWs, 'clientes').filter(w => !w.archived)
  const statusCfg = unwrap<{ valor: string; label: string; bg: string; txt: string; papel: string | null }>(resStatus, 'status')
  const veiculos: VeiculoOpt[] = unwrap<{ id: string; name: string; emails: unknown; telefones: unknown }>(resVeic, 'veículos')
    .sort(porNome(v => v.name))
    .map(v => ({ id: v.id, nome: v.name, contato: contatoDoVeiculo(v.emails, v.telefones) }))

  // "Material pronto" = a tarefa da criação já chegou num status que a MÍDIA
  // opera (ou concluiu). É derivado do status, não um campo que alguém marca —
  // campo marcado à mão desatualiza e a fila mente.
  const prontos = new Set([...statusMidia, ...statusCfg.filter(s => s.papel === 'conclusao').map(s => s.valor)])

  const entregas: EntregaRow[] = rows.map(r => ({
    id: r.id,
    titulo: r.titulo,
    cliente: r.cliente,
    workspaceId: r.workspace_id,
    campanha: r.campanha,
    campaignId: r.campaign_id,
    veiculo: r.veiculo,
    veiculoId: r.veiculo_id,
    veiculoContato: contatoDoVeiculo(r.veiculo_emails, r.veiculo_telefones),
    formato: r.formato,
    prazoEnvio: r.prazo_envio,
    situacao: r.situacao as EntregaRow['situacao'],
    observacao: r.observacao,
    tarefa: r.activity_id
      ? {
          id: r.activity_id,
          titulo: r.tarefa_titulo ?? '(tarefa removida)',
          status: r.tarefa_status,
          prazo: r.tarefa_prazo,
          arquivada: !!r.tarefa_arquivada,
          campaignId: r.tarefa_campaign_id,
          workspaceId: r.tarefa_workspace_id,
          materialPronto: !!r.tarefa_status && prontos.has(r.tarefa_status),
          previewUrl: r.preview_url,
          finalUrl: r.finalizacao_url,
          pastaUrl: r.drive_folder_url,
        }
      : null,
    conflitoPrazo: !!r.conflito_prazo,
  }))

  return (
    <EntregasMidia
      orgSlug={orgSlug}
      entregas={entregas}
      clientes={[...workspaces].sort(porNome(w => w.name)).map(w => ({ id: w.id, nome: w.name }))}
      veiculos={veiculos}
      statusCfg={statusCfg}
    />
  )
}
