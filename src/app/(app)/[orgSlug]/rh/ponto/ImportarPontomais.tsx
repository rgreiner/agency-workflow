'use client'

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Loader2, Check, X, AlertTriangle, CalendarDays } from 'lucide-react'
import { toast } from 'sonner'
import { importarPontomais } from '@/app/actions/rh-calendario'
import type { PontomaisRelatorio } from '@/lib/pontomais'

const hm = (m: number | null | undefined) => {
  if (m == null) return '—'
  const s = m < 0 ? '-' : '', a = Math.abs(m)
  return `${s}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`
}
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
/** "Emenda …" vira emenda (extra 50%); o resto é feriado (extra 100%). */
const tipoDe = (nome: string) => /emenda/i.test(nome) ? 'emenda' : /jogos|facultativ/i.test(nome) ? 'facultativo' : 'feriado'

export function ImportarPontomais({ orgSlug }: { orgSlug: string }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rel, setRel] = useState<PontomaisRelatorio | null>(null)
  const [lendo, setLendo] = useState(false)
  const [saving, start] = useTransition()
  const [down, setDown] = useState(false)

  async function onPick(file: File) {
    setLendo(true)
    try {
      const fd = new FormData()
      fd.append('orgSlug', orgSlug); fd.append('file', file)
      const res = await fetch('/api/rh/pontomais/extract', { method: 'POST', body: fd })
      const j = await res.json()
      if (!res.ok) { toast.error(j.error || 'Falha ao ler o PDF'); return }
      setRel(j as PontomaisRelatorio)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha ao ler o PDF') }
    finally { setLendo(false) }
  }

  function importar() {
    if (!rel) return
    start(async () => {
      const r = await importarPontomais(orgSlug, {
        dataRef: rel.periodo.fim ?? '',
        pessoas: rel.pessoas.map(p => ({
          nome: p.nome, saldoFinalMin: p.saldo_final_min,
          dias: p.dias.map(d => ({
            data: d.data, m1: d.marcacoes[0], m2: d.marcacoes[1], m3: d.marcacoes[2],
            m4: d.marcacoes[3], m5: d.marcacoes[4], m6: d.marcacoes[5],
            credito_min: d.credito_min, debito_min: d.debito_min, faltantes_min: d.faltantes_min,
            intervalo_min: d.intervalo_min, normais_min: d.normais_min, he50_min: d.he50_min,
            he100_min: d.he100_min, noturno_min: d.noturno_min, saldo_min: d.saldo_min, motivo: d.motivo,
          })),
        })),
        feriados: rel.feriados.map(f => ({ data: f.data, nome: f.nome, tipo: tipoDe(f.nome) })),
      })
      if (r?.error) { toast.error(r.error); return }
      const erros = (r.resultados ?? []).filter(x => x.erro)
      const dias = (r.resultados ?? []).reduce((s, x) => s + (x.dias ?? 0), 0)
      if (erros.length) toast.error(`${erros.length} não importada(s): ${erros.map(e => e.nome).join(', ')}`)
      else toast.success(`${dias} dias importados · ${r.feriados} feriados no calendário.`)
      setRel(null); router.refresh()
    })
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
        onChange={e => { const x = e.target.files?.[0]; if (x) onPick(x); e.target.value = '' }} />
      <button onClick={() => fileRef.current?.click()} disabled={lendo}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition disabled:opacity-50">
        {lendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {lendo ? 'Lendo…' : 'Importar Pontomais'}
      </button>

      {rel && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onMouseDown={() => setDown(true)}
          onClick={e => { if (down && e.target === e.currentTarget) setRel(null); setDown(false) }}>
          <div className="modal-card w-full max-w-3xl max-h-[90vh] overflow-hidden bg-white rounded-2xl shadow-xl border border-gray-200 flex flex-col" onMouseDown={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Importar histórico do Pontomais</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {rel.periodo.ini && `${dataBR(rel.periodo.ini)} – ${dataBR(rel.periodo.fim!)} · `}
                  {rel.pessoas.length} pessoas
                </p>
              </div>
              <button onClick={() => setRel(null)} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4">
              <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 mb-4 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>O histórico entra <b>congelado</b>: guarda os totais do Pontomais como estão e o Flow não recalcula.
                  A régua do Pontomais (8h fixas de horas normais + excedente em extra) é diferente da do Flow — recalcular faria divergir do que já foi assinado.</div>
              </div>

              <h3 className="text-sm font-semibold text-gray-700 mb-2">Pessoas</h3>
              <div className="rounded-xl border border-gray-200 divide-y divide-gray-50 mb-5">
                {rel.pessoas.map(p => (
                  <div key={p.nome} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{p.nome}</div>
                      <div className="text-xs text-gray-500 tabular-nums">
                        {p.dias.length} dias · normais {hm(p.totais?.normais_min)} · extra 50% {hm(p.totais?.he50_min)}
                        {!!p.totais?.he100_min && ` · 100% ${hm(p.totais.he100_min)}`}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-gray-400 uppercase">saldo final</div>
                      <div className={`text-sm font-medium tabular-nums ${(p.saldo_final_min ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{hm(p.saldo_final_min)}</div>
                    </div>
                  </div>
                ))}
              </div>

              <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><CalendarDays className="w-4 h-4" /> Feriados detectados <span className="font-normal text-gray-400">{rel.feriados.length}</span></h3>
              <div className="flex flex-wrap gap-1.5">
                {rel.feriados.map(f => (
                  <span key={f.data} className="inline-flex items-center gap-1.5 text-xs bg-gray-100 rounded-lg px-2 py-1">
                    <span className="tabular-nums text-gray-500">{dataBR(f.data)}</span>
                    <span className="text-gray-700">{f.nome}</span>
                    <span className={`text-[10px] px-1 rounded ${tipoDe(f.nome) === 'feriado' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {tipoDe(f.nome) === 'feriado' ? '100%' : '50%'}
                    </span>
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">Vão para o Calendário (dia marcado não gera falta). Você ajusta lá depois se algum estiver errado.</p>
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setRel(null)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
              <button onClick={importar} disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Importar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
