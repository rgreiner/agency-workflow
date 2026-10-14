import { redirect } from 'next/navigation'
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { solicitarAlteracao, type PortalAnexo } from '@/app/actions/portal'
import { PortalShell } from '../../PortalShell'
import { PortalEntryForm } from '../../PortalEntryForm'

export const dynamic = 'force-dynamic'

/** Cliente pede alteração num trabalho em andamento (pelo quadro). Mig. 343. */
export default async function PortalAlteracaoPage({ params }: { params: Promise<{ activityId: string }> }) {
  const claims = await sessaoPortal()
  if (!claims) redirect('/portal')
  const { activityId } = await params

  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('portal_card', { p_activity_id: activityId })
  if (error || !data) redirect('/portal/quadro')
  const t = data as { id: string; titulo: string; campanha: string; fase: string; prazo: string | null }

  async function enviar(_t: string, mensagem: string, anexos: PortalAnexo[]) {
    'use server'
    return solicitarAlteracao(activityId, mensagem, anexos)
  }

  const prazo = t.prazo ? t.prazo.slice(0, 10).split('-').reverse().join('/') : null

  return (
    <PortalShell voltar={{ href: '/portal/quadro', rotulo: 'Quadro' }}>
      <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 mb-1">{t.campanha}</p>
      <h1 className="text-xl font-semibold text-gray-900">{t.titulo}</h1>
      <p className="text-sm text-gray-500 mt-1">
        {t.fase}{prazo ? ` · entrega prevista ${prazo}` : ''}
      </p>
      <p className="text-sm text-gray-500 mt-4 mb-6 leading-relaxed">
        Conte o que precisa mudar. Se tiver referência, anexe: o arquivo vai direto para a pasta
        do trabalho e o atendimento é avisado na hora.
      </p>
      {claims.preview ? (
        <p className="text-sm text-gray-500 text-center py-6">Visualização da agência: só o cliente envia por aqui.</p>
      ) : (
        <PortalEntryForm
          mensagemLabel="O que precisa mudar?"
          mensagemPlaceholder="Texto, imagem, cor, prazo, uma referência que você viu…"
          submitLabel="Enviar alteração"
          sucessoTitulo="Pedido enviado!"
          sucessoTexto="O atendimento recebeu e volta com você sobre o ajuste."
          onSubmit={enviar}
        />
      )}
    </PortalShell>
  )
}
