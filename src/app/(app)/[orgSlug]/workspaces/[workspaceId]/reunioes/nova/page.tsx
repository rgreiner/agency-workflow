import { notFound, redirect } from 'next/navigation'
import { ReuniaoEditor } from '../ReuniaoEditor'
import { contextoReuniao } from '../dados'

export const metadata = { title: 'Nova ata — Flow' }

export default async function NovaReuniaoPage({ params }: {
  params: Promise<{ orgSlug: string; workspaceId: string }>
}) {
  const { orgSlug, workspaceId } = await params
  const ctx = await contextoReuniao(workspaceId)
  if (!ctx) notFound()
  // Só o Atendimento (ou admin) cria: quem não pode volta pra lista.
  if (!ctx.podeGerir) redirect(`/${orgSlug}/workspaces/${workspaceId}/reunioes`)

  // Data civil de Brasília: à noite o UTC já virou o dia.
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  return (
    <ReuniaoEditor
      orgSlug={orgSlug}
      workspaceId={workspaceId}
      clienteNome={ctx.clienteNome}
      campanhas={ctx.campanhas}
      tarefas={{}}
      podeEditar
      inicial={{
        id: null, titulo: '', realizadaEm: hoje, campaignId: null, participantes: '',
        notas: '', transcricao: '', resumo: '', publicada: false, passos: [],
      }}
    />
  )
}
