'use client'

import { useState, useMemo, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Wallet, Upload, Loader2, Check, X, Users } from 'lucide-react'
import { toast } from 'sonner'
import { formatBRL } from '@/lib/midia'
import { importarFolha } from '@/app/actions/rh'

export interface FolhaRow {
  competencia: string; nome: string | null; liquido: number | string | null
  vencimentos: number | string | null; descontos: number | string | null
  inss: number | string | null; fgts: number | string | null; colaborador_id: string | null
}
interface LinhaExtraida {
  matricula?: string; nome?: string; cpf?: string; cargo?: string; categoria?: string; data_admissao?: string
  salario_base?: number; vencimentos?: number; descontos?: number; inss?: number; irrf?: number
  fgts?: number; vale_refeicao?: number; faltas?: number; liquido?: number
}

const n = (v: number | string | null | undefined) => Number(v ?? 0)
const compLabel = (c: string) => { const [y, m] = c.split('-'); return `${m}/${y}` }

export function FolhaClient({ orgSlug, linhas }: { orgSlug: string; linhas: FolhaRow[] }) {
  const [preview, setPreview] = useState<{ competencia: string; linhas: LinhaExtraida[] } | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const competencias = useMemo(() => {
    const map = new Map<string, { liquido: number; vencimentos: number; fgts: number; pessoas: number }>()
    for (const l of linhas) {
      const cur = map.get(l.competencia) ?? { liquido: 0, vencimentos: 0, fgts: 0, pessoas: 0 }
      cur.liquido += n(l.liquido); cur.vencimentos += n(l.vencimentos); cur.fgts += n(l.fgts); cur.pessoas += 1
      map.set(l.competencia, cur)
    }
    return [...map.entries()].map(([competencia, v]) => ({ competencia, ...v })).sort((a, b) => b.competencia.localeCompare(a.competencia))
  }, [linhas])

  const maxLiq = Math.max(1, ...competencias.map(c => c.liquido))

  async function onPick(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('orgSlug', orgSlug); fd.append('file', file)
      const res = await fetch('/api/rh/folha/extract', { method: 'POST', body: fd })
      const j = await res.json()
      if (!res.ok) { toast.error(j.error || 'Falha na extração'); return }
      const comp: string | null = j.competencia
      setPreview({ competencia: comp || '', linhas: j.linhas || [] })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha na extração') }
    finally { setUploading(false) }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Wallet className="w-5 h-5 text-orange-600" /> Folha</h1>
          <p className="text-gray-500 text-sm mt-0.5">Importe a folha da contabilidade (PDF); a IA extrai e casa por CPF.</p>
        </div>
        <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
          onChange={e => { const x = e.target.files?.[0]; if (x) onPick(x); e.target.value = '' }} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {uploading ? 'Lendo…' : 'Importar folha (PDF)'}
        </button>
      </div>

      {competencias.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">Nenhuma folha importada. Suba o PDF da contabilidade.</div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-400">
              <th className="text-left px-4 py-3 font-medium">Competência</th>
              <th className="text-left px-4 py-3 font-medium">Pessoas</th>
              <th className="text-right px-4 py-3 font-medium">Líquido</th>
              <th className="text-right px-4 py-3 font-medium">FGTS</th>
              <th className="text-left px-4 py-3 font-medium w-1/3">Evolução</th>
            </tr></thead>
            <tbody>
              {competencias.map(c => (
                <tr key={c.competencia} className="border-b border-gray-50 last:border-0 hover:bg-orange-50/40 transition">
                  <td className="px-4 py-3 font-medium text-gray-900 tabular-nums">{compLabel(c.competencia)}</td>
                  <td className="px-4 py-3 text-gray-500"><span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" />{c.pessoas}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">{formatBRL(c.liquido)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">{formatBRL(c.fgts)}</td>
                  <td className="px-4 py-3">
                    <div className="h-2 rounded-full bg-orange-100 overflow-hidden"><div className="h-full bg-orange-500 rounded-full" style={{ width: `${Math.round((c.liquido / maxLiq) * 100)}%` }} /></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && <PreviewModal orgSlug={orgSlug} data={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

function PreviewModal({ orgSlug, data, onClose }: { orgSlug: string; data: { competencia: string; linhas: LinhaExtraida[] }; onClose: () => void }) {
  const router = useRouter()
  const [competencia, setCompetencia] = useState(data.competencia)
  const [autoCriar, setAutoCriar] = useState(true)
  const [saving, start] = useTransition()

  const totalLiq = data.linhas.reduce((s, l) => s + n(l.liquido), 0)

  function importar() {
    if (!/^\d{4}-\d{2}$/.test(competencia)) { toast.error('Informe a competência (AAAA-MM).'); return }
    start(async () => {
      const r = await importarFolha(orgSlug, competencia, data.linhas, autoCriar)
      if (r?.error) { toast.error(r.error); return }
      const res = r.resultado
      toast.success(`Folha importada: ${res?.linhas} linhas · ${res?.criados} criados · ${res?.casados} casados.`)
      onClose(); router.refresh()
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-3xl max-h-[90vh] overflow-hidden bg-white rounded-2xl shadow-xl border border-gray-200 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Conferir folha extraída</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4 flex items-center gap-4 border-b border-gray-100 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Competência</label>
            <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)}
              className="px-3 py-1.5 text-sm bg-gray-100 border border-transparent rounded-lg text-gray-800" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={autoCriar} onChange={e => setAutoCriar(e.target.checked)} className="rounded text-orange-600 focus:ring-orange-500" />
            Criar ficha de quem ainda não existe (casa por CPF)
          </label>
          <div className="ml-auto text-sm text-gray-500">{data.linhas.length} pessoas · líquido <b className="text-gray-900 tabular-nums">{formatBRL(totalLiq)}</b></div>
        </div>

        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white"><tr className="border-b border-gray-100 text-xs text-gray-400">
              <th className="text-left px-6 py-2 font-medium">Nome</th>
              <th className="text-left px-3 py-2 font-medium">Cargo</th>
              <th className="text-right px-3 py-2 font-medium">Salário</th>
              <th className="text-right px-3 py-2 font-medium">INSS</th>
              <th className="text-right px-6 py-2 font-medium">Líquido</th>
            </tr></thead>
            <tbody>
              {data.linhas.map((l, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-0">
                  <td className="px-6 py-2 text-gray-900">{l.nome || '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{l.cargo || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{formatBRL(n(l.salario_base))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatBRL(n(l.inss))}</td>
                  <td className="px-6 py-2 text-right tabular-nums font-medium text-gray-900">{formatBRL(n(l.liquido))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button onClick={importar} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Importar competência
          </button>
        </div>
      </div>
    </div>
  )
}
