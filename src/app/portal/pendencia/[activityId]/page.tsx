import { redirect } from 'next/navigation'
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { responderPendencia, type PortalAnexo } from '@/app/actions/portal'
import { PortalShell } from '../../PortalShell'
import { PortalEntryForm } from '../../PortalEntryForm'

export const dynamic = 'force-dynamic'

/** Cliente responde uma pendência (tarefa em pendente_cliente). */
export default async function PortalPendenciaPage({
  params,
}: {
  params: Promise<{ activityId: string }>
}) {
  if (!(await sessaoPortal())) redirect('/portal')
  const { activityId } = await params

  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('portal_pendencia', { p_activity_id: activityId })
  if (error || !data) redirect('/portal/painel')

  const tarefa = data as { id: string; titulo: string; campanha: string }

  async function enviar(_t: string, mensagem: string, anexos: PortalAnexo[]) {
    'use server'
    return responderPendencia(activityId, mensagem, anexos)
  }

  return (
    <PortalShell>
      <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 mb-1">{tarefa.campanha}</p>
      <h1 className="text-xl font-semibold text-gray-900">{tarefa.titulo}</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6 leading-relaxed">
        A agência está aguardando uma informação sua pra seguir. Escreva abaixo e anexe o que
        for preciso — o time de atendimento é avisado na hora.
      </p>
      <PortalEntryForm
        mensagemLabel="Sua resposta"
        mensagemPlaceholder="A informação que faltava, aprovação de texto, referências…"
        submitLabel="Enviar resposta"
        sucessoTitulo="Resposta enviada!"
        sucessoTexto="O time de atendimento recebeu e vai dar sequência ao trabalho."
        onSubmit={enviar}
      />
    </PortalShell>
  )
}
