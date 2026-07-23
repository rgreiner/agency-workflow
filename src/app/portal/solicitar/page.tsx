import { redirect } from 'next/navigation'
import { sessaoPortal } from '@/lib/auth/portal'
import { criarSolicitacao } from '@/app/actions/portal'
import { PortalShell } from '../PortalShell'
import { PortalEntryForm } from '../PortalEntryForm'

export const dynamic = 'force-dynamic'

/** Cliente abre uma solicitação nova → vira briefing pro atendimento. */
export default async function PortalSolicitarPage() {
  if (!(await sessaoPortal())) redirect('/portal')

  return (
    <PortalShell>
      <h1 className="text-xl font-semibold text-gray-900">Nova solicitação</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6 leading-relaxed">
        Conte o que você precisa. Sua solicitação chega direto ao time de atendimento,
        que organiza a demanda e retorna com os próximos passos.
      </p>
      <PortalEntryForm
        askTitulo
        tituloLabel="Assunto"
        mensagemLabel="Descreva a demanda"
        mensagemPlaceholder="O que você precisa, para quando, referências…"
        submitLabel="Enviar solicitação"
        sucessoTitulo="Solicitação enviada!"
        sucessoTexto="O time de atendimento recebeu e vai retornar com os próximos passos."
        onSubmit={criarSolicitacao}
      />
    </PortalShell>
  )
}
