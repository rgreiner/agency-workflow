import { redirect } from 'next/navigation'
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { solicitarDemanda } from '@/app/actions/portal'
import { PortalShell } from '../PortalShell'
import { PortalEntryForm } from '../PortalEntryForm'

export const dynamic = 'force-dynamic'

/**
 * Cliente pede uma demanda nova (mig. 344): vira tarefa em Briefing no cliente
 * dele e o atendimento é avisado com o link da tarefa.
 */
export default async function PortalSolicitarPage({ searchParams }: { searchParams: Promise<{ de?: string }> }) {
  const claims = await sessaoPortal()
  if (!claims) redirect('/portal')
  const { de } = await searchParams
  const voltar = de === 'quadro' ? { href: '/portal/quadro', rotulo: 'Quadro' } : { href: '/portal/painel', rotulo: 'Painel' }

  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('portal_campanhas')
  const campanhas = (Array.isArray(data) ? data : []) as { id: string; nome: string }[]

  return (
    <PortalShell voltar={voltar}>
      <h1 className="text-xl font-semibold text-gray-900">Nova demanda</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6 leading-relaxed">
        Conte o que você precisa. O pedido entra direto na fila de Briefing da agência e o
        atendimento volta com você para combinar o prazo de entrega.
      </p>
      {claims.preview ? (
        <p className="text-sm text-gray-500 text-center py-6">Visualização da agência: só o cliente envia por aqui.</p>
      ) : (
        <PortalEntryForm
          askTitulo
          tituloLabel="Assunto"
          mensagemLabel="O que você precisa?"
          mensagemPlaceholder="Formato, onde vai ser usado, público, referências…"
          submitLabel="Enviar demanda"
          sucessoTitulo="Demanda enviada!"
          sucessoTexto="Ela já está na fila de Briefing. O atendimento volta com você para combinar a entrega, e você acompanha pelo quadro."
          onSubmit={solicitarDemanda}
          campanhas={campanhas}
          askData
          voltarHref={voltar.href}
        />
      )}
    </PortalShell>
  )
}
