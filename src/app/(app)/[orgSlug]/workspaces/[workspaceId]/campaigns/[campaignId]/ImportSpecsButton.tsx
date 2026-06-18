'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileSpreadsheet, X, Loader2, Check, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Select } from '@/components/ui/Select'
import { parseSpecsSheet, createActivitiesFromSpecs, type SpecRow } from '@/app/actions/import-specs'

type Item = SpecRow & { include: boolean }

export function ImportSpecsButton({ orgSlug, campaignId, campaigns }: {
  orgSlug: string
  /** Campanha fixa (página da campanha). Se ausente, mostra seletor. */
  campaignId?: string
  /** Lista de campanhas para escolher o destino (página do cliente). */
  campaigns?: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'input' | 'preview'>('input')
  const [url, setUrl] = useState('')
  const [target, setTarget] = useState(campaignId ?? '')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [pending, start] = useTransition()

  const needsPicker = !campaignId && !!campaigns

  function reset() { setStep('input'); setUrl(''); setItems([]); setLoading(false); setTarget(campaignId ?? '') }

  async function buscar() {
    if (!url.trim()) return
    if (needsPicker && !target) { toast.error('Escolha a campanha de destino.'); return }
    setLoading(true)
    const r = await parseSpecsSheet(url.trim())
    setLoading(false)
    if ('error' in r) { toast.error(r.error); return }
    setItems(r.rows.map(row => ({ ...row, include: true })))
    setStep('preview')
  }

  const selected = items.filter(i => i.include)

  function criar() {
    if (!target) { toast.error('Escolha a campanha de destino.'); return }
    start(async () => {
      const r = await createActivitiesFromSpecs(orgSlug, target, selected)
      if ('error' in r && r.error) { toast.error(r.error); return }
      toast.success(`${(r as { created: number }).created} atividade(s) criada(s)`)
      setOpen(false); reset(); router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
      >
        <FileSpreadsheet className="w-4 h-4" />
        <span className="hidden sm:inline">Importar especificações</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-gray-200 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                {step === 'preview' && (
                  <button onClick={() => setStep('input')} className="text-gray-400 hover:text-gray-600 transition">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <h2 className="text-base font-semibold text-gray-900">Importar especificações</h2>
              </div>
              <button onClick={() => { setOpen(false); reset() }} className="text-gray-400 hover:text-gray-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {step === 'input' ? (
              <div className="px-6 py-5 space-y-3">
                <p className="text-sm text-gray-500">
                  Cole o link da planilha do Google Sheets. Cada linha vira uma atividade na campanha escolhida.
                </p>
                {needsPicker && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Campanha de destino</label>
                    <Select
                      value={target}
                      onChange={setTarget}
                      className="w-full"
                      placeholder="Escolha a campanha"
                      options={(campaigns ?? []).map(c => ({ value: c.id, label: c.name }))}
                    />
                  </div>
                )}
                <input
                  type="url"
                  autoFocus
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') buscar() }}
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400">
                  A planilha precisa estar como <strong>&quot;qualquer pessoa com o link: Leitor&quot;</strong>.
                </p>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={buscar}
                    disabled={!url.trim() || loading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Buscar planilha
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="px-6 py-3 border-b border-gray-100 shrink-0 flex items-center justify-between">
                  <span className="text-sm text-gray-500">{selected.length} de {items.length} selecionada(s)</span>
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => setItems(items.map(i => ({ ...i, include: true })))} className="text-gray-500 hover:text-gray-700">Todas</button>
                    <span className="text-gray-300">·</span>
                    <button onClick={() => setItems(items.map(i => ({ ...i, include: false })))} className="text-gray-500 hover:text-gray-700">Nenhuma</button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1.5">
                  {items.map((it, idx) => (
                    <div key={idx} className={cn('flex items-start gap-2.5 px-3 py-2 rounded-lg border', it.include ? 'border-gray-200' : 'border-gray-100 opacity-50')}>
                      <button
                        type="button"
                        onClick={() => setItems(items.map((x, i) => i === idx ? { ...x, include: !x.include } : x))}
                        className={cn('mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition', it.include ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300')}
                      >
                        {it.include && <Check className="w-3 h-3" strokeWidth={3} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <input
                          value={it.title}
                          onChange={e => setItems(items.map((x, i) => i === idx ? { ...x, title: e.target.value } : x))}
                          className="w-full text-sm font-medium text-gray-900 bg-transparent focus:outline-none focus:bg-gray-50 rounded px-1 -mx-1"
                        />
                        {it.briefing && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 whitespace-pre-line">{it.briefing}</p>}
                      </div>
                      {it.dueDate && <span className="text-xs text-gray-400 shrink-0 mt-0.5">{it.dueDate.split('-').reverse().join('/')}</span>}
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 shrink-0">
                  <button onClick={() => { setOpen(false); reset() }} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
                  <button
                    onClick={criar}
                    disabled={selected.length === 0 || pending}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition"
                  >
                    {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Criar {selected.length} atividade{selected.length !== 1 ? 's' : ''}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
