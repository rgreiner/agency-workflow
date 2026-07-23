'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { FolderSync, X, Loader2, Check, Link2, FolderPlus, FolderInput, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { reconcileCampaignDrive, applyCampaignDriveReconcile, type DriveReconcile } from '@/app/actions/drive-sync'

function Checkbox({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition', on ? 'bg-orange-600 border-orange-600 text-[#fff]' : 'border-gray-300')}>
      {on && <Check className="w-3 h-3" strokeWidth={3} />}
    </button>
  )
}

export function DriveSyncButton({ orgSlug, campaignId, autoOpen = false }: { orgSlug: string; campaignId: string; autoOpen?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<DriveReconcile | null>(null)
  const [pending, start] = useTransition()

  // seleções
  const [linkSel, setLinkSel] = useState<Set<string>>(new Set())   // activityId (casados)
  const [createSel, setCreateSel] = useState<Set<string>>(new Set()) // activityId (jobs sem pasta)
  const [jobSel, setJobSel] = useState<Set<string>>(new Set())     // folderId (pastas sem job)

  // Abre a sincronização sozinho quando vem da notificação (?drive=sync).
  const didAuto = useRef(false)
  useEffect(() => {
    if (autoOpen && !didAuto.current) { didAuto.current = true; abrir() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen])

  async function abrir() {
    setOpen(true); setLoading(true); setData(null)
    const r = await reconcileCampaignDrive(orgSlug, campaignId)
    setLoading(false)
    if ('error' in r) { toast.error(r.error); setOpen(false); return }
    setData(r)
    setLinkSel(new Set(r.matched.filter(m => !m.alreadyLinked).map(m => m.activityId)))
    setCreateSel(new Set(r.jobsSemPasta.map(j => j.activityId)))
    setJobSel(new Set())
  }

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set)
    if (next.has(key)) next.delete(key); else next.add(key)
    setter(next)
  }

  function aplicar() {
    if (!data) return
    const decisions = {
      link: data.matched.filter(m => linkSel.has(m.activityId)).map(m => ({ activityId: m.activityId, folderId: m.folderId })),
      createFolders: data.jobsSemPasta.filter(j => createSel.has(j.activityId)).map(j => ({ activityId: j.activityId, title: j.title })),
      novosJobs: data.pastasSemJob.filter(f => jobSel.has(f.folderId)).map(f => ({ folderId: f.folderId, name: f.name })),
    }
    const total = decisions.link.length + decisions.createFolders.length + decisions.novosJobs.length
    if (total === 0) { toast.error('Nada selecionado.'); return }
    start(async () => {
      const r = await applyCampaignDriveReconcile(orgSlug, campaignId, decisions)
      if ('error' in r) { toast.error(r.error); return }
      const parts = []
      if (r.linked) parts.push(`${r.linked} vinculado(s)`)
      if (r.created) parts.push(`${r.created} pasta(s) criada(s)`)
      if (r.jobs) parts.push(`${r.jobs} job(s) criado(s)`)
      toast.success(parts.join(' · ') || 'Concluído')
      setOpen(false); router.refresh()
    })
  }

  const totalSel = linkSel.size + createSel.size + jobSel.size

  return (
    <>
      <button type="button" onClick={abrir}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
        <FolderSync className="w-4 h-4" />
        <span className="hidden sm:inline">Sincronizar com o Drive</span>
      </button>

      {open && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="modal-card w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-gray-200 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h2 className="text-base font-semibold text-gray-900">Sincronizar jobs com o Drive</h2>
              <button aria-label="Fechar" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
            </div>

            {loading || !data ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-400">
                <Loader2 className="w-6 h-6 animate-spin" />
                <p className="text-sm">Lendo as pastas do Drive…</p>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                  {/* Casados */}
                  <section>
                    <div className="flex items-center gap-2 mb-2 text-gray-700">
                      <Link2 className="w-4 h-4" />
                      <h3 className="text-sm font-semibold">Jobs ↔ pasta encontrada ({data.matched.length})</h3>
                    </div>
                    {data.matched.length === 0 ? (
                      <p className="text-sm text-gray-400">Nenhum job casou com uma pasta existente.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {data.matched.map(m => (
                          <div key={m.activityId} className={cn('flex items-start gap-2.5 px-3 py-2 rounded-lg border', linkSel.has(m.activityId) ? 'border-gray-200' : 'border-gray-100 opacity-60')}>
                            <Checkbox on={linkSel.has(m.activityId)} onClick={() => toggle(linkSel, m.activityId, setLinkSel)} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{m.title}</p>
                              <p className="text-xs text-gray-400 truncate">→ {m.folderName}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {m.alreadyLinked && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">já vinculado</span>}
                              <span className={cn('text-[10px] px-1.5 py-0.5 rounded', m.confidence === 'exato' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')}>{m.confidence}</span>
                              {m.folderLink && <a href={m.folderLink} target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-gray-600 transition"><ExternalLink className="w-3.5 h-3.5" /></a>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Jobs sem pasta */}
                  <section>
                    <div className="flex items-center gap-2 mb-2 text-gray-700">
                      <FolderPlus className="w-4 h-4" />
                      <h3 className="text-sm font-semibold">Jobs sem pasta — criar ({data.jobsSemPasta.length})</h3>
                    </div>
                    {data.jobsSemPasta.length === 0 ? (
                      <p className="text-sm text-gray-400">Todos os jobs já têm pasta.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {data.jobsSemPasta.map(j => (
                          <div key={j.activityId} className={cn('flex items-start gap-2.5 px-3 py-2 rounded-lg border', createSel.has(j.activityId) ? 'border-gray-200' : 'border-gray-100 opacity-60')}>
                            <Checkbox on={createSel.has(j.activityId)} onClick={() => toggle(createSel, j.activityId, setCreateSel)} />
                            <p className="flex-1 min-w-0 text-sm font-medium text-gray-900 truncate">{j.title}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Pastas órfãs */}
                  <section>
                    <div className="flex items-center gap-2 mb-2 text-gray-700">
                      <FolderInput className="w-4 h-4" />
                      <h3 className="text-sm font-semibold">Pastas sem job ({data.pastasSemJob.length})</h3>
                    </div>
                    {data.pastasSemJob.length === 0 ? (
                      <p className="text-sm text-gray-400">Nenhuma pasta sobrando.</p>
                    ) : (
                      <>
                        <p className="text-xs text-gray-400 mb-1.5">Marque para criar um job a partir da pasta. Deixe desmarcado se for trabalho antigo/concluído.</p>
                        <div className="space-y-1.5">
                          {data.pastasSemJob.map(f => (
                            <div key={f.folderId} className={cn('flex items-start gap-2.5 px-3 py-2 rounded-lg border', jobSel.has(f.folderId) ? 'border-gray-200' : 'border-gray-100 opacity-60')}>
                              <Checkbox on={jobSel.has(f.folderId)} onClick={() => toggle(jobSel, f.folderId, setJobSel)} />
                              <p className="flex-1 min-w-0 text-sm text-gray-700 truncate">{f.name}</p>
                              {f.link && <a href={f.link} target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-gray-600 transition shrink-0"><ExternalLink className="w-3.5 h-3.5" /></a>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </section>
                </div>

                <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-gray-100 shrink-0">
                  <span className="text-xs text-gray-400">{totalSel} ação(ões) selecionada(s)</span>
                  <div className="flex gap-2">
                    <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
                    <button onClick={aplicar} disabled={pending || totalSel === 0}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
                      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Aplicar
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
