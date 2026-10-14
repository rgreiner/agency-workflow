import { createClient } from '@/lib/supabase/server'
import { getAccess } from '@/lib/auth/access'
import Link from 'next/link'
import { Plus, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ClientesGrid, type ClienteCard, type Contato } from './ClientesGrid'
import { fmtTelefone, linkWhatsApp, somenteDigitos } from '@/lib/telefone'

const COM_O_CLIENTE = new Set(['pendente_cliente', 'aprovacao_cliente'])

/** Hoje no fuso de Brasília (YYYY-MM-DD) — "atrasada" é prazo antes de hoje. */
function hojeBR(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

/** Dias inteiros desde um instante (para "mexido há X dias"). */
function diasDesde(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000))
}

/**
 * Telefones e e-mails do cadastro (blocos com rótulo + os campos antigos), sem
 * repetir o mesmo número/endereço. O WhatsApp só entra se o número tiver DDD.
 */
function contatosDe(ws: Record<string, unknown>): { whats: Contato[]; emails: Contato[] } {
  const tels = [
    ...((ws.telefones as { tipo?: string; numero?: string }[] | null) ?? []),
    ...(ws.phone ? [{ tipo: (ws.contact_name as string) || 'Telefone', numero: ws.phone as string }] : []),
  ]
  const whats: Contato[] = []
  const vistosT = new Set<string>()
  for (const t of tels) {
    const link = t.numero ? linkWhatsApp(t.numero) : null
    const chave = somenteDigitos(t.numero ?? '').slice(-9)
    if (!link || vistosT.has(chave)) continue
    vistosT.add(chave)
    whats.push({ rotulo: (t.tipo || 'Telefone').trim(), valor: fmtTelefone(t.numero!), href: link })
  }
  const mails = [
    ...((ws.emails as { tipo?: string; email?: string }[] | null) ?? []),
    ...(ws.finance_email ? [{ tipo: 'Financeiro', email: ws.finance_email as string }] : []),
  ]
  const emails: Contato[] = []
  const vistosE = new Set<string>()
  for (const e of mails) {
    const em = (e.email ?? '').trim().toLowerCase()
    if (!em.includes('@') || vistosE.has(em)) continue
    vistosE.add(em)
    emails.push({ rotulo: (e.tipo || 'E-mail').trim(), valor: em, href: `mailto:${em}` })
  }
  return { whats, emails }
}

export default async function WorkspacesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { orgSlug } = await params
  const { view } = await searchParams
  const archivedView = view === 'arquivados'
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: org } = await supabase
    .from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  const { data: workspaces } = await sb
    .from('workspaces')
    .select('id, name, description, color, legal_name, tax_id, address_city, address_state, phone, finance_email, contact_name, telefones, emails, equipe')
    .eq('org_id', org.id)
    .eq('archived', archivedView)
    .order('name', { ascending: true })
  const lista = (workspaces ?? []) as Record<string, unknown>[]
  const ids = lista.map(w => w.id as string)

  // Números do card: campanhas, tarefas abertas/atrasadas/com o cliente, última
  // movimentação e quem tem acesso ao portal. Tudo pela RLS do membro.
  const equipeIds = [...new Set(lista.flatMap(w => (w.equipe as string[] | null) ?? []))]
  const [{ data: camps }, { data: acts }, { data: portal }, { data: perfis }] = ids.length ? await Promise.all([
    sb.from('campaigns').select('id, workspace_id, archived').in('workspace_id', ids),
    sb.from('activities')
      .select('status, due_date, updated_at, campaigns!inner(workspace_id, archived)')
      .eq('archived', false).eq('campaigns.archived', false).in('campaigns.workspace_id', ids)
      .limit(5000),
    sb.from('portal_users').select('workspace_id, last_login_at')
      .in('workspace_id', ids).eq('ativo', true).is('interno_user_id', null),
    equipeIds.length
      ? sb.from('profiles').select('id, full_name, avatar_url').in('id', equipeIds)
      : Promise.resolve({ data: [] }),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]

  const hoje = hojeBR()

  // A receber em aberto (14/10): só para quem tem acesso ao Financeiro — e a RLS
  // de lancamentos (fin_can) barraria de qualquer jeito. Vale o lançamento
  // RELATIVO ao cliente (workspace_id): fee e produção pagos por ele + comissão de
  // mídia paga pelo veículo. Baixa parcial desconta o já recebido.
  const acesso = await getAccess(orgSlug)
  const verFinanceiro = !!acesso?.access.financeiro && ids.length > 0
  const { data: lancs } = verFinanceiro
    ? await sb.from('lancamentos')
        .select('workspace_id, valor, valor_realizado, vencimento, contato_tipo, contato_id')
        .eq('org_id', org.id).eq('tipo', 'entrada').eq('situacao', 'em_aberto')
        .in('workspace_id', ids).limit(5000)
    : { data: [] }
  const receber = new Map<string, { aReceber: number; vencido: number; doCliente: number; qtd: number }>()
  for (const l of (lancs ?? []) as { workspace_id: string; valor: number; valor_realizado: number | null; vencimento: string | null; contato_tipo: string | null; contato_id: string | null }[]) {
    const saldo = Math.max(0, Number(l.valor ?? 0) - Number(l.valor_realizado ?? 0))
    if (saldo <= 0) continue
    const r = receber.get(l.workspace_id) ?? { aReceber: 0, vencido: 0, doCliente: 0, qtd: 0 }
    r.aReceber += saldo
    r.qtd += 1
    if (l.vencimento && l.vencimento < hoje) r.vencido += saldo
    if (l.contato_tipo === 'cliente' && l.contato_id === l.workspace_id) r.doCliente += saldo
    receber.set(l.workspace_id, r)
  }
  const perfil = new Map(((perfis ?? []) as { id: string; full_name: string | null; avatar_url: string | null }[]).map(p => [p.id, p]))

  const cards: ClienteCard[] = lista.map(ws => {
    const id = ws.id as string
    const minhas = ((acts ?? []) as { status: string; due_date: string | null; updated_at: string; campaigns: { workspace_id: string } }[])
      .filter(a => a.campaigns.workspace_id === id)
    const abertas = minhas.filter(a => a.status !== 'concluido')
    const acessos = ((portal ?? []) as { workspace_id: string; last_login_at: string | null }[]).filter(p => p.workspace_id === id)
    const ultimoLogin = acessos.map(p => p.last_login_at).filter(Boolean).sort().at(-1) ?? null
    const { whats, emails } = contatosDe(ws)
    return {
      id,
      nome: ws.name as string,
      razao: (ws.legal_name as string) || null,
      cnpj: (ws.tax_id as string) || null,
      cidade: [ws.address_city, ws.address_state].filter(Boolean).map(s => String(s).trim())
        .map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s.toUpperCase())).join('/') || null,
      cor: (ws.color as string) || '#9ca3af',
      contatoNome: (ws.contact_name as string) || null,
      whats, emails,
      campanhas: ((camps ?? []) as { workspace_id: string; archived: boolean }[]).filter(c => c.workspace_id === id && !c.archived).length,
      abertas: abertas.length,
      atrasadas: abertas.filter(a => a.due_date && a.due_date < hoje).length,
      comCliente: abertas.filter(a => COM_O_CLIENTE.has(a.status)).length,
      diasParado: (() => {
        const ult = minhas.map(a => a.updated_at).sort().at(-1)
        return ult ? diasDesde(ult) : null
      })(),
      portal: { acessos: acessos.length, ultimoLogin },
      financeiro: verFinanceiro ? (receber.get(id) ?? { aReceber: 0, vencido: 0, doCliente: 0, qtd: 0 }) : null,
      equipe: ((ws.equipe as string[] | null) ?? []).map(u => perfil.get(u)).filter(Boolean)
        .map(p => ({ full_name: p!.full_name, avatar_url: p!.avatar_url })),
    }
  })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Clientes</h1>
          <p className="text-gray-500 text-sm mt-0.5">Espaços de trabalho por cliente</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
            <Link href={`/${orgSlug}/workspaces`}
              className={cn('px-2.5 py-1 rounded-md transition-colors', !archivedView ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}>
              Ativos
            </Link>
            <Link href={`/${orgSlug}/workspaces?view=arquivados`}
              className={cn('px-2.5 py-1 rounded-md transition-colors', archivedView ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}>
              Arquivados
            </Link>
          </div>
          {!archivedView && (
            <Link
              href={`/${orgSlug}/workspaces/new`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Novo cliente</span>
            </Link>
          )}
        </div>
      </div>

      {cards.length > 0 ? (
        <ClientesGrid orgSlug={orgSlug} clientes={cards} arquivados={archivedView} verFinanceiro={verFinanceiro} />
      ) : (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <FolderOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">
            {archivedView ? 'Nenhum cliente arquivado' : 'Nenhum cliente ainda'}
          </h3>
          <p className="text-gray-500 text-sm mt-1">
            {archivedView ? 'Clientes arquivados aparecem aqui.' : 'Crie o primeiro espaço de trabalho'}
          </p>
          {!archivedView && (
            <Link
              href={`/${orgSlug}/workspaces/new`}
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Novo cliente
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
