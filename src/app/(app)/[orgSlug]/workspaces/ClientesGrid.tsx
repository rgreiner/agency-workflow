'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { FolderOpen, Search, Mail, Globe, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AvatarGroup } from '@/components/ui/Avatar'
import { CopyButton } from '@/components/ui/CopyButton'
import { WhatsAppIcon } from '@/components/ui/WhatsAppIcon'
import { UnarchiveButton } from '@/components/ui/UnarchiveButton'
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

export function ClientesGrid({ orgSlug, clientes, arquivados }: { orgSlug: string; clientes: ClienteCard[]; arquivados: boolean }) {
  const [busca, setBusca] = useState('')
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return clientes
    const qd = somenteDigitos(q)
    return clientes.filter(c =>
      c.nome.toLowerCase().includes(q) ||
      (c.razao ?? '').toLowerCase().includes(q) ||
      (c.cidade ?? '').toLowerCase().includes(q) ||
      (qd.length >= 3 && somenteDigitos(c.cnpj ?? '').includes(qd)))
  }, [busca, clientes])

  return (
    <>
      {clientes.length > 6 && (
        <div className="relative mb-4 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, CNPJ ou cidade"
            className="w-full pl-9 pr-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
      )}

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
