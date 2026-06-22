'use client'

/**
 * Mostra o "caminho na máquina" (Drive Desktop) adaptado ao SO de quem olha.
 * O caminho é salvo no formato Windows (G:\Drives compartilhados\...). No Mac,
 * convertemos para /Users/<usuário>/Library/CloudStorage/GoogleDrive-<email>/...
 * usando dados que o próprio usuário cadastra (guardados em localStorage, pois
 * são específicos da máquina). Sem cadastro, mostramos o caminho Windows + aviso.
 * Clicar no caminho copia para o clipboard.
 */
import { useState, useEffect, useRef } from 'react'
import { Check, Copy, AlertTriangle, Pencil } from 'lucide-react'
import { toast } from 'sonner'

const STORAGE_KEY = 'machine-path-config'

interface Config { macUser: string; googleEmail: string }

function loadConfig(): Config | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (p && typeof p.macUser === 'string' && typeof p.googleEmail === 'string' && p.macUser && p.googleEmail) {
      return { macUser: p.macUser, googleEmail: p.googleEmail }
    }
  } catch {}
  return null
}

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac/i.test(navigator.platform) || /Mac/i.test(navigator.userAgent)
}

/** Converte o caminho Windows (X:\Drives compartilhados\...) para o caminho do Mac. */
export function toMacPath(winPath: string, cfg: Config): string {
  const afterDrive = winPath.replace(/^[A-Za-z]:[\\/]+/, '')        // remove "G:\"
  const rest = afterDrive.replace(/\\/g, '/').replace(/\/+$/, '')   // \ → / e sem barra final
  return `/Users/${cfg.macUser}/Library/CloudStorage/GoogleDrive-${cfg.googleEmail}/${rest}`
}

const cleanWin = (p: string) => p.replace(/\\+$/, '')

export function MachinePath({ winPath, compact = false }: { winPath: string; compact?: boolean }) {
  const [mounted, setMounted] = useState(false)
  const [mac, setMac] = useState(false)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
    setMac(isMac())
    setCfg(loadConfig())
  }, [])

  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [open])

  // SSR e pré-mount: caminho Windows (evita divergência de hidratação).
  const macConfigured = mounted && mac && !!cfg
  const needsSetup = mounted && mac && !cfg
  const path = macConfigured ? toMacPath(winPath, cfg) : cleanWin(winPath)

  function copy(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    navigator.clipboard?.writeText(path).then(() => {
      setCopied(true)
      toast.success('Caminho copiado!')
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => toast.error('Não foi possível copiar'))
  }

  function save(macUser: string, googleEmail: string) {
    const c: Config = { macUser: macUser.trim(), googleEmail: googleEmail.trim() }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)) } catch {}
    setCfg(c)
    setOpen(false)
    toast.success('Dados salvos — caminho ajustado para o Mac')
  }

  return (
    <div className="relative flex items-center gap-1.5 min-w-0" ref={ref}>
      <button
        type="button"
        onClick={copy}
        title="Clique para copiar"
        className="flex items-center gap-1.5 min-w-0 text-xs text-gray-600 font-mono hover:text-indigo-600 transition-colors text-left"
      >
        <span className="truncate">{path}</span>
        {copied
          ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
          : <Copy className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
      </button>

      {needsSetup && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }}
          title="Este é o caminho do Windows. Cadastre seus dados para o caminho do Mac."
          className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 hover:text-amber-700 shrink-0 whitespace-nowrap"
        >
          <AlertTriangle className="w-3 h-3" />
          {compact ? 'Win' : 'caminho Windows · configurar'}
        </button>
      )}

      {macConfigured && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }}
          title="Editar dados do Mac"
          className="shrink-0 text-gray-300 hover:text-gray-500 transition-colors"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}

      {open && (
        <div className="pop-in absolute top-full left-0 mt-2 z-50 w-72 bg-white rounded-xl border border-gray-200 shadow-lg p-3">
          <ConfigForm initial={cfg} onSave={save} />
        </div>
      )}
    </div>
  )
}

function ConfigForm({ initial, onSave }: { initial: Config | null; onSave: (macUser: string, googleEmail: string) => void }) {
  const [email, setEmail] = useState(initial?.googleEmail ?? '')
  const [user, setUser] = useState(initial?.macUser ?? '')
  const inputCls = 'mt-1 w-full px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 transition'

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-500 leading-relaxed">
        No Mac o caminho é diferente. Informe seus dados (ficam salvos só neste navegador):
      </p>
      <label className="block">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">E-mail da conta Google</span>
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="voce@empresa.com.br" className={inputCls} />
      </label>
      <label className="block">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Usuário do Mac</span>
        <input value={user} onChange={e => setUser(e.target.value)} placeholder="ex.: rafaelgreiner" className={inputCls} />
      </label>
      <p className="text-[10px] text-gray-400">No Finder: o nome da sua pasta em /Users.</p>
      <button
        type="button"
        disabled={!email.trim() || !user.trim()}
        onClick={() => onSave(user, email)}
        className="w-full py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition"
      >
        Salvar
      </button>
    </div>
  )
}
