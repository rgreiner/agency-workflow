'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  Search, List, GanttChart, Users, BookOpen, PenTool,
  Folder, AlignLeft, Plus, Settings, User, Palette,
  CornerDownLeft, CheckSquare, Loader2, Archive,
  Inbox, Wallet, Megaphone, ClipboardList,
} from 'lucide-react'
import { searchActivities, searchExtras, type ExtraSearchResult } from '@/app/actions/search'

interface Workspace {
  id: string
  name: string
  campaigns: { id: string; name: string }[]
}

interface Props {
  orgSlug: string
  workspaces: Workspace[]
  open: boolean
  onClose: () => void
}

interface Item {
  id: string
  label: string
  hint?: string       // contexto extra exibido à direita (ex: nome do cliente)
  group: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  archived?: boolean
}

// Normaliza para busca sem acentos: "redação" encontra "redacao"
function norm(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

const EXTRA_META: Record<ExtraSearchResult['type'], { group: string; icon: Item['icon'] }> = {
  doc:      { group: 'Documentos', icon: BookOpen },
  midia:    { group: 'Mídias',     icon: Megaphone },
  producao: { group: 'Produção',   icon: ClipboardList },
}

export function CommandPalette({ open, ...rest }: Props) {
  // Monta/desmonta o painel: o estado interno (query, seleção) zera a cada abertura
  if (!open) return null
  return <PalettePanel {...rest} />
}

function PalettePanel({ orgSlug, workspaces, onClose }: Omit<Props, 'open'>) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [includeArchived, setIncludeArchived] = useState(false)
  // Resultados carregam a query que os gerou: itens obsoletos são descartados por derivação
  const [results, setResults] = useState<{ q: string; items: Item[] }>({ q: '', items: [] })
  const listRef = useRef<HTMLDivElement>(null)
  const base = `/${orgSlug}`
  const q = query.trim()

  // Busca server-side, debounced — atividades + docs/mídias/produção em paralelo.
  useEffect(() => {
    if (q.length < 2) return
    let cancelled = false
    const timer = setTimeout(async () => {
      let items: Item[] = []
      try {
        const [acts, extras] = await Promise.all([
          searchActivities(orgSlug, q, includeArchived),
          searchExtras(orgSlug, q, includeArchived),
        ])
        items = [
          ...acts.map(a => ({
            id: `act-${a.id}`,
            label: a.title,
            hint: `${a.workspaceName} / ${a.campaignName}`,
            group: 'Atividades',
            href: `${base}/workspaces/${a.workspaceId}/campaigns/${a.campaignId}/activities/${a.id}`,
            icon: CheckSquare,
            archived: a.archived,
          })),
          ...extras.map(e => ({
            id: `${e.type}-${e.id}`,
            label: e.title,
            hint: e.hint,
            group: EXTRA_META[e.type].group,
            href: e.href,
            icon: EXTRA_META[e.type].icon,
            archived: e.archived,
          })),
        ]
      } catch { /* falha de rede → trata como sem resultados */ }
      if (!cancelled) setResults({ q, items })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [q, orgSlug, base, includeArchived])

  const dynamicItems = q.length >= 2 && results.q === q ? results.items : []
  const searching     = q.length >= 2 && results.q !== q

  const allItems = useMemo<Item[]>(() => {
    const items: Item[] = [
      // Views
      { id: 'v-inbox',  label: 'Caixa de entrada',       group: 'Ir para', href: `${base}/inbox`,             icon: Inbox },
      { id: 'v-lista',  label: 'Lista de atividades',    group: 'Ir para', href: `${base}/views/lista`,       icon: List },
      { id: 'v-gantt',  label: 'Gantt',                  group: 'Ir para', href: `${base}/views/gantt`,       icon: GanttChart },
      { id: 'v-atend',  label: 'Painel de atendimento',  group: 'Ir para', href: `${base}/views/atendimento`, icon: Users },
      { id: 'v-docs',   label: 'Documentos',             group: 'Ir para', href: `${base}/docs`,              icon: BookOpen },
      { id: 'v-boards', label: 'Quadros visuais',        group: 'Ir para', href: `${base}/boards`,            icon: PenTool },
      { id: 'v-fin',    label: 'Financeiro',             group: 'Ir para', href: `${base}/financeiro/painel`, icon: Wallet },
      { id: 'v-dash',   label: 'Dashboard',              group: 'Ir para', href: `${base}/dashboard`,         icon: List },
      // Clientes
      ...workspaces.map(ws => ({
        id: `ws-${ws.id}`,
        label: ws.name,
        group: 'Clientes',
        href: `${base}/workspaces/${ws.id}`,
        icon: Folder,
      })),
      // Campanhas
      ...workspaces.flatMap(ws =>
        ws.campaigns.map(c => ({
          id: `camp-${c.id}`,
          label: c.name,
          hint: ws.name,
          group: 'Campanhas',
          href: `${base}/workspaces/${ws.id}/campaigns/${c.id}`,
          icon: AlignLeft,
        }))
      ),
      // Ações
      { id: 'a-ws',    label: 'Novo cliente',   group: 'Criar', href: `${base}/workspaces/new`, icon: Plus },
      { id: 'a-board', label: 'Novo quadro',    group: 'Criar', href: `${base}/boards/new`,     icon: Plus },
      // Configurações
      { id: 's-membros',   label: 'Membros da equipe',  group: 'Configurações', href: `${base}/settings/membros`,   icon: Settings },
      { id: 's-cargos',    label: 'Cargos',             group: 'Configurações', href: `${base}/settings/cargos`,    icon: Settings },
      { id: 's-aparencia', label: 'Aparência',          group: 'Configurações', href: `${base}/settings/aparencia`, icon: Palette },
      { id: 's-perfil',    label: 'Meu perfil',         group: 'Configurações', href: `${base}/perfil`,             icon: User },
    ]
    return items
  }, [base, workspaces])

  const filtered = useMemo(() => {
    if (!query.trim()) return allItems
    const q = norm(query)
    const statics = allItems.filter(item =>
      norm(item.label).includes(q) || (item.hint && norm(item.hint).includes(q))
    )
    return [...statics, ...dynamicItems]
  }, [query, allItems, dynamicItems])

  // Agrupa mantendo ordem
  const groups = useMemo(() => {
    const seen: string[] = []
    for (const item of filtered) {
      if (!seen.includes(item.group)) seen.push(item.group)
    }
    return seen.map(g => ({ name: g, items: filtered.filter(i => i.group === g) }))
  }, [filtered])

  const go = useCallback((item: Item) => {
    onClose()
    router.push(item.href)
  }, [onClose, router])

  // Teclado dentro do palette
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => Math.min(i + 1, filtered.length - 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => Math.max(i - 1, 0))
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = filtered[activeIdx]
        if (item) go(item)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [filtered, activeIdx, go, onClose])

  // Mantém item ativo visível
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  let flatIdx = -1

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Busca rápida"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[2px] animate-[fadeIn_0.12s_ease-out]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden animate-[paletteIn_0.15s_ease-out]">

        {/* Input */}
        <div className="flex items-center gap-3 px-4 border-b border-gray-100">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
            placeholder="Buscar atividade, cliente, doc, mídia, produção…"
            className="flex-1 py-3.5 text-sm text-gray-900 placeholder-gray-400 bg-transparent focus:outline-none"
          />
          {searching && <Loader2 className="w-3.5 h-3.5 text-gray-300 animate-spin shrink-0" />}
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium text-gray-400 bg-gray-50 border border-gray-200 rounded">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto overscroll-contain py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-sm text-gray-400 text-center">
              {searching ? 'Buscando…' : `Nada encontrado para “${query}”`}
            </p>
          ) : (
            groups.map(group => (
              <div key={group.name}>
                <p className="px-4 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                  {group.name}
                </p>
                {group.items.map(item => {
                  flatIdx++
                  const idx = flatIdx
                  const active = idx === activeIdx
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      data-active={active}
                      onClick={() => go(item)}
                      onMouseMove={() => setActiveIdx(idx)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors',
                        active ? 'bg-orange-50 text-orange-900' : 'text-gray-700'
                      )}
                    >
                      <Icon className={cn('w-4 h-4 shrink-0', active ? 'text-orange-500' : 'text-gray-400')} />
                      <span className="flex-1 truncate font-medium">{item.label}</span>
                      {item.archived && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">arquivada</span>
                      )}
                      {item.hint && (
                        <span className="text-xs text-gray-400 truncate max-w-[120px]">{item.hint}</span>
                      )}
                      {active && <CornerDownLeft className="w-3.5 h-3.5 text-orange-400 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-gray-100 bg-gray-50/60 text-[11px] text-gray-400">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-white border border-gray-200 rounded text-[10px]">↑↓</kbd>
            navegar
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-white border border-gray-200 rounded text-[10px]">↵</kbd>
            abrir
          </span>
          <button
            type="button"
            onClick={() => setIncludeArchived(v => !v)}
            className={cn(
              'ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md transition',
              includeArchived ? 'bg-orange-50 text-orange-600' : 'text-gray-400 hover:text-gray-600'
            )}
          >
            <Archive className="w-3 h-3" />
            {includeArchived ? 'Arquivadas incluídas' : 'Incluir arquivadas'}
          </button>
        </div>
      </div>
    </div>
  )
}
