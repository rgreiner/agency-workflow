import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { sessaoPortal } from '@/lib/auth/portal'
import { createPortalClient } from '@/lib/supabase/portal'
import { listPreviewFiles } from '@/lib/task-folders'
import { driveConfigured, readRedacaoText } from '@/lib/google-drive'
import { agruparPorLegenda, type GrupoPeca } from '@/lib/portal-legendas'
import { PortalShell } from '../../PortalShell'
import { AprovacaoClient, type Peca } from './AprovacaoClient'
import { queryAssinada } from '@/lib/portal-pecas'

export const dynamic = 'force-dynamic'

/** Ambiente de aprovação: peças da pasta Preview + comentários + aceite. */
export default async function PortalAprovacaoPage({
  params,
}: {
  params: Promise<{ activityId: string }>
}) {
  const claims = await sessaoPortal()
  if (!claims) redirect('/portal')
  const { activityId } = await params

  const supabase = await createPortalClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('portal_aprovacao', { p_activity_id: activityId })
  if (error || !data) redirect('/portal/painel')

  const t = data as {
    id: string; titulo: string; campanha: string; pasta_ref: string | null
    redacao_ref: string | null
    decisao: { kind: string } | null
  }

  // A tela abre já com o título; peças e legenda chegam por streaming.
  return (
    <PortalShell wide>
      <Suspense fallback={<Carregando titulo={t.titulo} campanha={t.campanha} />}>
        <PecasDaAprovacao
          portalSub={claims.portalSub}
          t={t}
        />
      </Suspense>
    </PortalShell>
  )
}

/** Esqueleto enquanto Drive/Redação respondem — o cliente já vê de que trabalho se trata. */
function Carregando({ titulo, campanha }: { titulo: string; campanha: string }) {
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-orange-600 mb-1">{campanha}</p>
      <h1 className="text-xl font-semibold text-gray-900">{titulo}</h1>
      <p className="text-sm text-gray-500 mt-1">Carregando as peças…</p>
      <div className="mt-6 space-y-4">
        {[0, 1].map(i => (
          <div key={i} className="rounded-2xl border border-gray-200 overflow-hidden">
            <div className="h-72 bg-gray-100 animate-pulse" />
            <div className="h-10 border-t border-gray-100" />
          </div>
        ))}
      </div>
    </>
  )
}

async function PecasDaAprovacao({ portalSub, t }: {
  portalSub: string
  t: { id: string; titulo: string; campanha: string; pasta_ref: string | null; redacao_ref: string | null; decisao: { kind: string } | null }
}) {
  // Peças e Redação EM PARALELO (antes era uma depois da outra). Qualquer uma
  // falhar não derruba a tela: sem peças avisa; sem Redação fica em lista.
  const [lista, redacao] = await Promise.all([
    t.pasta_ref ? listPreviewFiles(t.pasta_ref).catch(() => []) : Promise.resolve([]),
    t.redacao_ref && driveConfigured()
      ? readRedacaoText(t.redacao_ref).then(r => r.text).catch(e => { console.error('[portal] leitura da Redação falhou', e); return '' })
      : Promise.resolve(''),
  ])
  // Cada peça vai com o link assinado: a rota não precisa listar a pasta de novo.
  const pecas: Peca[] = lista.map(p => ({ ...p, q: queryAssinada(portalSub, t.id, p) }))
  const grupos: GrupoPeca[] | null = pecas.length && redacao ? agruparPorLegenda(pecas, redacao) : null

  return (
    <AprovacaoClient
      activityId={t.id}
      titulo={t.titulo}
      campanha={t.campanha}
      pecas={pecas}
      grupos={grupos}
      decidido={t.decisao?.kind ?? null}
    />
  )
}
