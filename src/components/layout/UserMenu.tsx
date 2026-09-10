'use client'

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { ChevronsUpDown, ClipboardCheck, Clock, LogOut, Moon, Settings, Sun, User, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { logout } from '@/app/actions/auth'

// Tema: a verdade é a classe .dark no <html> (o script pré-paint do layout raiz
// já aplicou). Ler no render via store evita o flash do ícone errado que o
// useState(false) + useEffect dava.
function assinarTema(cb: () => void) {
  const obs = new MutationObserver(cb)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => obs.disconnect()
}
const temaEscuro = () => document.documentElement.classList.contains('dark')

const ITEM =
  'no-press w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left text-gray-300 hover:text-gray-100 hover:bg-gray-700/70 transition-colors'
const ITEM_ATIVO = 'text-gray-100 bg-gray-700/50'

// Páginas pessoais (e a Configurações do proprietário). Antes eram três linhas
// fixas no rodapé; aqui ficam a um clique do avatar, como o Perfil.
const PAGINAS: { label: string; href: string; icon: LucideIcon; owner?: boolean }[] = [
  { label: 'Meu perfil',    href: 'perfil',           icon: User },
  { label: 'Meu ponto',     href: 'ponto',            icon: Clock },
  { label: 'Avaliação',     href: 'avaliacao',        icon: ClipboardCheck },
  { label: 'Configurações', href: 'settings/membros', icon: Settings, owner: true },
]

/**
 * Rodapé da sidebar: avatar + nome abrem o menu da pessoa — Perfil, Ponto,
 * Avaliação, Configurações (proprietário), Tema e Sair. "Sair" era um ícone
 * de 14px colado no toggle de tema — a única ação irreversível da casca no
 * menor alvo da tela. Aqui ela confirma e mostra o estado pendente enquanto
 * o redirect corre.
 */
export function UserMenu({ base, nome, email, avatarUrl, canManage = false }: {
  base: string
  nome?: string | null
  email: string
  avatarUrl?: string | null
  /** Proprietário: vê Configurações. */
  canManage?: boolean
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [confirmaSair, setConfirmaSair] = useState(false)
  const [saindo, startSaindo] = useTransition()
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dark = useSyncExternalStore(assinarTema, temaEscuro, () => false)
  const display = nome || email
  const numaPaginaDoMenu = PAGINAS.some(p => pathname.startsWith(`${base}/${p.href.split('/')[0]}`))

  function alternarTema() {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('theme', next ? 'dark' : 'light') } catch { /* sem localStorage */ }
  }

  // Aberto: clique fora fecha; Esc fecha e devolve o foco ao gatilho; ↑↓ andam
  // pelos itens; o primeiro item recebe o foco ao abrir.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); triggerRef.current?.focus(); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const itens = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
      if (!itens.length) return
      e.preventDefault()
      const i = itens.indexOf(document.activeElement as HTMLElement)
      const n = e.key === 'ArrowDown' ? (i + 1) % itens.length : (i - 1 + itens.length) % itens.length
      itens[n].focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function sair() {
    // O redirect do logout resolve a navegação; até lá o diálogo mostra "saindo".
    startSaindo(async () => { await logout() })
  }

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu de ${display}`}
        className={cn(
          'no-press flex items-center gap-2.5 w-full min-w-0 px-1 py-1 rounded-lg text-left transition-colors',
          open ? 'bg-gray-800 text-gray-100'
            : numaPaginaDoMenu ? 'text-gray-100 hover:bg-gray-800/60'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
        )}
      >
        <Avatar name={display} avatarUrl={avatarUrl} className="ring-0 shrink-0" />
        <span className="text-sm truncate flex-1">{display}</span>
        <ChevronsUpDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Menu do usuário"
          className="pop-up absolute bottom-full left-0 mb-2 w-56 rounded-xl bg-gray-800 border border-gray-700 p-1 z-[70]"
        >
          <div className="px-2.5 pt-1.5 pb-2 mb-1 border-b border-gray-700">
            <p className="text-sm font-medium text-gray-100 truncate">{display}</p>
            {nome && <p className="text-[11px] text-gray-400 truncate">{email}</p>}
          </div>
          {PAGINAS.filter(p => !p.owner || canManage).map(({ label, href, icon: Icon }) => {
            // Configurações acende em qualquer /settings/*, não só em membros.
            const ativo = pathname.startsWith(`${base}/${href.split('/')[0]}`)
            return (
              <Link
                key={href}
                role="menuitem"
                href={`${base}/${href}`}
                aria-current={ativo ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={cn(ITEM, ativo && ITEM_ATIVO)}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            )
          })}
          <div className="my-1 border-t border-gray-700" />
          <button role="menuitem" type="button" onClick={alternarTema} className={ITEM}>
            {dark ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
            {dark ? 'Tema claro' : 'Tema escuro'}
          </button>
          <div className="my-1 border-t border-gray-700" />
          <button
            role="menuitem"
            type="button"
            onClick={() => { setOpen(false); setConfirmaSair(true) }}
            className={cn(ITEM, 'text-red-300 hover:text-red-200')}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sair
          </button>
        </div>
      )}

      {/* Fora da sidebar (portal): o diálogo herda o tema do conteúdo, não a paleta escura. */}
      {confirmaSair && typeof document !== 'undefined' && createPortal(
        <ConfirmDialog
          open={confirmaSair}
          title="Sair do Flow?"
          description="Você vai precisar entrar de novo com e-mail e senha."
          confirmLabel={saindo ? 'Saindo…' : 'Sair'}
          loading={saindo}
          onConfirm={sair}
          onCancel={() => setConfirmaSair(false)}
        />,
        document.body,
      )}
    </div>
  )
}
