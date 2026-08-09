'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Plus, Loader2, Check, X, Trash2, Crosshair, Wifi } from 'lucide-react'
import { toast } from 'sonner'
import { salvarLocal, excluirLocal, type LocalRh } from '@/app/actions/rh-local'

export function LocaisPonto({ orgSlug, locais, ipAtual }: {
  orgSlug: string; locais: LocalRh[]; ipAtual: string | null
}) {
  const router = useRouter()
  const [edit, setEdit] = useState<LocalRh | 'novo' | null>(null)
  const [pending, start] = useTransition()

  function apagar(id: string) {
    start(async () => {
      const r = await excluirLocal(orgSlug, id)
      if (r?.error) toast.error(r.error)
      else { toast.success('Local removido.'); router.refresh() }
    })
  }

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <MapPin className="w-4 h-4" /> Locais de trabalho
        </h2>
        <button onClick={() => setEdit('novo')}
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-orange-600 transition">
          <Plus className="w-3.5 h-3.5" /> Novo local
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        Com nenhum local cadastrado, o Flow não classifica ninguém — todo mundo bate normalmente.
        A partir do primeiro, quem bater fora entra na fila abaixo. As horas contam de qualquer jeito.
      </p>

      {locais.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 p-5 text-center">
          <p className="text-sm text-gray-400">Nenhum local cadastrado.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
          {locais.map(l => (
            <div key={l.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                  {l.nome}
                  {!l.ativo && <span className="text-[10px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">inativo</span>}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                  {l.ips.length > 0 && (
                    <span className="inline-flex items-center gap-1"><Wifi className="w-3 h-3" /> {l.ips.join(', ')}</span>
                  )}
                  {l.lat != null && (
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Crosshair className="w-3 h-3" /> {l.lat.toFixed(5)}, {l.lon?.toFixed(5)} · {l.raio_m}m
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setEdit(l)} className="text-xs text-gray-500 hover:text-orange-600 px-2 transition">Editar</button>
              <button onClick={() => apagar(l.id)} disabled={pending}
                className="p-1 text-gray-300 hover:text-red-500 transition disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <LocalModal orgSlug={orgSlug} local={edit === 'novo' ? null : edit} ipAtual={ipAtual}
          onClose={() => setEdit(null)} onOk={() => { setEdit(null); router.refresh() }} />
      )}
    </section>
  )
}

function LocalModal({ orgSlug, local, ipAtual, onClose, onOk }: {
  orgSlug: string; local: LocalRh | null; ipAtual: string | null
  onClose: () => void; onOk: () => void
}) {
  const [nome, setNome] = useState(local?.nome ?? 'Escritório')
  const [ips, setIps] = useState((local?.ips ?? []).join(', '))
  const [lat, setLat] = useState(local?.lat?.toString() ?? '')
  const [lon, setLon] = useState(local?.lon?.toString() ?? '')
  const [raio, setRaio] = useState(local?.raio_m ?? 150)
  const [ativo, setAtivo] = useState(local?.ativo ?? true)
  const [saving, start] = useTransition()
  const [down, setDown] = useState(false)

  function usarDaqui() {
    if (!navigator.geolocation) { toast.error('Seu navegador não informa localização.'); return }
    navigator.geolocation.getCurrentPosition(
      p => { setLat(p.coords.latitude.toFixed(6)); setLon(p.coords.longitude.toFixed(6)); toast.success('Coordenada preenchida com a daqui.') },
      () => toast.error('Não consegui ler a localização. Autorize no navegador.'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  function salvar() {
    start(async () => {
      const r = await salvarLocal(orgSlug, local?.id ?? null, {
        nome,
        ips: ips.split(',').map(s => s.trim()).filter(Boolean),
        lat: lat ? Number(lat) : null, lon: lon ? Number(lon) : null,
        raio_m: raio, ativo,
      })
      if (r?.error) toast.error(r.error)
      else { toast.success('Local salvo.'); onOk() }
    })
  }

  const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onMouseDown={() => setDown(true)}
      onClick={e => { if (down && e.target === e.currentTarget) onClose(); setDown(false) }}>
      <div className="modal-card w-full max-w-md max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{local ? 'Editar local' : 'Novo local'}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">Nome</label>
            <input value={nome} onChange={e => setNome(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1.5">IP da rede</label>
            <input value={ips} onChange={e => setIps(e.target.value)} className={inputCls}
              placeholder="200.1.1.10, 192.168.15.0/24" />
            <p className="text-[11px] text-gray-400 mt-1.5">
              Separe por vírgula. Aceita IP exato ou faixa (<code className="bg-gray-100 px-1 rounded">/24</code>).
              {ipAtual && (
                <> Você está acessando de <button type="button" onClick={() => setIps(p => p ? `${p}, ${ipAtual}` : ipAtual)}
                  className="text-orange-600 hover:underline font-medium tabular-nums">{ipAtual}</button> — clique para usar.</>
              )}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm text-gray-600">Coordenada</label>
              <button type="button" onClick={usarDaqui}
                className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-orange-600 transition">
                <Crosshair className="w-3 h-3" /> usar a daqui
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input value={lat} onChange={e => setLat(e.target.value)} className={inputCls} placeholder="latitude" inputMode="decimal" />
              <input value={lon} onChange={e => setLon(e.target.value)} className={inputCls} placeholder="longitude" inputMode="decimal" />
              <div className="relative">
                <input type="number" value={raio} onChange={e => setRaio(Number(e.target.value))} className={inputCls} min={20} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">m</span>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Raio de tolerância. 150m cobre o prédio e a calçada sem pegar o quarteirão vizinho.
            </p>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)}
              className="w-4 h-4 accent-orange-600" />
            <span className="text-sm text-gray-600">Local ativo</span>
          </label>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          <button onClick={salvar} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
          </button>
        </div>
      </div>
    </div>
  )
}
