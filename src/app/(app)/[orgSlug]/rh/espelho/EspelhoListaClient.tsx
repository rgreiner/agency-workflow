'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ClipboardCheck, ChevronRight, AlertTriangle, Pencil, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { carregarEspelhoLista, type EspelhoLista } from '@/app/actions/rh-calendario'

const hm = (m: number) => `${m < 0 ? '-' : ''}${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, '0')}`
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export function EspelhoListaClient({ orgSlug, compInicial }: { orgSlug: string; compInicial: string }) {
  const [comp, setComp] = useState(compInicial)
  const [lista, setLista] = useState<EspelhoLista | null>(null)
  const [loading, setLoading] = useState(true)

  const carregar = useCallback(async () => {
    setLoading(true)
    const r = await carregarEspelhoLista(orgSlug, comp)
    if (r?.error) { toast.error(r.error); setLista(null) } else setLista(r?.lista ?? null)
    setLoading(false)
  }, [orgSlug, comp])

  useEffect(() => { carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-orange-600" /> Espelho de ponto</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Validação dia a dia do ciclo.
            {lista && <> Período <b className="text-gray-700">{dataBR(lista.ini)} – {dataBR(lista.fim)}</b></>}
          </p>
        </div>
        <input type="month" value={comp} onChange={e => setComp(e.target.value)}
          className="px-3 py-2 text-sm bg-gray-100 border border-transparent rounded-xl text-gray-800" />
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Carregando…</div>
      ) : !lista?.colaboradores.length ? (
        <div className="text-center py-16 text-gray-400 text-sm">Nenhum colaborador ativo.</div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-400">
              <th className="text-left px-4 py-3 font-medium">Colaborador</th>
              <th className="text-right px-3 py-3 font-medium">Dias c/ ponto</th>
              <th className="text-right px-3 py-3 font-medium">Saldo</th>
              <th className="text-left px-3 py-3 font-medium">A revisar</th>
              <th className="px-4 py-3 w-px"></th>
            </tr></thead>
            <tbody>
              {lista.colaboradores.map(c => (
                <tr key={c.id} className="border-b border-gray-50 last:border-0 hover:bg-orange-50/40 transition">
                  <td className="px-4 py-3">
                    <Link href={`/${orgSlug}/rh/espelho/${c.id}?comp=${comp}`} className="font-medium text-gray-900 hover:text-orange-600 transition">{c.nome}</Link>
                    <div className="text-xs text-gray-400">{c.cargo || '—'}{!c.tem_login && ' · sem login (não bate ponto)'}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-600">{c.dias_com_ponto}</td>
                  <td className={`px-3 py-3 text-right tabular-nums font-medium ${c.saldo_min < 0 ? 'text-red-600' : c.saldo_min > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{hm(c.saldo_min)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.extras_pendentes > 0 && <span className="inline-flex items-center gap-1 text-[11px] bg-amber-50 text-amber-700 rounded px-1.5 py-0.5"><Clock className="w-3 h-3" />{c.extras_pendentes} extra</span>}
                      {c.intervalo_curto > 0 && <span className="inline-flex items-center gap-1 text-[11px] bg-red-50 text-red-700 rounded px-1.5 py-0.5"><AlertTriangle className="w-3 h-3" />{c.intervalo_curto} almoço &lt;1h</span>}
                      {c.ajustados > 0 && <span className="inline-flex items-center gap-1 text-[11px] bg-sky-50 text-sky-700 rounded px-1.5 py-0.5"><Pencil className="w-3 h-3" />{c.ajustados} ajustado</span>}
                      {!c.extras_pendentes && !c.intervalo_curto && !c.ajustados && <span className="text-xs text-gray-300">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/${orgSlug}/rh/espelho/${c.id}?comp=${comp}`} className="inline-flex text-gray-400 hover:text-orange-600 transition"><ChevronRight className="w-4 h-4" /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
