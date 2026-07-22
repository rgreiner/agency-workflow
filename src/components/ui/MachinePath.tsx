'use client'

/**
 * Mostra (e opcionalmente edita) o "caminho na máquina" do Drive Desktop,
 * adaptado ao SO de quem olha. O caminho é salvo no formato Windows
 * (G:\Drives compartilhados\...). No Mac, convertemos para
 * /Users/<usuário>/Library/CloudStorage/GoogleDrive-<email>/... com os dados que
 * a pessoa cadastra em Meu Perfil (UserPrefsProvider). Sem cadastro, mostramos o
 * caminho Windows + link "configurar no perfil". Clicar no caminho copia.
 * Com `editable`, um lápis abre um input que salva em activities.drive_path.
 */
import { useState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { Check, Copy, AlertTriangle, Pencil, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useUserPrefs } from '@/components/providers/UserPrefsProvider'
import { updateActivityField } from '@/app/actions/activity'

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac/i.test(navigator.platform) || /Mac/i.test(navigator.userAgent)
}

// O Google Drive Desktop LOCALIZA a raiz das pastas pelo idioma do sistema. O caminho
// é guardado em pt (é o que os Windows da equipe geram); pra quem usa o Mac/Drive em
// inglês, traduzimos a 1ª pasta. Reconhece as duas grafias (robusto se um dia guardarem en).
const DRIVE_ROOTS: { pt: string; en: string }[] = [
  { pt: 'Drives compartilhados', en: 'Shared drives' },
  { pt: 'Meu Drive', en: 'My Drive' },
]
function traduzRaiz(seg: string, lang: 'pt' | 'en'): string {
  const r = DRIVE_ROOTS.find(x => x.pt === seg || x.en === seg)
  return r ? r[lang] : seg
}

/** Converte o caminho Windows (X:\Drives compartilhados\...) para o caminho do Mac,
 *  traduzindo a raiz do Drive pro idioma do Mac da pessoa (lang). */
export function toMacPath(winPath: string, macUser: string, googleEmail: string, lang: 'pt' | 'en' = 'pt'): string {
  const afterDrive = winPath.replace(/^[A-Za-z]:[\\/]+/, '')        // remove "G:\"
  const rest = afterDrive.replace(/\\/g, '/').replace(/\/+$/, '')   // \ → / e sem barra final
  const segs = rest.split('/')
  if (segs.length) segs[0] = traduzRaiz(segs[0], lang)              // raiz localizada
  return `/Users/${macUser}/Library/CloudStorage/GoogleDrive-${googleEmail}/${segs.join('/')}`
}

const cleanWin = (p: string) => p.replace(/\\+$/, '')

interface Props {
  winPath: string
  compact?: boolean
  /** Permite editar o caminho (salva em drive_path). Requer activityId + path. */
  editable?: boolean
  activityId?: string
  path?: string
}

export function MachinePath({ winPath, compact = false, editable = false, activityId, path }: Props) {
  const prefs = useUserPrefs()
  const [mounted, setMounted] = useState(false)
  const [mac, setMac] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, startSave] = useTransition()

  useEffect(() => {
    setMounted(true)
    setMac(isMac())
  }, [])

  const has = !!winPath.trim()
  const configured = !!(prefs.driveMacUser && prefs.driveGoogleEmail)
  // SSR/pré-mount e Windows: caminho Windows (evita divergência de hidratação).
  const useMac = mounted && mac && configured && has
  const needsSetup = mounted && mac && !configured && has
  const display = has ? (useMac ? toMacPath(winPath, prefs.driveMacUser!, prefs.driveGoogleEmail!, prefs.driveLang === 'en' ? 'en' : 'pt') : cleanWin(winPath)) : ''

  function copy(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    navigator.clipboard?.writeText(display).then(() => {
      setCopied(true)
      toast.success('Caminho copiado!')
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => toast.error('Não foi possível copiar'))
  }

  function startEdit() {
    setDraft(cleanWin(winPath))
    setEditing(true)
  }

  function save() {
    if (!activityId || !path) return
    startSave(async () => {
      const r = await updateActivityField(path, activityId, 'drive_path', draft.trim() || null)
      if (r?.error) toast.error(r.error)
      else { toast.success('Caminho atualizado'); setEditing(false) }
    })
  }

  // ── Edição ──
  if (editable && editing) {
    return (
      <div className="flex items-center gap-1.5 w-full min-w-0">
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); save() }
            else if (e.key === 'Escape') setEditing(false)
          }}
          placeholder={'G:\\Drives compartilhados\\...'}
          className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-gray-300 text-xs font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-300"
        />
        <button type="button" onClick={save} disabled={saving} title="Salvar" className="shrink-0 text-orange-600 hover:text-orange-700 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        </button>
        <button type="button" onClick={() => setEditing(false)} title="Cancelar" className="shrink-0 text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  // ── Vazio ──
  if (!has) {
    return editable ? (
      <button type="button" onClick={startEdit} className="text-xs text-gray-400 italic hover:text-orange-500 transition-colors">
        Clique para definir o caminho
      </button>
    ) : <span className="text-xs text-gray-300">—</span>
  }

  // ── Leitura ──
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <button
        type="button"
        onClick={copy}
        title="Clique para copiar"
        className="flex items-center gap-1.5 min-w-0 text-xs text-gray-600 font-mono hover:text-orange-600 transition-colors text-left"
      >
        <span className="truncate">{display}</span>
        {copied
          ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
          : <Copy className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
      </button>

      {needsSetup && (
        <Link
          href={`/${prefs.orgSlug}/perfil`}
          title="Cadastre seus dados do Mac em Meu Perfil para ver o caminho correto"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 hover:text-amber-700 shrink-0 whitespace-nowrap"
        >
          <AlertTriangle className="w-3 h-3" />
          {compact ? 'Win' : 'caminho Windows · configurar no perfil'}
        </Link>
      )}

      {editable && (
        <button type="button" onClick={startEdit} title="Editar caminho" className="shrink-0 text-gray-300 hover:text-gray-500 transition-colors">
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}
