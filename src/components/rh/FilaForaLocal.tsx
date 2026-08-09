'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MapPinOff, Check, X, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { decidirMarcacaoFora } from '@/app/actions/rh-ponto'

export interface MarcacaoFora {
  marcacao_id: string; data: string; hora: string; seq: number
  colaborador_id: string; nome: string; cargo: string | null
  lat: number | null; lon: number | null; ip: string | null
  motivo: string | null; status: string
}

const dataBR = (d: string) => { const [, m, dd] = d.split('-'); return `${dd}/${m}` }

export function FilaForaLocal({ orgSlug, itens }: { orgSlug: string; itens: MarcacaoFora[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function decidir(id: string, status: string) {
    start(async () => {
      const r = await decidirMarcacaoFora(orgSlug, id, status)
      if (r?.error) toast.error(r.error)
      else { toast.success(status === 'aprovado' ? 'Marcação validada.' : 'Marcação marcada como irregular.'); router.refresh() }
    })
  }

  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
        <MapPinOff className="w-4 h-4" /> Batidas fora dos locais <span className="text-gray-400">{itens.length}</span>
      </h2>
      {itens.length === 0 ? (
        <p className="text-sm text-gray-400 py-3">Nada pendente.</p>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-3">
            As horas <b>já contam</b> — isto aqui é conferência, não liberação. Para corrigir o horário
            de fato, use o editor no espelho da pessoa.
          </p>
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
            {itens.map(m => (
              <div key={m.marcacao_id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">
                    {m.nome} <span className="text-gray-400 font-normal tabular-nums">{dataBR(m.data)} às {m.hora}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                    {m.lat != null && m.lon != null ? (
                      <a href={`https://www.google.com/maps?q=${m.lat},${m.lon}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-orange-700 hover:text-orange-800 transition">
                        ver no mapa <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-gray-400">sem localização (permissão negada)</span>
                    )}
                    {m.ip && <span className="tabular-nums text-gray-400">IP {m.ip}</span>}
                    {m.motivo && <span className="text-gray-600">· {m.motivo}</span>}
                  </div>
                </div>
                <button onClick={() => decidir(m.marcacao_id, 'aprovado')} disabled={pending}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-50 transition">
                  <Check className="w-3.5 h-3.5" /> Validar
                </button>
                <button onClick={() => decidir(m.marcacao_id, 'rejeitado')} disabled={pending}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition">
                  <X className="w-3.5 h-3.5" /> Irregular
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
