import Link from 'next/link'
import { AlertTriangle, CalendarClock, Truck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

/**
 * O outro lado da conversa entre os dois prazos (migration 236): a tarefa mostra
 * para quando a MÍDIA precisa do material. Sem isto, o vínculo só existiria na
 * tela da mídia e quem faz a arte continuaria sem saber da data do veículo.
 *
 * Aparece para qualquer pessoa que abre a tarefa — não é dado sensível, é o
 * compromisso com o veículo. Sem entrega vinculada, não renderiza nada.
 */
export async function EntregaMidiaAviso({ orgSlug, activityId }: { orgSlug: string; activityId: string }) {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('midia_entrega_view')
    .select('id, titulo, veiculo, prazo_envio, situacao, conflito_prazo, tarefa_prazo')
    .eq('activity_id', activityId)
    .neq('situacao', 'cancelado')

  const entregas = (data ?? []) as {
    id: string; titulo: string; veiculo: string | null; prazo_envio: string | null
    situacao: string; conflito_prazo: boolean | null; tarefa_prazo: string | null
  }[]
  if (entregas.length === 0) return null

  const fmt = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—')

  return (
    <div className="mb-3 space-y-1.5">
      {entregas.map(e => (
        <div key={e.id}
          className={`rounded-xl border px-3 py-2.5 ${e.conflito_prazo ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50/60'}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <Truck className={`w-3.5 h-3.5 shrink-0 ${e.conflito_prazo ? 'text-red-600' : 'text-amber-600'}`} />
            <span className={`text-xs font-medium ${e.conflito_prazo ? 'text-red-800' : 'text-amber-800'}`}>
              A mídia espera esta peça{e.veiculo ? ` para ${e.veiculo}` : ''}
            </span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/70 text-gray-600 inline-flex items-center gap-1">
              <CalendarClock className="w-3 h-3" /> envio {fmt(e.prazo_envio)}
            </span>
            {e.situacao === 'liberado' && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">já liberada</span>
            )}
          </div>
          {e.conflito_prazo && (
            <p className="text-[11px] text-red-700 mt-1 inline-flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              O prazo desta tarefa ({fmt(e.tarefa_prazo)}) é depois do envio ao veículo. Alinhe com a mídia.
            </p>
          )}
          <Link href={`/${orgSlug}/midia/entregas`}
            className="text-[11px] text-gray-500 hover:text-orange-600 transition-colors mt-1 inline-block">
            {e.titulo} · ver nas entregas
          </Link>
        </div>
      ))}
    </div>
  )
}
