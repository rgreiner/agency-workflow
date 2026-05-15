'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  FolderKanban,
  List,
  GanttChart,
  Users,
  Settings,
  LogOut,
  ChevronDown,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface SidebarProps {
  orgSlug: string
  orgName: string
  userEmail: string
  userAvatar?: string | null
}

export function Sidebar({ orgSlug, orgName, userEmail, userAvatar }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const base = `/${orgSlug}`

  const navItems = [
    { href: `${base}/dashboard`, label: 'Dashboard', icon: LayoutDashboard },
    { href: `${base}/workspaces`, label: 'Clientes', icon: FolderKanban },
    { href: `${base}/views/list`, label: 'Minhas tarefas', icon: List },
    { href: `${base}/views/gantt`, label: 'Gantt', icon: GanttChart },
    { href: `${base}/views/board`, label: 'Painel atendimento', icon: Users },
  ]

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="w-60 shrink-0 bg-gray-900 flex flex-col h-full">
      {/* Logo / Org */}
      <div className="px-4 py-5 border-b border-gray-800">
        <button className="flex items-center gap-2 w-full group">
          <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold">
              {orgName.charAt(0).toUpperCase()}
            </span>
          </div>
          <span className="text-gray-100 font-medium text-sm truncate">{orgName}</span>
          <ChevronDown className="w-3.5 h-3.5 text-gray-500 ml-auto shrink-0" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
              pathname.startsWith(href)
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </Link>
        ))}

        <div className="pt-4 mt-4 border-t border-gray-800 space-y-0.5">
          <Link
            href={`${base}/settings`}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
              pathname.startsWith(`${base}/settings`)
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
            )}
          >
            <Settings className="w-4 h-4 shrink-0" />
            Configurações
          </Link>
        </div>
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-gray-800">
        <div className="flex items-center gap-2.5">
          {userAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={userAvatar} alt="" className="w-7 h-7 rounded-full shrink-0" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
              <span className="text-gray-300 text-xs">{userEmail.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <span className="text-gray-400 text-xs truncate flex-1">{userEmail}</span>
          <button onClick={signOut} className="text-gray-600 hover:text-gray-400 transition">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}
