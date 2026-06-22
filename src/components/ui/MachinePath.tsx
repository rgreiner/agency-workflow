'use client'

/**
 * Mostra o "caminho na máquina" (Drive Desktop) adaptado ao SO de quem olha.
 * O caminho é salvo no formato Windows (G:\Drives compartilhados\...). No Mac,
 * convertemos para /Users/<usuário>/Library/CloudStorage/GoogleDrive-<email>/...
 * com os dados que a pessoa cadastra em Meu Perfil (via UserPrefsProvider).
 * Sem cadastro, mostramos o caminho Windows + link "configurar no perfil".
 * Clicar no caminho copia para o clipboard.
 */
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Check, Copy, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { useUserPrefs } from '@/components/providers/UserPrefsProvider'

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac/i.test(navigator.platform) || /Mac/i.test(navigator.userAgent)
}

/** Converte o caminho Windows (X:\Drives compartilhados\...) para o caminho do Mac. */
export function toMacPath(winPath: string, macUser: string, googleEmail: string): string {
  const afterDrive = winPath.replace(/^[A-Za-z]:[\\/]+/, '')        // remove "G:\"
  const rest = afterDrive.replace(/\\/g, '/').replace(/\/+$/, '')   // \ → / e sem barra final
  return `/Users/${macUser}/Library/CloudStorage/GoogleDrive-${googleEmail}/${rest}`
}

const cleanWin = (p: string) => p.replace(/\\+$/, '')

export function MachinePath({ winPath, compact = false }: { winPath: string; compact?: boolean }) {
  const prefs = useUserPrefs()
  const [mounted, setMounted] = useState(false)
  const [mac, setMac] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setMounted(true)
    setMac(isMac())
  }, [])

  const configured = !!(prefs.driveMacUser && prefs.driveGoogleEmail)
  // SSR/pré-mount e Windows: caminho Windows (evita divergência de hidratação).
  const useMac = mounted && mac && configured
  const needsSetup = mounted && mac && !configured
  const path = useMac ? toMacPath(winPath, prefs.driveMacUser!, prefs.driveGoogleEmail!) : cleanWin(winPath)

  function copy(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    navigator.clipboard?.writeText(path).then(() => {
      setCopied(true)
      toast.success('Caminho copiado!')
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => toast.error('Não foi possível copiar'))
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
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
    </div>
  )
}
