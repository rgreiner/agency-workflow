'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { FolderOpen, Search, Mail, Globe, AlertTriangle, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AvatarGroup } from '@/components/ui/Avatar'
import { CopyButton } from '@/components/ui/CopyButton'
import { WhatsAppIcon } from '@/components/ui/WhatsAppIcon'
import { UnarchiveButton } from '@/components/ui/UnarchiveButton'
import { Select } from '@/components/ui/Select'
import { fmtCpfCnpj, somenteDigitos } from '@/lib/telefone'

export interface Contato { rotulo: string; valor: string; href: string }

export interface ClienteCard {
  id: string
  nome: string
  razao: string | null
  cnpj: string | null
  cidade: string | null
  cor: string
  contatoNome: string | null
  whats: Contato[]
  emails: Contato[]
  campanhas: number
  abertas: number
  atrasadas: number
  comCliente: number
  /** Dias desde a última movimentação de tarefa (calculado no servidor); null = nenhuma. */
  diasParado: number | null
  portal: { acessos: number; ultimoLogin: string | null }
  /** A receber em aberto relativo ao cliente; null = quem vê não tem acesso ao Financeiro. */
  financeiro: { aReceber: number; vencido: number; doCliente: number; qtd: number } | null
  equipe: { full_name: string | null; avatar_url: string | null }[]
}

function haQuanto(d: number | null): string {
  if (d === null) return 'sem movimento'
  if (d <= 0) return 'mexido hoje'
  if (d === 1) return 'mexido ontem'
  if (d < 30) return `mexido há ${d} dias`
  const m = Math.floor(d / 30)
  return `parado há ${m} ${m === 1 ? 'mês' : 'meses'}`
}

/**
 * Botão de contato: com um só, abre direto; com vários, lista com o rótulo de
 * cada (o cadastro guarda "Financeiro", "Marketing"…). Popover escala a partir
 * do botão e fecha no clique fora (mousedown).
 */
function BotaoContato({ tipo, itens }: { tipo: 'whats' | 'email'; itens: Contato[] }) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAberto(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  const Icone = tipo === 'whats'
    ? <WhatsAppIcon className="w-4 h-4" />
    : <Mail className="w-4 h-4" />
  const cls = cn('p-1.5 rounded-lg transition-colors active:scale-[0.97]',
    tipo === 'whats' ? 'text-gray-400 hover:text-green-600 hover:bg-green-500/10' : 'text-gray-400 hover:text-orange-600 hover:bg-orange-500/10')
  const titulo = tipo === 'whats' ? 'Conversar no WhatsApp' : 'Enviar e-mail'

  if (itens.length === 0) return null
  if (itens.length === 1) {
    const c = itens[0]
    return (
      <a href={c.href} target={tipo === 'whats' ? '_blank' : undefined} rel="noopener"
        title={`${titulo}: ${c.rotulo} · ${c.valor}`} className={cls}>
        {Icone}
      </a>
    )
  }
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setAberto(v => !v)} title={titulo} className={cls}>{Icone}</button>
      {aberto && (
        <div className="absolute right-0 top-full mt-1 z-20 w-64 origin-top-right rounded-xl border border-gray-200 bg-white shadow-lg p-1 pop-in">
          {itens.map(c => (
            <a key={c.href} href={c.href} target={tipo === 'whats' ? '_blank' : undefined} rel="noopener"
              onClick={() => setAberto(false)}
              className="block rounded-lg px-3 py-2 hover:bg-gray-100 transition-colors">
              <span className="block text-xs text-gray-500 truncate">{c.rotulo}</span>
              <span className="block text-sm text-gray-900 truncate">{c.valor}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function Numero({ valor, rotulo, alerta = false }: { valor: number; rotulo: string; alerta?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={cn('text-lg font-semibold tabular-nums leading-none',
        alerta && valor > 0 ? 'text-orange-600' : valor > 0 ? 'text-gray-900' : 'text-gray-300')}>
        {valor}
      </p>
      <p className="text-[11px] text-gray-500 mt-1 truncate">{rotulo}</p>
    </div>
  )
}

type Ordem = 'nome' | 'atrasadas' | 'cliente' | 'abertas' | 'parados' | 'recentes' | 'receber' | 'vencido'

const ORDENS: { value: Ordem; label: string }[] = [
  { value: 'nome', label: 'Nome (A–Z)' },
  { value: 'atrasadas', label: 'Mais atrasadas' },
  { value: 'cliente', label: 'Mais com o cliente' },
  { value: 'abertas', label: 'Mais em aberto' },
  { value: 'parados', label: 'Parados há mais tempo' },
  { value: 'recentes', label: 'Mexidos mais recentemente' },
]
/** Só aparecem para quem tem acesso ao Financeiro. */
const ORDENS_FIN: { value: Ordem; label: string }[] = [
  { value: 'receber', label: 'Mais a receber' },
  { value: 'vencido', label: 'Mais vencido a receber' },
]

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** Preferência por pessoa (localStorage). Versionar a chave se os padrões mudarem. */
const CHAVE_ORDEM = 'clientes-ordem-v1'

/** Comparador por critério; empate cai no nome, para a ordem nunca "pular". */
function comparar(ordem: Ordem) {
  const nome = (a: ClienteCard, b: ClienteCard) => a.nome.localeCompare(b.nome, 'pt-BR')
  // Sem movimento nenhum conta como o mais parado de todos.
  const parado = (c: ClienteCard) => c.diasParado ?? Number.MAX_SAFE_INTEGER
  switch (ordem) {
    case 'atrasadas': return (a: ClienteCard, b: ClienteCard) => b.atrasadas - a.atrasadas || b.abertas - a.abertas || nome(a, b)
    case 'cliente':   return (a: ClienteCard, b: ClienteCard) => b.comCliente - a.comCliente || nome(a, b)
    case 'abertas':   return (a: ClienteCard, b: ClienteCard) => b.abertas - a.abertas || nome(a, b)
    case 'parados':   return (a: ClienteCard, b: ClienteCard) => parado(b) - parado(a) || nome(a, b)
    case 'recentes':  return (a: ClienteCard, b: ClienteCard) => parado(a) - parado(b) || nome(a, b)
    case 'receber':   return (a: ClienteCard, b: ClienteCard) => (b.financeiro?.aReceber ?? 0) - (a.financeiro?.aReceber ?? 0) || nome(a, b)
    case 'vencido':   return (a: ClienteCard, b: ClienteCard) => (b.financeiro?.vencido ?? 0) - (a.financeiro?.vencido ?? 0) || (b.financeiro?.aReceber ?? 0) - (a.financeiro?.aReceber ?? 0) || nome(a, b)
    default:          return nome
  }
}

export function ClientesGrid({ orgSlug, clientes, arquivados, verFinanceiro = false }: {
  orgSlug: string; clientes: ClienteCard[]; arquivados: boolean; verFinanceiro?: boolean
}) {
  const ordens = verFinanceiro ? [...ORDENS, ...ORDENS_FIN] : ORDENS
  const [busca, setBusca] = useState('')
  const [ordem, setOrdemState] = useState<Ordem>('nome')

  // Lê a escolha salva depois de montar (no servidor não há localStorage).
  useEffect(() => {
    try {
      const salva = localStorage.getItem(CHAVE_ORDEM) as Ordem | null
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (salva && ordens.some(o => o.value === salva)) setOrdemState(salva)
    } catch { /* sem storage: fica no padrão */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function setOrdem(v: string) {
    setOrdemState(v as Ordem)
    try { localStorage.setItem(CHAVE_ORDEM, v) } catch { /* ignora */ }
  }

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const qd = somenteDigitos(q)
    const base = !q ? clientes : clientes.filter(c =>
      c.nome.toLowerCase().includes(q) ||
      (c.razao ?? '').toLowerCase().includes(q) ||
      (c.cidade ?? '').toLowerCase().includes(q) ||
      (qd.length >= 3 && somenteDigitos(c.cnpj ?? '').includes(qd)))
    return [...base].sort(comparar(ordem))
  }, [busca, clientes, ordem])

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, CNPJ ou cidade"
            className="w-full pl-9 pr-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <div className="sm:ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-500 shrink-0">Ordenar por</span>
          <div className="w-56">
            <Select value={ordem} onChange={setOrdem} options={ordens} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtrados.map(c => {
          const href = `/${orgSlug}/workspaces/${c.id}`
          const cnpj = c.cnpj ? fmtCpfCnpj(c.cnpj) : null
          return (
            <div key={c.id} className="bg-white rounded-2xl border border-gray-200 p-5 hover:border-orange-300 hover:shadow-sm transition-colors group flex flex-col">
              {/* Identificação + contato */}
              <div className="flex items-start gap-3">
                <Link href={href} className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: c.cor + '20' }}>
                  <FolderOpen className="w-5 h-5" style={{ color: c.cor }} />
                </Link>
                <Link href={href} className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 group-hover:text-orange-600 transition-colors truncate">{c.nome}</h3>
                  <p className="text-xs text-gray-500 truncate">
                    {[c.razao && c.razao.toLowerCase() !== c.nome.toLowerCase() ? c.razao : null, c.cidade].filter(Boolean).join(' · ') || ' '}
                  </p>
                </Link>
                <div className="flex items-center -mr-1.5 -mt-1">
                  <BotaoContato tipo="whats" itens={c.whats} />
                  <BotaoContato tipo="email" itens={c.emails} />
                </div>
              </div>

              {/* CNPJ (clique copia) */}
              <div className="mt-2.5 h-6 flex items-center gap-1 text-xs text-gray-500">
                {cnpj ? (
                  <>
                    <span className="tabular-nums">CNPJ {cnpj}</span>
                    <CopyButton text={somenteDigitos(c.cnpj!)} label="Copiar CNPJ" />
                  </>
                ) : (
                  <span className="text-gray-400">Sem CNPJ no cadastro</span>
                )}
                {c.contatoNome && <span className="ml-auto truncate">Contato: {c.contatoNome}</span>}
              </div>

              {/* Números */}
              <Link href={href} className="mt-3 grid grid-cols-4 gap-2 rounded-xl bg-gray-50 px-3 py-2.5 hover:bg-gray-100 transition-colors">
                <Numero valor={c.abertas} rotulo="Em aberto" />
                <Numero valor={c.atrasadas} rotulo="Atrasadas" alerta />
                <Numero valor={c.comCliente} rotulo="Com o cliente" />
                <Numero valor={c.campanhas} rotulo={c.campanhas === 1 ? 'Campanha' : 'Campanhas'} />
              </Link>

              {/* A receber (só Financeiro): total relativo ao cliente + o que já venceu */}
              {c.financeiro && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <Wallet className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  {c.financeiro.aReceber > 0 ? (
                    <>
                      <Link href={`/${orgSlug}/financeiro/lancamentos?ver=a-receber&cliente=${c.id}`}
                        title={`${c.financeiro.qtd} lançamento(s) em aberto · ${brl(c.financeiro.doCliente)} pagos pelo próprio cliente; o resto é comissão paga por veículo ou fornecedor`}
                        className="text-gray-700 hover:text-orange-600 transition-colors">
                        A receber <b className="tabular-nums">{brl(c.financeiro.aReceber)}</b>
                      </Link>
                      {c.financeiro.vencido > 0 && (
                        <Link href={`/${orgSlug}/financeiro/inadimplentes`}
                          className="ml-auto inline-flex items-center gap-1 font-medium text-orange-600 hover:text-orange-700 transition-colors">
                          <AlertTriangle className="w-3 h-3" /> vencido {brl(c.financeiro.vencido)}
                        </Link>
                      )}
                    </>
                  ) : (
                    <span className="text-gray-400">Nada a receber em aberto</span>
                  )}
                </div>
              )}

              {/* Rodapé: equipe, portal, movimento */}
              <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                {c.equipe.length > 0 && <AvatarGroup users={c.equipe} max={3} />}
                <span
                  title={c.portal.acessos
                    ? `${c.portal.acessos} acesso(s) ao portal${c.portal.ultimoLogin ? ` · último ${new Date(c.portal.ultimoLogin).toLocaleDateString('pt-BR')}` : ' · ninguém entrou ainda'}`
                    : 'Cliente sem acesso ao portal'}
                  className={cn('inline-flex items-center gap-1', c.portal.acessos ? 'text-green-600' : 'text-gray-400')}>
                  <Globe className="w-3.5 h-3.5" />
                  {c.portal.acessos ? `Portal · ${c.portal.acessos}` : 'Sem portal'}
                </span>
                {(() => {
                  // Mais de 30 dias sem mexer em tarefa: cliente esfriando.
                  const frio = !arquivados && c.diasParado !== null && c.diasParado > 30
                  return (
                    <span className={cn('ml-auto inline-flex items-center gap-1', frio && 'text-orange-600')}>
                      {frio && <AlertTriangle className="w-3 h-3" />}
                      {haQuanto(c.diasParado)}
                    </span>
                  )
                })()}
              </div>

              {arquivados && (
                <div className="mt-4 flex justify-end">
                  <UnarchiveButton orgSlug={orgSlug} workspaceId={c.id} />
                </div>
              )}
            </div>
          )
        })}
      </div>
      {filtrados.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-12">Nenhum cliente com &quot;{busca}&quot;</p>
      )}
    </>
  )
}
