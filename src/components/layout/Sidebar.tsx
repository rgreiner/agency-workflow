'use client'

import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Plus,
  AlignLeft,
  X,
  PanelLeftClose,
  PanelLeft,
  Briefcase,
  Gauge,
  List,
  GanttChart,
  BookOpen,
  PenTool,
  Search,
  Megaphone,
  Radio,
  ClipboardList,
  Compass,
  UserCog,
  Wallet,
  Users,
  SquareKanban,
  Building2,
  type LucideIcon,
} from 'lucide-react'
import { UserMenu } from './UserMenu'
import { MobileTabBar } from './MobileTabBar'
import { ICONE_TOPO, ICONE_TOPO_ATIVO, ICONE_TOPO_IDLE } from './icone-topo'
import { gravarPref, PREF_COOKIES, type SidebarPrefs } from '@/lib/sidebar-prefs'
import { InboxNavItem } from './InboxNavItem'
import { MessagesNavItem } from './MessagesNavItem'
import { CommandPalette, type PaletteTela } from './CommandPalette'

interface Campaign {
  id: string
  name: string
}

interface WorkspaceItem {
  id: string
  name: string
  color: string
  campaigns: Campaign[]
}

interface SidebarProps {
  orgSlug: string
  orgName: string
  userEmail: string
  userAvatar?: string | null
  userName?: string | null
  workspaces: WorkspaceItem[]
  logoUrl?: string | null
  accentColor?: string
  /** Nome do cargo — rótulo do item "Trabalhar" quando houver. */
  positionName?: string | null
  /** Permissão para ver "Liberação de mídias". */
  canMidias?: boolean
  canMidiaHub?: boolean
  /** Permissão para ver "Liberação de Produção". */
  canProducao?: boolean
  /** Permissão para ver/operar o grupo Financeiro. */
  canFinance?: boolean
  /** Permissão para ver Cadastros. */
  canCadastros?: boolean
  /** Permissão para ver o grupo RH (owner/admin ou can_rh). */
  canRh?: boolean
  /** Permissão de gestão (owner) — mostra o item "Gestão". */
  canManage?: boolean
  /** Vê a Lista global (owner/admin/manager). Quem executa usa o Atendimento. */
  canListaGlobal?: boolean
  /** Etapas de onboarding ainda não concluídas — 0 esconde o item. */
  onboardingPendente?: number
  /** Pendências das telas transitórias da Mídia — 0 esconde o item. */
  midiaTransicao?: { migrar: number; vincular: number }
  collapsed: boolean
  onCollapse: () => void
  onExpand?: () => void
  /** Preferências da casca lidas do cookie no servidor (modo, grupos, Espaços). */
  prefs: SidebarPrefs
}

interface NavItem {
  label: string; href: string
  /** Cabeçalho de seção renderizado ANTES deste item (agrupa sem aninhar). */
  heading?: string
  /** Ativo só na rota exata — para hrefs-raiz (ex.: 'rh'), senão startsWith acende em tudo. */
  exact?: boolean
}
interface NavGroupDef { id: string; label: string; icon: LucideIcon; items: NavItem[]; finance?: boolean; rh?: boolean }

// Grupos do módulo comercial/financeiro (SigaSW → One a One).
const COMERCIAL_GROUPS: NavGroupDef[] = [
  { id: 'midia_hub', label: 'Operação', icon: Radio, items: [
    { label: 'Trabalhar',          href: 'midia', exact: true },
    { label: 'Visão geral',        href: 'midia/visao-geral' },
    { label: 'Agenda do mês',      href: 'midia/agenda' },
    { label: 'Clientes e rotinas', href: 'midia/clientes' },
    { label: 'Entregas',           href: 'midia/entregas' },
    // O catálogo de rotinas saiu do menu (é cadastro, não trabalho do dia) e
    // ficou acessível de dentro de "Clientes e rotinas", com o mesmo gate.
    // As duas abaixo são transitórias: somem sozinhas quando a pendência zera
    // (ver pendenciasDeTransicao) — o cabeçalho acompanha a primeira visível.
    { label: 'Migrar rotinas',      href: 'midia/migrar',   heading: 'Transição' },
    { label: 'Vincular entregas',   href: 'midia/vincular', heading: 'Transição' },
  ] },
  { id: 'midias', label: 'Liberação de mídias', icon: Megaphone, items: [
    { label: 'Simplificada', href: 'midias/simplificada' },
    { label: 'Impressa',     href: 'midias/impressa' },
    { label: 'Eletrônica',   href: 'midias/eletronica' },
    { label: 'Externas',     href: 'midias/externas' },
    { label: 'Digitais',     href: 'midias/digitais' },
    // Repetido no grupo de Produção de propósito: o relatório é dos dois, e
    // quem enxerga só um dos grupos precisa achar o item mesmo assim.
    { label: 'Relatório de autorização', href: 'relatorios/autorizacao' },
  ] },
  { id: 'producao', label: 'Liberação de Produção', icon: ClipboardList, items: [
    { label: 'Orçamento',          href: 'producao/orcamento' },
    { label: 'Pedido de produção', href: 'producao/pedido' },
    { label: 'FEE',                href: 'producao/fee' },
    { label: 'Receita de Venda',   href: 'producao/venda' },
    { label: 'Proposta',           href: 'producao/proposta' },
    { label: 'Relatório de autorização', href: 'relatorios/autorizacao' },
  ] },
  { id: 'financeiro', label: 'Financeiro', icon: Wallet, finance: true, items: [
    { label: 'Painel',         href: 'financeiro/painel' },
    { label: 'Fluxo de caixa', href: 'financeiro/fluxo-caixa' },
    { label: 'Análise',        href: 'financeiro/analise' },
    { label: 'Margem por cliente', href: 'financeiro/margem' },
    { label: 'Lançamentos',    href: 'financeiro/lancamentos' },
    { label: 'Inadimplentes',  href: 'financeiro/inadimplentes' },
    { label: 'Faturamento',    href: 'financeiro/faturamento' },
    { label: 'Contas',         href: 'financeiro/contas' },
    { label: 'Fechamento',     href: 'financeiro/fechamento' },
    { label: 'Categorias',     href: 'financeiro/categorias' },
    { label: 'Lixeira',        href: 'financeiro/lixeira' },
  ] },
  { id: 'cadastros', label: 'Cadastros', icon: Users, items: [
    { label: 'Clientes',     href: 'workspaces' },
    { label: 'Solicitações', href: 'solicitacoes' },
    { label: 'Veículos',     href: 'cadastros/veiculos' },
    { label: 'Fornecedores', href: 'cadastros/fornecedores' },
    { label: 'Histórico de docs', href: 'documentos' },
  ] },
  // RH em três blocos (pedido do Rafael, 28/08): Pessoas (gente e ciclo de
  // vida), Ponto (o dia a dia até a contabilidade) e Folha & custos.
  { id: 'rh', label: 'RH', icon: UserCog, rh: true, items: [
    { label: 'Painel',  href: 'rh/painel' },
    { label: 'Pessoas', href: 'rh', exact: true, heading: 'Pessoas' },
    { label: 'Ausências', href: 'rh/ausencias' },
    { label: 'Avaliação', href: 'rh/avaliacao' },
    { label: 'Férias e 13º', href: 'rh/ferias' },
    { label: 'Reajuste', href: 'rh/reajuste' },
    { label: 'Aprovações', href: 'rh/ponto', heading: 'Ponto' },
    { label: 'Espelho', href: 'rh/espelho' },
    { label: 'Fechamento', href: 'rh/fechamento' },
    { label: 'Calendário', href: 'rh/calendario' },
    { label: 'Folha',   href: 'rh/folha', heading: 'Folha e custos' },
    { label: 'Folha × Financeiro', href: 'rh/conferencia' },
    { label: 'Horas',   href: 'rh/horas' },
  ] },
]

function NavGroup({ base, pathname, group, open, onToggle }: {
  base: string; pathname: string; group: NavGroupDef; open: boolean
  /** Ausente = grupo fixo, sem colapsar (modo que tem um grupo só). */
  onToggle?: () => void
}) {
  const Icon = group.icon
  const anyActive = group.items.some(it => pathname.startsWith(`${base}/${it.href}`))
  const cabecalho = cn(
    // no-press: linha de largura total não afunda ao clicar, só muda de cor.
    'no-press flex items-center gap-2.5 mx-2 px-2 py-2 rounded-lg text-sm font-medium transition-colors w-[calc(100%-1rem)]',
    anyActive ? 'text-gray-100' : 'text-gray-400',
  )
  const conteudo = (
    <>
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 text-left truncate">{group.label}</span>
      {onToggle && (
        <ChevronRight className={cn('w-3.5 h-3.5 text-gray-600 shrink-0 transition-transform duration-120 ease-(--ease-out)', open && 'rotate-90')} />
      )}
    </>
  )
  return (
    <div>
      {onToggle ? (
        <button type="button" onClick={onToggle} aria-expanded={open} className={cn(cabecalho, 'hover:text-gray-100 hover:bg-gray-800/60')}>
          {conteudo}
        </button>
      ) : (
        // Grupo fixo (modo de um grupo só) é um título, não um botão desativado:
        // leitor de tela anunciava "esmaecido".
        <div role="heading" aria-level={2} className={cabecalho}>{conteudo}</div>
      )}
      {open && (
        <div className="ml-7 mr-2 mt-px space-y-px">
          {group.items.map(it => {
            const href = `${base}/${it.href}`
            const active = it.exact ? pathname === href : pathname.startsWith(href)
            return (
              <div key={it.href}>
                {it.heading && (
                  <div className="px-2.5 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 select-none">
                    {it.heading}
                  </div>
                )}
                <Link
                  href={href}
                  className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors',
                    active ? 'bg-orange-600/20 text-orange-300' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800/60'
                  )}
                >
                  <span className="truncate">{it.label}</span>
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Atalhos globais: as telas que todo mundo usa, em qualquer modo. Moram numa
 * linha de ícones no cabeçalho, ao lado da busca, para continuarem à mão quando
 * a sidebar está em Mídia/Financeiro/RH (pedido do Rafael, 10/09). "Trabalhar"
 * (views/atendimento) entra aqui também; a Lista global fica no modo Trabalho,
 * porque é só de quem coordena.
 */
const ATALHOS: { id: string; label: string; icon: LucideIcon; href: string }[] = [
  { id: 'trabalhar', label: 'Trabalhar',  icon: Briefcase,  href: 'views/atendimento' },
  { id: 'gantt',     label: 'Gantt',      icon: GanttChart, href: 'views/gantt' },
  { id: 'docs',      label: 'Documentos', icon: BookOpen,   href: 'docs' },
  { id: 'boards',    label: 'Quadros',    icon: PenTool,    href: 'boards' },
]

// Gestão (só o proprietário) entra na mesma linha dos atalhos: é uma view, como
// o Gantt. Antes era um ícone solto na linha do logo, que não cabia.
const GESTAO = { id: 'gestao', label: 'Gestão', icon: Gauge, href: 'views/gestao' }

// Client-only: SSR não sabe o SO. Snapshot do servidor = false ("Ctrl K"), e o
// hydrate re-renderiza com o valor certo — a versão antiga lia `navigator` na
// renderização e, no Mac, ficava presa em "Ctrl K" após o SSR.
const noopSubscribe = () => () => {}
const isMacSnapshot = () => navigator.platform.toUpperCase().includes('MAC')

/**
 * Modos da sidebar. "Operacional" era um guarda-chuva que juntava mídia,
 * produção, cadastros, financeiro e RH — cinco assuntos que não conversam entre
 * si. Conforme RH e Financeiro cresceram (ponto, folha, férias, lançamentos,
 * conciliação), a lista virou uma pilha em que achar as coisas custava rolagem.
 * Agora cada um é um contexto próprio (pedido do Rafael, 05/08).
 */
type SidebarMode = 'trabalho' | 'comercial' | 'midia' | 'rh' | 'financeiro'

/** A que modo cada grupo do menu pertence. */
const GRUPO_MODO: Record<string, SidebarMode> = {
  // Mídia é um contexto só: a operação (Hub) e a liberação de PI/MX moram
  // juntas, porque é a mesma pessoa fazendo as duas coisas.
  midia_hub: 'midia', midias: 'midia',
  producao: 'comercial', cadastros: 'comercial',
  rh: 'rh', financeiro: 'financeiro',
}

// Em que modo cada rota se encaixa (null = neutra, não troca o modo).
function modeForPath(path: string, base: string): SidebarMode | null {
  if (path.startsWith(`${base}/rh`)) return 'rh'
  if (path.startsWith(`${base}/financeiro`)) return 'financeiro'
  // `/midia` (Hub) antes de `/midias` (comercial) seria ambíguo pelo prefixo —
  // os dois caem no mesmo modo, então a ordem aqui não muda o resultado.
  if (path.startsWith(`${base}/midia`)) return 'midia'
  if (['producao', 'cadastros', 'relatorios', 'solicitacoes', 'documentos']
      .some(p => path.startsWith(`${base}/${p}`))) return 'comercial'
  if (['dashboard', 'views/lista'].some(p => path.startsWith(`${base}/${p}`))) return 'trabalho'
  // NEUTRAS de propósito (null = não trocam o modo):
  // - `workspaces`: é "Espaços" no Trabalho e "Clientes" no Comercial. Amarrar
  //   a um modo faria a sidebar pular de contexto no clique.
  // - As telas da linha de atalhos (Trabalhar, Gantt, Documentos, Quadros) e a
  //   Gestão: são globais — quem abre Documentos de dentro do Financeiro
  //   continua no Financeiro, com o ícone aceso no topo.
  return null
}

// Ícones repetem os dos grupos: quem já reconhece a carteira do Financeiro
// reconhece a aba dele.
const MODE_TABS: { m: SidebarMode; Icon: LucideIcon; label: string }[] = [
  { m: 'trabalho',   Icon: SquareKanban, label: 'Trabalho' },
  { m: 'comercial',  Icon: Building2,    label: 'Comercial' },
  { m: 'midia',      Icon: Radio,        label: 'Mídia' },
  { m: 'financeiro', Icon: Wallet,       label: 'Financeiro' },
  { m: 'rh',         Icon: UserCog,      label: 'RH' },
]

export function Sidebar({
  orgSlug, orgName, userEmail, userAvatar, userName, workspaces, logoUrl, accentColor = '#ff6a00', canManage,
  positionName, canMidias = false, canProducao = false, canFinance = false, canCadastros = false, canRh = false,
  canMidiaHub = false,
  canListaGlobal = false,
  onboardingPendente = 0, midiaTransicao = { migrar: 0, vincular: 0 }, collapsed, onCollapse, onExpand, prefs,
}: SidebarProps) {
  const pathname = usePathname()
  const base = `/${orgSlug}`

  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Tooltips dos ícones (.tip): o primeiro espera 300ms; depois de 300ms com o
  // mouse dentro da sidebar, os seguintes abrem na hora (a régua do Emil) — e
  // 500ms depois de sair, volta a esperar.
  const [tipsQuentes, setTipsQuentes] = useState(false)
  const tipsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function aquecerTips() {
    if (tipsTimer.current) clearTimeout(tipsTimer.current)
    tipsTimer.current = setTimeout(() => setTipsQuentes(true), 300)
  }
  function esfriarTips() {
    if (tipsTimer.current) clearTimeout(tipsTimer.current)
    tipsTimer.current = setTimeout(() => setTipsQuentes(false), 500)
  }
  const corpoRef = useRef<HTMLDivElement>(null)

  // Grupos do Operacional: cada seção aparece conforme cargo × toggles (ver
  // computeAccess). Mídias/Produção dependem do cargo; Financeiro do can_finance;
  // Cadastros de can_vendas OU can_finance.
  const groupVisible: Record<string, boolean> = { midia_hub: canMidiaHub, midias: canMidias, producao: canProducao, financeiro: canFinance, cadastros: canCadastros, rh: canRh }
  const TRANSITORIAS: Record<string, number> = { 'midia/migrar': midiaTransicao.migrar, 'midia/vincular': midiaTransicao.vincular }
  const comercialGroups = COMERCIAL_GROUPS.filter(g => groupVisible[g.id]).map(g => {
    if (g.id !== 'midia_hub') return g
    const items = g.items.filter(it => !(it.href in TRANSITORIAS) || TRANSITORIAS[it.href] > 0)
    // Cabeçalho "Transição" só na primeira transitória que sobrou — duas iguais seguidas seria ruído.
    let primeira = true
    return { ...g, items: items.map(it => {
      if (!(it.href in TRANSITORIAS)) return it
      const out = primeira ? it : { ...it, heading: undefined }
      primeira = false
      return out
    }) }
  })
  // Telas dos módulos para o ⌘K, já filtradas por permissão: "Lançamentos" ou
  // "Espelho" viram duas teclas em vez de pílula → grupo → item. O bloco do RH
  // (Pessoas/Ponto/Folha) vira palavra-chave: "ponto" acha o Espelho.
  const GRUPO_PALETTE: Record<string, string> = { midia_hub: 'Mídia' }
  const telasPalette: PaletteTela[] = []
  {
    const vistos = new Set<string>()
    for (const g of comercialGroups) {
      let bloco: string | undefined
      for (const it of g.items) {
        if (it.heading) bloco = it.heading
        if (vistos.has(it.href)) continue   // "Relatório de autorização" está em 2 grupos
        vistos.add(it.href)
        const grupo = GRUPO_PALETTE[g.id] ?? g.label
        telasPalette.push({
          label: it.label, href: it.href, grupo, icon: g.icon,
          keywords: [g.label, grupo, bloco].filter(Boolean).join(' '),
        })
      }
    }
  }
  // Grupos abertos: do cookie (lido no servidor), então a lista já nasce aberta
  // no HTML — o localStorage era lido depois do paint e os grupos "pulavam".
  // O grupo da página atual abre sempre.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const set = new Set(prefs.grupos)
    const active = COMERCIAL_GROUPS.find(g => g.items.some(it => pathname.startsWith(`${base}/${it.href}`)))
    if (active) set.add(active.id)
    return set
  })
  function toggleGroup(id: string) {
    const next = new Set(openGroups)
    if (next.has(id)) next.delete(id); else next.add(id)
    gravarPref(PREF_COOKIES.grupos, [...next].join('|'))
    setOpenGroups(next)
  }

  // Modo da sidebar: "Trabalho" (visões + espaços) × "Operacional" (mídia/produção/
  // financeiro/cadastros) — um contexto por vez p/ reduzir a poluição. O switcher só
  // aparece com permissão; ao navegar, o modo acompanha a página atual.
  const canComercial = canProducao || canCadastros
  const canMidiaModo = canMidiaHub || canMidias
  const canOperacional = canComercial || canMidiaModo || canFinance || canRh
  const modoPermitido: Record<SidebarMode, boolean> = {
    trabalho: true, comercial: canComercial, midia: canMidiaModo, financeiro: canFinance, rh: canRh,
  }
  // Só mostra a aba de quem pode entrar nela: quem não tem RH nunca vê a aba RH.
  const abas = MODE_TABS.filter(a => modoPermitido[a.m])
  const linha2 = canManage ? [...ATALHOS, GESTAO] : ATALHOS

  const [mode, setMode] = useState<SidebarMode>(() => {
    const m = modeForPath(pathname, base)
    if (m && modoPermitido[m]) return m
    // Rota neutra (Docs, Caixa, cliente…): o último modo usado, do cookie —
    // reload no Financeiro não joga mais de volta pro Trabalho.
    const salvo = prefs.modo as SidebarMode | null
    return salvo && salvo in modoPermitido && modoPermitido[salvo] ? salvo : 'trabalho'
  })
  function mudarModo(m: SidebarMode) {
    setMode(m)
    gravarPref(PREF_COOKIES.modo, m)
  }
  useEffect(() => {
    const m = modeForPath(pathname, base)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (m && m !== mode && modoPermitido[m]) mudarModo(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Depois do `mode`, nunca antes: `.filter` executa na renderização e ler
  // `mode` acima da declaração derruba a tela inteira com "Cannot access before
  // initialization". O TypeScript não acusa porque o uso está dentro de um
  // callback — só aparece em runtime, e em produção já minificado.
  const gruposDoModo = comercialGroups.filter(g => GRUPO_MODO[g.id] === mode)

  // Trocar de modo troca a lista inteira (sem animação: é frequente). O que não
  // pode é herdar a rolagem do modo anterior e cair com a lista fora da tela.
  useEffect(() => { corpoRef.current?.scrollTo({ top: 0 }) }, [mode])

  const isMac = useSyncExternalStore(noopSubscribe, isMacSnapshot, () => false)
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl K'

  // Atalho global ⌘K / Ctrl+K para a busca.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const activeWorkspaceId = workspaces.find(ws =>
    pathname.includes(`/workspaces/${ws.id}`)
  )?.id

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(activeWorkspaceId ? [activeWorkspaceId] : [])
  )

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (activeWorkspaceId) {
      setExpanded(prev => new Set([...prev, activeWorkspaceId]))
    }
  }, [activeWorkspaceId])

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function expandAll() {
    setExpanded(new Set(workspaces.map(ws => ws.id)))
  }

  function collapseAll() {
    setExpanded(new Set())
  }

  const allExpanded = workspaces.length > 0 && workspaces.every(ws => expanded.has(ws.id))

  // Seção "Espaços" recolhida por padrão (o acesso por cliente é usado menos);
  // lembra a escolha (cookie, já no HTML) e abre sozinha ao entrar num cliente.
  const [espacosOpen, setEspacosOpen] = useState(() => prefs.espacos ?? !!activeWorkspaceId)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeWorkspaceId) setEspacosOpen(true)
  }, [activeWorkspaceId])
  function toggleEspacos() {
    const next = !espacosOpen
    gravarPref(PREF_COOKIES.espacos, next ? '1' : '0')
    setEspacosOpen(next)
  }

  const sidebarContent = (
    <aside
      className={cn(
        'sidebar-shell w-60 bg-gray-900 flex flex-col h-full select-none pt-[env(safe-area-inset-top,0px)] md:pt-0',
        tipsQuentes && 'tips-quentes'
      )}
      onMouseEnter={aquecerTips}
      onMouseLeave={esfriarTips}
    >

      {/* ── Cabeçalho: logo + modos; embaixo, busca + atalhos globais ──────────
          Duas linhas de ícones sem rótulo: o nome mora no tooltip próprio (.tip)
          e no aria-label. Dois "acesos" com significados diferentes: o chip
          preenchido é o MODO ligado; o sublinhado no accent é a PÁGINA atual.
          Recolher/fechar saiu daqui pro rodapé: com 5 modos + Gestão + recolher
          a linha 1 somava 256px em 216px úteis e o botão vazava pra fora. */}
      <div className="px-3 pt-4 pb-2 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Link
            href={`${base}/dashboard`}
            aria-label={orgName}
            data-tip={orgName}
            data-tip-side="left"
            className="tip press relative shrink-0 rounded-lg p-1 hover:bg-gray-800"
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={orgName} className="w-7 h-7 rounded-md object-contain bg-white" />
            ) : (
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: accentColor }}>
                <span className="text-white text-[11px] font-bold">{orgName.charAt(0).toUpperCase()}</span>
              </div>
            )}
          </Link>

          {/* Modo — só com permissão a mais de um. Chips de 28px: com 5 modos a
              pílula tem 152px e cabe ao lado do logo. */}
          {canOperacional && abas.length > 1 && (
            <div className="flex items-center gap-0.5 bg-gray-800/60 rounded-lg p-0.5">
              {abas.map(({ m, Icon, label }) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => mudarModo(m)}
                  aria-pressed={mode === m}
                  aria-label={label}
                  data-tip={label}
                  className={cn(
                    'tip press relative p-1.5 rounded-md',
                    mode === m ? 'bg-gray-700 text-orange-400' : 'text-gray-500 hover:text-gray-200'
                  )}
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Busca (⌘K) + atalhos globais (+ Gestão): iguais em todos os modos.
            -mx-0.5 alinha o desenho dos ícones aos itens do menu (16px da borda). */}
        <div className="mt-2 -mx-0.5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Buscar"
            aria-keyshortcuts="Control+K Meta+K"
            data-tip={`Buscar (${shortcutLabel})`}
            data-tip-side="left"
            className={cn(ICONE_TOPO, ICONE_TOPO_IDLE)}
          >
            <Search className="w-4 h-4" />
          </button>
          <InboxNavItem orgSlug={orgSlug} compact />
          {linha2.map(({ id, label, icon: Icon, href }, i) => {
            // "Trabalhar" mostra o cargo da pessoa, como o item antigo fazia.
            const titulo = id === 'trabalhar' && positionName ? `${label} · ${positionName}` : label
            const ativo = pathname.startsWith(`${base}/${href}`)
            return (
              <Link
                key={id}
                href={`${base}/${href}`}
                aria-label={titulo}
                aria-current={ativo ? 'page' : undefined}
                data-tip={titulo}
                // Os dois últimos alinham o tooltip à direita pra não vazar da sidebar.
                data-tip-side={i >= linha2.length - 2 ? 'right' : undefined}
                className={cn(ICONE_TOPO, ativo ? ICONE_TOPO_ATIVO : ICONE_TOPO_IDLE)}
              >
                <Icon className="w-4 h-4" />
              </Link>
            )
          })}
        </div>
      </div>

      {/* ── Scrollable body ──────────────────────────── */}
      <div ref={corpoRef} className="flex-1 overflow-y-auto scrollbar-thin [scrollbar-gutter:stable] py-3 space-y-1">

        {/* Mensagens — abre o chat (dock no canto inferior direito) */}
        <MessagesNavItem />

        {/* ── Modo Trabalho: Lista global (só quem coordena) + Espaços ── */}
        {mode === 'trabalho' && canListaGlobal && (
          <>
            <Link
              href={`${base}/views/lista`}
              className={cn(
                'flex items-center gap-2.5 mx-2 px-2 py-2 rounded-lg text-sm font-medium transition-colors',
                pathname.startsWith(`${base}/views/lista`)
                  ? 'bg-gray-800 text-gray-100'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
              )}
            >
              <List className="w-4 h-4 shrink-0" />
              <span className="flex-1">Lista</span>
            </Link>
            <div className="mx-3 my-2 border-t border-gray-800" />
          </>
        )}

        {/* ── Modos Comercial / Financeiro / RH ── */}
        {mode !== 'trabalho' && gruposDoModo.length > 0 && (
          <div className="mt-1">
            {gruposDoModo.map(g => (
              <NavGroup
                key={g.id}
                base={base}
                pathname={pathname}
                group={g}
                // Modo com um grupo só (RH, Financeiro) nasce aberto: esconder a
                // única lista atrás de um clique não economiza nada.
                open={gruposDoModo.length === 1 ? true : openGroups.has(g.id)}
                onToggle={gruposDoModo.length === 1 ? undefined : () => toggleGroup(g.id)}
              />
            ))}
          </div>
        )}

        {/* ── Modo Trabalho: Espaços (clientes + campanhas) ── */}
        {mode === 'trabalho' && (
        <div>
          <div className="flex items-center justify-between px-4 mb-1.5">
            <button onClick={toggleEspacos} aria-expanded={espacosOpen} className="no-press flex items-center gap-1 group/esp">
              <ChevronRight className={cn('w-3 h-3 text-gray-600 transition-transform duration-150', espacosOpen && 'rotate-90')} />
              <span className="text-[11px] font-semibold text-gray-500 group-hover/esp:text-gray-400 uppercase tracking-[0.08em] transition-colors">
                Espaços
              </span>
              {!espacosOpen && workspaces.length > 0 && (
                <span className="text-[10px] text-gray-600">{workspaces.length}</span>
              )}
            </button>
            <div className="flex items-center gap-1">
              {espacosOpen && (allExpanded ? (
                <button onClick={collapseAll} className="text-gray-600 hover:text-gray-300 transition-colors" title="Fechar todos">
                  <ChevronsUp className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button onClick={expandAll} className="text-gray-600 hover:text-gray-300 transition-colors" title="Expandir todos">
                  <ChevronsDown className="w-3.5 h-3.5" />
                </button>
              ))}
              <Link href={`${base}/workspaces/new`} className="text-gray-600 hover:text-gray-300 transition-colors" title="Novo cliente">
                <Plus className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {espacosOpen && (
          <div className="space-y-px">
            {workspaces.map(ws => {
              const isOpen = expanded.has(ws.id)
              const isWsActive = pathname.includes(`/workspaces/${ws.id}`)

              return (
                <div key={ws.id}>
                  <div className="group flex items-center px-2">
                    <button
                      onClick={() => toggle(ws.id)}
                      aria-label={`${isOpen ? 'Recolher' : 'Expandir'} ${ws.name}`}
                      aria-expanded={isOpen}
                      className="p-1.5 rounded text-gray-600 hover:text-gray-300 transition-colors shrink-0"
                    >
                      <ChevronRight className={cn('w-3 h-3 transition-transform duration-150', isOpen && 'rotate-90')} />
                    </button>
                    <Link
                      href={`${base}/workspaces/${ws.id}`}
                      onClick={() => !isOpen && toggle(ws.id)}
                      className={cn(
                        'flex items-center gap-1.5 flex-1 min-w-0 px-1.5 py-1.5 rounded-lg text-sm font-medium transition-colors',
                        isWsActive && !pathname.includes('/campaigns/')
                          ? 'bg-gray-800/60 text-gray-100'
                          : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
                      )}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ws.color || '#f97316' }} />
                      <span className="truncate">{ws.name}</span>
                    </Link>
                    <Link
                      href={`${base}/workspaces/${ws.id}/campaigns/new`}
                      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 p-1 rounded text-gray-600 hover:text-gray-300 transition-opacity duration-120"
                      title="Nova campanha"
                    >
                      <Plus className="w-3 h-3" />
                    </Link>
                  </div>

                  {isOpen && (
                    <div className="ml-7 mr-2 mt-px space-y-px">
                      {ws.campaigns.map(camp => {
                        const href = `${base}/workspaces/${ws.id}/campaigns/${camp.id}`
                        const isActive = pathname.startsWith(href)
                        return (
                          <Link
                            key={camp.id}
                            href={href}
                            className={cn(
                              'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors',
                              isActive
                                ? 'bg-orange-600/20 text-orange-300'
                                : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800/60'
                            )}
                          >
                            <AlignLeft className="w-3 h-3 shrink-0 opacity-60" />
                            <span className="truncate">{camp.name}</span>
                          </Link>
                        )
                      })}
                      {ws.campaigns.length === 0 && (
                        <Link
                          href={`${base}/workspaces/${ws.id}/campaigns/new`}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors rounded-lg"
                        >
                          <Plus className="w-3 h-3" />
                          Nova campanha
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {workspaces.length === 0 && (
              <Link
                href={`${base}/workspaces/new`}
                className="flex items-center gap-1.5 mx-4 px-2 py-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors rounded-lg"
              >
                <Plus className="w-3 h-3" />
                Novo cliente
              </Link>
            )}
          </div>
          )}
        </div>
        )}

      </div>

      {/* ── Bottom ───────────────────────────────────── */}
      <div className="border-t border-gray-800">
        {/* Primeiros passos: some sozinho quando a trilha termina (ou não existe). */}
        {onboardingPendente > 0 && (
          <Link
            href={`${base}/onboarding`}
            className={cn(
              'flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors',
              pathname.startsWith(`${base}/onboarding`) ? 'text-white' : 'text-gray-500 hover:text-gray-200'
            )}
          >
            <Compass className="w-4 h-4 shrink-0" />
            Primeiros passos
            <span className="ml-auto text-[10px] font-semibold text-orange-400 bg-orange-500/15 rounded-full px-1.5 py-0.5 tabular-nums">
              {onboardingPendente}
            </span>
          </Link>
        )}
        {/* Usuário: avatar + nome abrem o menu (perfil, ponto, avaliação,
            configurações, tema, sair). Ao lado, o único botão de esconder o
            menu: recolher no desktop, fechar no celular (onde o polegar alcança). */}
        <div className="flex items-center gap-1 px-3 py-2.5 border-t border-gray-800">
          <UserMenu base={base} nome={userName} email={userEmail} avatarUrl={userAvatar} canManage={canManage} />
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Ocultar menu"
            data-tip="Ocultar menu"
            data-tip-pos="top"
            data-tip-side="right"
            className={cn('hidden md:flex shrink-0', ICONE_TOPO, ICONE_TOPO_IDLE)}
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
            className={cn('md:hidden shrink-0', ICONE_TOPO, ICONE_TOPO_IDLE)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  )

  return (
    <>
      {/* Celular: barra inferior no lugar do hambúrguer (Menu abre o drawer). */}
      <MobileTabBar orgSlug={orgSlug} onMenu={() => setMobileOpen(true)} onSearch={() => setPaletteOpen(true)} />

      {/* Expandir — desktop, quando a sidebar está recolhida (substitui o botão do topo) */}
      {collapsed && onExpand && (
        <button
          onClick={onExpand}
          className="hidden md:flex fixed top-3 left-3 z-50 bg-gray-900 text-gray-300 rounded-lg p-2 shadow-lg hover:text-white transition-[opacity,color] duration-150 ease-(--ease-out) starting:opacity-0"
          title="Mostrar menu"
          aria-label="Mostrar menu"
        >
          <PanelLeft className="w-5 h-5" />
        </button>
      )}

      {/* Backdrop — mobile only. Sempre montado: some em fade junto com o painel,
          em vez de sumir a 0ms enquanto o painel ainda desliza (parecia lag). */}
      <div
        aria-hidden
        className={cn(
          'fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-200 ease-(--ease-out)',
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={() => setMobileOpen(false)}
      />

      {/* Sidebar wrapper — drawer on mobile, static on desktop */}
      <div className={cn(
        'fixed inset-y-0 left-0 z-50 md:static md:z-auto',
        'shrink-0 h-full flex',
        // Abre em 240ms (ease-out forte) e fecha mais rápido, em 180ms (ease-in):
        // a saída nunca é mais longa que a entrada.
        'transition-transform md:transition-none',
        mobileOpen
          ? 'translate-x-0 duration-240 ease-(--ease-out)'
          : '-translate-x-full md:translate-x-0 duration-180 ease-in',
        collapsed && 'md:w-0 md:overflow-hidden'
      )}>
        {sidebarContent}
      </div>

      {/* Busca rápida (⌘K / item "Buscar") */}
      <CommandPalette
        orgSlug={orgSlug}
        workspaces={workspaces}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        canManage={canManage}
        canListaGlobal={canListaGlobal}
        positionName={positionName}
        telas={telasPalette}
      />
    </>
  )
}
