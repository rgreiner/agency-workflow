'use client'

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileSpreadsheet, Loader2, Check, AlertCircle, Trash2, X, Wallet, ListPlus } from 'lucide-react'
import { toast } from 'sonner'
import { formatBRL } from '@/lib/midia'
import { mapSheetToRows, summarize, seedFromRows, type ExtratoRow, type SeedData } from '@/lib/extrato'
import { importarExtrato, limparExtrato, seedFinanceFromExtrato, promoverPrevistosExtrato, atualizarSaldosContaAzul } from '@/app/actions/financeiro'

const CHUNK = 500

type Preview = ReturnType<typeof summarize>

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function fmtDateTime(iso: string | null) {
  if (!iso) return null
  const dt = new Date(iso)
  return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ImportarClient({ orgSlug, totalAtual, ultimoImport }: {
  orgSlug: string; totalAtual: number; ultimoImport: string | null
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<ExtratoRow[] | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [seed, setSeed] = useState<SeedData | null>(null)
  const [seedConfig, setSeedConfig] = useState(true)
  const [error, setError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [done, setDone] = useState<{ inserted: number; updated: number; contas?: number; contas_atualizadas?: number; centros?: number; categorias?: number } | null>(null)
  const [clearing, startClear] = useTransition()
  const [confirmClear, setConfirmClear] = useState(false)
  const [seeding, startSeed] = useTransition()
  const [promoting, startPromote] = useTransition()
  const [savingSaldos, startSaldos] = useTransition()

  function doSeedNow() {
    setError(''); setDone(null)
    startSeed(async () => {
      const res = await seedFinanceFromExtrato(orgSlug)
      if (res?.error) { setError(res.error); return }
      setDone({ inserted: 0, updated: 0, ...res?.result })
      router.refresh()
    })
  }

  function doPromover() {
    setError(''); setDone(null)
    startPromote(async () => {
      const res = await promoverPrevistosExtrato(orgSlug)
      if (res?.error) { setError(res.error); return }
      toast.success(`${res?.result?.inserted ?? 0} a receber/a pagar trazido(s) pra Lançamentos (conciliação).`)
      router.refresh()
    })
  }

  function doAtualizarSaldos() {
    setError(''); setDone(null)
    startSaldos(async () => {
      const res = await atualizarSaldosContaAzul(orgSlug)
      if (res?.error) { setError(res.error); return }
      toast.success(`Saldos atualizados pelo Conta Azul (${res?.result?.contas_atualizadas ?? 0} conta(s)).`)
      router.refresh()
    })
  }

  async function onFile(file: File) {
    setError(''); setDone(null); setRows(null); setPreview(null); setSeed(null); setFileName(file.name)
    setParsing(true)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false })
      const res = mapSheetToRows(matrix)
      if (res.error) { setError(res.error); setParsing(false); return }
      if (res.rows.length === 0) { setError('Nenhuma linha encontrada no arquivo.'); setParsing(false); return }
      setRows(res.rows)
      setPreview(summarize(res.rows))
      setSeed(seedFromRows(res.rows))
    } catch (e) {
      setError('Falha ao ler o arquivo: ' + (e instanceof Error ? e.message : String(e)))
    }
    setParsing(false)
  }

  async function doImport() {
    if (!rows) return
    setError(''); setDone(null)
    setProgress({ done: 0, total: rows.length })
    // Substitui tudo: apaga o extrato importado antes de recarregar o arquivo completo.
    // É o que garante "não duplicar" mesmo quando situação/saldo mudam entre exports
    // (e reflete baixas e exclusões feitas na Conta Azul).
    const clr = await limparExtrato(orgSlug)
    if (clr?.error) { setError('Falha ao limpar antes de importar: ' + clr.error); setProgress(null); return }
    let inserted = 0, updated = 0
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const res = await importarExtrato(orgSlug, chunk)
      if (res?.error) { setError(res.error); setProgress(null); return }
      if (res?.result) { inserted += res.result.inserted; updated += res.result.updated }
      setProgress({ done: Math.min(i + CHUNK, rows.length), total: rows.length })
    }
    setProgress(null)

    // Seed da config (contas / centros / categorias) — não-destrutivo, a partir da
    // tabela já importada.
    let seedCounts: { contas: number; centros: number; categorias: number } | undefined
    if (seedConfig) {
      const res = await seedFinanceFromExtrato(orgSlug)
      if (res?.error) { setError('Lançamentos importados, mas o seed da config falhou: ' + res.error) }
      else seedCounts = res?.result
    }

    setDone({ inserted, updated, ...seedCounts })
    setRows(null); setPreview(null); setSeed(null); setFileName(null)
    if (inputRef.current) inputRef.current.value = ''
    router.refresh()
  }

  function doClear() {
    startClear(async () => {
      const res = await limparExtrato(orgSlug)
      if (res?.error) { setError(res.error); return }
      setConfirmClear(false)
      router.refresh()
    })
  }

  const ultimo = fmtDateTime(ultimoImport)

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900">Importar extrato</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Suba o export <strong>&ldquo;Extrato Financeiro&rdquo;</strong> <strong>completo</strong> da Conta Azul (.xls, .xlsx ou .csv).
          Cada import <strong>substitui</strong> o extrato anterior — não duplica e reflete baixas e exclusões feitas na Conta Azul.
        </p>
      </div>

      {/* status atual */}
      <div className="flex items-center gap-4 mb-5 text-sm">
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-[11px] text-gray-400">Lançamentos importados</p>
          <p className="text-lg font-semibold text-gray-900">{totalAtual.toLocaleString('pt-BR')}</p>
        </div>
        {ultimo && (
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-[11px] text-gray-400">Último import</p>
            <p className="text-sm font-medium text-gray-700">{ultimo}</p>
          </div>
        )}
        {totalAtual > 0 && (
          <div className="ml-auto flex items-center gap-3">
            <button onClick={doSeedNow} disabled={seeding}
              className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-600 transition disabled:opacity-50">
              {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
              Gerar contas, centros e categorias
            </button>
            <button onClick={doAtualizarSaldos} disabled={savingSaldos}
              title="Força o saldo de cada conta = soma dos realizados do Conta Azul (sobrescreve o saldo atual)"
              className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-600 transition disabled:opacity-50">
              {savingSaldos ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
              Atualizar saldos pelo Conta Azul
            </button>
            <button onClick={doPromover} disabled={promoting}
              title="Cria lançamentos 'em aberto' pros a receber/a pagar (Em aberto/Atrasado) do Conta Azul, pra aparecerem na conciliação"
              className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-600 transition disabled:opacity-50">
              {promoting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListPlus className="w-3.5 h-3.5" />}
              Trazer a receber/a pagar pra Lançamentos
            </button>
            <button onClick={() => setConfirmClear(true)}
              className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-600 transition">
              <Trash2 className="w-3.5 h-3.5" /> Limpar tudo
            </button>
          </div>
        )}
      </div>

      {/* dropzone / file picker */}
      <label
        className="block border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center cursor-pointer hover:border-orange-300 hover:bg-orange-50/30 transition-colors"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f) }}
      >
        <input ref={inputRef} type="file" accept=".xls,.xlsx,.csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
        {parsing ? (
          <span className="inline-flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Lendo arquivo…</span>
        ) : fileName ? (
          <span className="inline-flex items-center gap-2 text-sm text-gray-700"><FileSpreadsheet className="w-5 h-5 text-emerald-600" /> {fileName}</span>
        ) : (
          <span className="inline-flex flex-col items-center gap-2 text-sm text-gray-500">
            <Upload className="w-7 h-7 text-gray-300" />
            Arraste o arquivo aqui ou <span className="text-orange-600 font-medium">clique para selecionar</span>
          </span>
        )}
      </label>

      {error && (
        <p className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 inline-flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </p>
      )}

      {done && (
        <div className="mt-4 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 inline-flex items-start gap-2">
          <Check className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {(done.inserted > 0 || done.updated > 0) && (
              <>Import concluído — {(done.inserted + done.updated).toLocaleString('pt-BR')} lançamentos carregados (substituiu o extrato anterior).<br /></>
            )}
            {done.contas != null && (
              <>Config: {done.contas} conta(s) criada(s){done.contas_atualizadas ? ` + ${done.contas_atualizadas} com saldo preenchido` : ''}, {done.centros} centro(s) de custo, {done.categorias} categoria(s).</>
            )}
          </span>
        </div>
      )}

      {/* preview + confirmar */}
      {preview && rows && !progress && (
        <div className="mt-5 bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Prévia — {preview.total.toLocaleString('pt-BR')} lançamentos</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <PreviewStat label="Recebido" value={preview.recebido} tone="emerald" />
            <PreviewStat label="Pago" value={preview.pago} tone="red" />
            <PreviewStat label="A receber" value={preview.aReceber} tone="emerald" muted />
            <PreviewStat label="A pagar" value={preview.aPagar} tone="red" muted />
          </div>
          <p className="text-xs text-gray-400 mb-4">Período: {fmtDate(preview.periodo.de)} a {fmtDate(preview.periodo.ate)}</p>

          {seed && (
            <label className="flex items-start gap-2.5 mb-4 cursor-pointer select-none">
              <input type="checkbox" checked={seedConfig} onChange={e => setSeedConfig(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
              <span className="text-sm text-gray-600">
                Também criar <strong>{seed.contas.length} contas</strong> (com saldo atual), <strong>{seed.centros.length} centros de custo</strong> e <strong>{seed.categorias.length} categorias</strong> a partir do arquivo.
                <span className="block text-xs text-gray-400 mt-0.5">Não sobrescreve o que já existe — só adiciona o que falta.</span>
              </span>
            </label>
          )}

          <button onClick={doImport}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition">
            <Check className="w-4 h-4" /> Confirmar import
          </button>
        </div>
      )}

      {/* progresso */}
      {progress && (
        <div className="mt-5 bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm text-gray-700 mb-2 inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-orange-600" />
            Importando… {progress.done.toLocaleString('pt-BR')} / {progress.total.toLocaleString('pt-BR')}
          </p>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-orange-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {/* confirmar limpar */}
      {confirmClear && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="modal-card w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Limpar extrato importado</h2>
              <button aria-label="Fechar" onClick={() => setConfirmClear(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-600">Apaga os {totalAtual.toLocaleString('pt-BR')} lançamentos importados. As views de fluxo de caixa ficam vazias até reimportar. Isso não afeta os lançamentos do sistema (mídia/fee/manual).</p>
              <div className="flex justify-end gap-2 pt-4">
                <button onClick={() => setConfirmClear(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
                <button onClick={doClear} disabled={clearing}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-red-700 disabled:opacity-50 transition">
                  {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Apagar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PreviewStat({ label, value, tone, muted }: { label: string; value: number; tone: 'emerald' | 'red'; muted?: boolean }) {
  const color = tone === 'emerald' ? 'text-emerald-600' : 'text-red-600'
  return (
    <div>
      <p className="text-[11px] text-gray-400 mb-0.5">{label}</p>
      <p className={`text-base font-semibold ${muted ? 'opacity-60' : ''} ${color}`}>{formatBRL(value)}</p>
    </div>
  )
}
