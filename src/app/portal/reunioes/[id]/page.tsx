import { redirect } from 'next/navigation'
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { PortalShell } from '../../PortalShell'
import { dataBR } from '@/lib/reunioes'
import { Building2, Clock, CheckCircle2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface AtaPortal {
  titulo: string
  realizada_em: string
  participantes: string | null
  resumo: string | null
  campanha: string | null
  passos: { texto: string; responsavel: 'agencia' | 'cliente'; em_andamento: boolean; feito?: boolean }[]
}

/**
 * Ata publicada pelo atendimento (mig. 306). A RPC só entrega resumo e passos:
 * notas, transcrição e rascunhos de briefing nunca saem do time.
 */
export default async function PortalReuniaoPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await sessaoPortal())) redirect('/portal')
  const { id } = await params

  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('portal_reuniao', { p_id: id })
  if (error || !data) redirect('/portal/painel')
  const ata = data as AtaPortal

  const doCliente = ata.passos.filter(p => p.responsavel === 'cliente')
  const daAgencia = ata.passos.filter(p => p.responsavel === 'agencia')

  return (
    <PortalShell>
      <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 mb-1">
        Reunião de {dataBR(ata.realizada_em)}{ata.campanha ? ` · ${ata.campanha}` : ''}
      </p>
      <h1 className="text-xl font-semibold text-gray-900">{ata.titulo}</h1>
      {ata.participantes && <p className="text-sm text-gray-500 mt-1">Participantes: {ata.participantes}</p>}

      {ata.resumo && (
        <div className="mt-6 text-sm text-gray-700 leading-relaxed whitespace-pre-line">{ata.resumo}</div>
      )}

      {doCliente.length > 0 && (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-2">
            <Clock className="w-4 h-4 text-orange-600" /> Com você
          </h2>
          <ul className="space-y-2">
            {doCliente.map((p, i) => (
              <li key={i} className={`flex items-start gap-2 rounded-xl border border-gray-100 border-l-2 bg-gray-50 px-3.5 py-2.5 text-sm ${
                p.feito ? 'border-l-green-500 text-gray-500' : 'border-l-orange-500 text-gray-800'}`}>
                <span className={`flex-1 ${p.feito ? 'line-through' : ''}`}>{p.texto}</span>
                {p.feito && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-green-600">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Feito
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {daAgencia.length > 0 && (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-2">
            <Building2 className="w-4 h-4 text-gray-500" /> Com a agência
          </h2>
          <ul className="space-y-2">
            {daAgencia.map((p, i) => (
              <li key={i} className="flex items-start gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-800">
                <span className="flex-1">{p.texto}</span>
                {p.feito ? (
                  <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-green-600">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Feito
                  </span>
                ) : p.em_andamento && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-orange-600">
                    <Clock className="w-3.5 h-3.5" /> Em andamento
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PortalShell>
  )
}
