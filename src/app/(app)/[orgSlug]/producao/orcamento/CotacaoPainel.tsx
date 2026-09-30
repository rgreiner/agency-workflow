'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Send, Mail, Link2, Loader2, Paperclip, X, Upload, ChevronDown, ChevronRight, ArrowDownToLine, Lock, LockOpen, UserPlus, Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { MultiSelect } from '@/components/ui/Select'
import { WhatsAppIcon } from '@/components/ui/WhatsAppIcon'
import { AutoRefresh } from '@/components/ui/AutoRefresh'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { linkWhatsApp } from '@/lib/telefone'
import {
  parseFaixas, precoResolvido, respostaAplicada, statusConvite, textoWhatsApp, MAX_FAIXAS,
  type ArquivoRef, type CotacaoItem, type ItemOrcBase, type Resposta, type ConviteStatus,
} from '@/lib/cotacao'
import { criarCotacao, adicionarFornecedores, reenviarConvite, marcarWhatsapp, encerrarCotacao } from '@/app/actions/cotacao'

export interface FornecedorCotacaoOpt { id: string; name: string; tipo: string | null; tags: string[]; email: string | null; telefone: string | null }
export interface ConviteView {
  id: string; fornecedor_id: string; fornecedor: string; url: string
  email_para: string | null; telefone: string | null
  email_enviado_em: string | null; whatsapp_em: string | null; aberto_em: string | null
  respondido_em: string | null; recusado_em: string | null
  resposta: (Resposta & { recusa?: string }) | { recusa?: string } | null
  resposta_anexos: ArquivoRef[]
  dados_fornecedor: { contato: string; cnpj: string; email: string; whatsapp: string } | null
}
export interface CotacaoView {
  id: string; created_at: string; prazo_resposta: string | null; encerrada: boolean
  mensagem: string | null; anexos: ArquivoRef[]; itens: CotacaoItem[]; convites: ConviteView[]
}

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const btnSec = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors active:scale-[0.97]'

const STATUS: Record<ConviteStatus, { label: string; cls: string }> = {
  respondeu:   { label: 'Respondeu', cls: 'bg-emerald-100 text-emerald-700' },
  recusou:     { label: 'Não vai cotar', cls: 'bg-gray-100 text-gray-500' },
  abriu:       { label: 'Abriu o link', cls: 'bg-amber-100 text-amber-700' },
  enviado:     { label: 'Enviado', cls: 'bg-sky-100 text-sky-700' },
  nao_enviado: { label: 'Falta enviar', cls: 'bg-red-50 text-red-600' },
}
const ORDEM: ConviteStatus[] = ['respondeu', 'abriu', 'enviado', 'nao_enviado', 'recusou']
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
const hojeMais = (dias: number) => { const d = new Date(); d.setDate(d.getDate() + dias); return d.toLocaleDateString('en-CA') }

export function CotacaoPainel({
  orgSlug, orcamentoId, titulo, agencia, itens, itensSalvos, cotacoes, fornecedores, onAplicar, abrir = false,
}: {
  orgSlug: string; orcamentoId: string; titulo: string; agencia: string
  /** Itens do formulário agora (para trazer resposta e para montar o pedido). */
  itens: (ItemOrcBase & { descricao: string; imagem?: string })[]
  /** O formulário está igual ao que está gravado? Pedido só sai de orçamento salvo. */
  itensSalvos: boolean
  cotacoes: CotacaoView[]
  fornecedores: FornecedorCotacaoOpt[]
  onAplicar: (conviteId: string, fornecedorId: string, pedidos: CotacaoItem[], resposta: Resposta) => void
  /** Veio do "Gravar e pedir cotação": abre o envio direto. */
  abrir?: boolean
}) {
  const [modal, setModal] = useState<null | { modo: 'nova' } | { modo: 'adicionar'; cotacaoId: string }>(abrir && !cotacoes.length ? { modo: 'nova' } : null)
  const [verAntigas, setVerAntigas] = useState(false)
  const pendentes = cotacoes.some(c => !c.encerrada && c.convites.some(v => !v.respondido_em && !v.recusado_em))

  const [atual, ...antigas] = cotacoes
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      {pendentes && <AutoRefresh intervalMs={60000} />}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Cotação com fornecedores</h3>
          {!atual && (
            <p className="text-xs text-gray-500 mt-0.5 max-w-lg">
              Cada fornecedor recebe um link (e-mail ou WhatsApp) e preenche a proposta. O valor entra aqui como opção do item.
            </p>
          )}
        </div>
        <button type="button" onClick={() => setModal({ modo: 'nova' })} disabled={!itensSalvos}
          title={itensSalvos ? undefined : 'Salve o orçamento antes de pedir cotação'}
          className={cn('inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl transition-colors active:scale-[0.97] shrink-0',
            atual ? 'border border-gray-200 text-gray-700 hover:bg-gray-50' : 'bg-orange-600 text-[#fff] hover:bg-orange-700',
            !itensSalvos && 'opacity-50 cursor-not-allowed')}>
          <Send className="w-3.5 h-3.5" /> {atual ? 'Nova cotação' : 'Pedir cotação'}
        </button>
      </div>
      {!itensSalvos && <p className="text-xs text-amber-700 mt-2">Há alterações não salvas — salve o orçamento antes de pedir cotação.</p>}

      {atual && <Rodada c={atual} orgSlug={orgSlug} titulo={titulo} agencia={agencia} itens={itens} onAplicar={onAplicar}
        onAdicionar={() => setModal({ modo: 'adicionar', cotacaoId: atual.id })} />}

      {antigas.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <button type="button" onClick={() => setVerAntigas(v => !v)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors">
            {verAntigas ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Cotações anteriores ({antigas.length})
          </button>
          {verAntigas && antigas.map(c => (
            <Rodada key={c.id} c={c} orgSlug={orgSlug} titulo={titulo} agencia={agencia} itens={itens} onAplicar={onAplicar}
              onAdicionar={() => setModal({ modo: 'adicionar', cotacaoId: c.id })} />
          ))}
        </div>
      )}

      {modal && (
        <ModalEnvio
          orgSlug={orgSlug} orcamentoId={orcamentoId} itens={itens} fornecedores={fornecedores}
          modo={modal.modo} cotacaoId={modal.modo === 'adicionar' ? modal.cotacaoId : null}
          jaConvidados={modal.modo === 'adicionar' ? new Set(cotacoes.find(c => c.id === modal.cotacaoId)?.convites.map(v => v.fornecedor_id)) : new Set()}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function Rodada({ c, orgSlug, titulo, agencia, itens, onAplicar, onAdicionar }: {
  c: CotacaoView; orgSlug: string; titulo: string; agencia: string
  itens: ItemOrcBase[]
  onAplicar: (conviteId: string, fornecedorId: string, pedidos: CotacaoItem[], resposta: Resposta) => void
  onAdicionar: () => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const responderam = c.convites.filter(v => v.respondido_em).length
  const convites = [...c.convites].sort((a, b) => ORDEM.indexOf(statusConvite(a)) - ORDEM.indexOf(statusConvite(b)) || a.fornecedor.localeCompare(b.fornecedor, 'pt-BR'))

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
        <span>Enviada em {formatDateBR(c.created_at.slice(0, 10))}</span>
        {c.prazo_resposta && <span>Prazo {formatDateBR(c.prazo_resposta)}</span>}
        <span className="font-medium text-gray-800">{responderam} de {c.convites.length} responderam</span>
        {c.encerrada && <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Encerrada</span>}
        {c.anexos.map((a, i) => (
          <a key={i} href={`/api/cotacao/arquivo?cotacao=${c.id}&idx=${i}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 hover:text-gray-800 transition-colors">
            <Paperclip className="w-3 h-3" /> {a.nome}
          </a>
        ))}
        <span className="flex-1" />
        {!c.encerrada && <button type="button" onClick={onAdicionar} className={btnSec}><UserPlus className="w-3.5 h-3.5" /> Convidar mais</button>}
        <button type="button" disabled={pending} className={btnSec}
          onClick={() => start(async () => {
            const r = await encerrarCotacao(orgSlug, c.id, !c.encerrada)
            if (r.error) toast.error(r.error); else { toast.success(c.encerrada ? 'Cotação reaberta' : 'Cotação encerrada — o link não aceita mais proposta'); router.refresh() }
          })}>
          {c.encerrada ? <LockOpen className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} {c.encerrada ? 'Reabrir' : 'Encerrar'}
        </button>
      </div>

      <ul className="mt-3 divide-y divide-gray-100 border border-gray-100 rounded-xl">
        {convites.map(v => <LinhaConvite key={v.id} v={v} c={c} orgSlug={orgSlug} titulo={titulo} agencia={agencia} itens={itens} onAplicar={onAplicar} />)}
      </ul>
    </div>
  )
}

function LinhaConvite({ v, c, orgSlug, titulo, agencia, itens, onAplicar }: {
  v: ConviteView; c: CotacaoView; orgSlug: string; titulo: string; agencia: string
  itens: ItemOrcBase[]
  onAplicar: (conviteId: string, fornecedorId: string, pedidos: CotacaoItem[], resposta: Resposta) => void
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [pending, start] = useTransition()
  const st = statusConvite(v)
  const resposta = v.resposta && 'itens' in v.resposta ? v.resposta as Resposta : null
  const recusa = v.resposta && 'recusa' in v.resposta ? v.resposta.recusa : null
  const falta = !!resposta && !respostaAplicada(itens, v.id, resposta)
  const zap = v.telefone ? linkWhatsApp(v.telefone) : null
  const menor = resposta?.itens.flatMap(r => r.nao_fornece ? [] : r.precos.map(p => precoResolvido(p)?.total ?? 0)).filter(n => n > 0)

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAberto(a => !a)} disabled={!resposta && !recusa}
          className="flex items-center gap-1.5 min-w-0 text-left text-sm font-medium text-gray-900 disabled:cursor-default">
          {(resposta || recusa) ? (aberto ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />) : <span className="w-3.5" />}
          <span className="truncate">{v.fornecedor}</span>
        </button>
        <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium', STATUS[st].cls)}>{STATUS[st].label}</span>
        {menor && menor.length > 0 && <span className="text-xs text-gray-500">a partir de {formatBRL(Math.min(...menor))}</span>}
        <span className="flex-1" />
        {falta && (
          <button type="button" onClick={() => { onAplicar(v.id, v.fornecedor_id, c.itens, resposta!); toast.success('Proposta trazida — salve o orçamento para gravar') }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors active:scale-[0.97]">
            <ArrowDownToLine className="w-3.5 h-3.5" /> Trazer para o orçamento
          </button>
        )}
        {!v.respondido_em && !c.encerrada && (
          <>
            <button type="button" disabled={pending || !v.email_para} title={v.email_para ? `${v.email_enviado_em ? 'Reenviar' : 'Enviar'} e-mail para ${v.email_para}` : 'Sem e-mail no cadastro'}
              onClick={() => start(async () => {
                const r = await reenviarConvite(orgSlug, v.id)
                if (r.error) toast.error(r.error); else { toast.success('E-mail enviado'); router.refresh() }
              })}
              className={cn('p-1.5 rounded-lg transition-colors', v.email_para ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-800' : 'text-gray-300 cursor-not-allowed')}>
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            </button>
            {zap ? (
              <a href={`${zap}?text=${encodeURIComponent(textoWhatsApp({ agencia, fornecedor: v.fornecedor, titulo, prazo: c.prazo_resposta, url: v.url }))}`}
                target="_blank" rel="noopener" title={`Mandar pelo WhatsApp (${v.telefone})`}
                onClick={() => { marcarWhatsapp(v.id).then(() => router.refresh()) }}
                className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors">
                <WhatsAppIcon className="w-4 h-4" />
              </a>
            ) : (
              <span title="Sem telefone com DDD no cadastro" className="p-1.5 text-gray-300"><WhatsAppIcon className="w-4 h-4" /></span>
            )}
            <button type="button" title="Copiar link do fornecedor"
              onClick={() => navigator.clipboard?.writeText(v.url).then(() => toast.success('Link copiado')).catch(() => toast.error('Não foi possível copiar'))}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors">
              <Link2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {aberto && recusa != null && !resposta && <p className="mt-2 ml-5 text-xs text-gray-500">Motivo: {recusa || 'não informado'}</p>}
      {aberto && resposta && (
        <div className="mt-3 ml-5 space-y-3 text-sm">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-gray-400 text-left"><th className="py-1 font-medium">Item</th><th className="py-1 font-medium text-right">Quant.</th><th className="py-1 font-medium text-right">Unitário</th><th className="py-1 font-medium text-right">Total</th></tr></thead>
            <tbody>
              {resposta.itens.map(r => {
                const nome = c.itens.find(i => i.idx === r.idx)?.nome ?? `Item ${r.idx + 1}`
                if (r.nao_fornece) return <tr key={r.idx} className="text-gray-400"><td className="py-1">{nome}</td><td colSpan={3} className="py-1 text-right">não fornece</td></tr>
                const linhas = r.precos.map(p => ({ p, v: precoResolvido(p) })).filter(x => x.v)
                if (!linhas.length) return <tr key={r.idx} className="text-gray-400"><td className="py-1">{nome}</td><td colSpan={3} className="py-1 text-right">sem valor</td></tr>
                return linhas.map(({ p, v }, j) => (
                  <tr key={`${r.idx}-${p.quant}`} className="border-t border-gray-50">
                    <td className="py-1 text-gray-800">{j === 0 ? nome : ''}{j === 0 && r.obs && <span className="block text-xs text-gray-500">{r.obs}</span>}</td>
                    <td className="py-1 text-right tabular-nums">{p.quant.toLocaleString('pt-BR')}</td>
                    <td className="py-1 text-right tabular-nums">{formatBRL(v!.unit)}</td>
                    <td className="py-1 text-right tabular-nums font-medium">{formatBRL(v!.total)}</td>
                  </tr>
                ))
              })}
            </tbody>
          </table>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {([['Prazo de produção', resposta.prazo_producao], ['Pagamento', resposta.pgto], ['Validade', resposta.validade], ['Nº da proposta', resposta.n_orc]] as const)
              .filter(([, val]) => val).map(([k, val]) => <div key={k}><dt className="text-gray-400">{k}</dt><dd className="text-gray-800">{val}</dd></div>)}
          </dl>
          {resposta.observacao && <p className="text-xs text-gray-600 whitespace-pre-line">{resposta.observacao}</p>}
          {v.resposta_anexos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {v.resposta_anexos.map((a, i) => (
                <a key={i} href={`/api/cotacao/arquivo?convite=${v.id}&idx=${i}`} target="_blank" rel="noopener"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 text-xs text-gray-700 hover:bg-gray-200 transition-colors">
                  <Paperclip className="w-3 h-3" /> {a.nome}
                </a>
              ))}
            </div>
          )}
          {v.dados_fornecedor && (v.dados_fornecedor.contato || v.dados_fornecedor.email || v.dados_fornecedor.whatsapp) && (
            <p className="text-xs text-gray-500">
              Contato informado: {[v.dados_fornecedor.contato, v.dados_fornecedor.email, v.dados_fornecedor.whatsapp, v.dados_fornecedor.cnpj].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

function ModalEnvio({ orgSlug, orcamentoId, itens, fornecedores, modo, cotacaoId, jaConvidados, onClose }: {
  orgSlug: string; orcamentoId: string
  itens: (ItemOrcBase & { descricao: string; imagem?: string })[]
  fornecedores: FornecedorCotacaoOpt[]
  modo: 'nova' | 'adicionar'; cotacaoId: string | null; jaConvidados: Set<string>
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [erro, setErro] = useState('')
  const [pedido, setPedido] = useState(() => itens.map((it, idx) => {
    const qs = [...new Set(it.opcoes.map(o => parseInt(o.quant || '0', 10)).filter(n => n > 1))]
    return { idx, incluir: !!it.nome.trim(), faixas: qs.join(', ') }
  }))
  const [mensagem, setMensagem] = useState('')
  const [prazo, setPrazo] = useState(hojeMais(3))
  const [anexos, setAnexos] = useState<ArquivoRef[]>([])
  const [subindo, setSubindo] = useState(false)
  const [tipos, setTipos] = useState<string[]>([])
  const [tagsFiltro, setTagsFiltro] = useState<string[]>([])
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [tag, setTag] = useState('')

  const disponiveis = useMemo(() => fornecedores.filter(f => !jaConvidados.has(f.id)), [fornecedores, jaConvidados])
  const tipoOptions = useMemo(() => [...new Set(disponiveis.map(f => f.tipo).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(t => ({ value: t, label: t })), [disponiveis])
  const todasTags = useMemo(() => {
    const m = new Map<string, { tag: string; n: number }>()
    for (const f of disponiveis) for (const t of f.tags) { const k = norm(t); const e = m.get(k); if (e) e.n++; else m.set(k, { tag: t, n: 1 }) }
    return [...m.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, 'pt-BR'))
  }, [disponiveis])
  const filtrados = useMemo(() => {
    const q = norm(busca)
    return disponiveis.filter(f =>
      (!tipos.length || (f.tipo && tipos.includes(f.tipo))) &&
      (!tagsFiltro.length || f.tags.some(t => tagsFiltro.includes(norm(t)))) &&
      (!q || norm(f.name).includes(q) || f.tags.some(t => norm(t).includes(q))))
  }, [disponiveis, tipos, tagsFiltro, busca])
  const filtrando = tipos.length > 0 || tagsFiltro.length > 0 || busca.trim().length > 0
  const escolhidos = fornecedores.filter(f => sel.has(f.id))
  const semContato = escolhidos.filter(f => !f.email && !f.telefone).length
  const soZap = escolhidos.filter(f => !f.email && f.telefone).length

  const toggle = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const todosVisiveis = filtrados.length > 0 && filtrados.every(f => sel.has(f.id))

  async function subir(files: FileList | null) {
    if (!files?.length) return
    setSubindo(true)
    try {
      for (const file of Array.from(files).slice(0, 6 - anexos.length)) {
        const fd = new FormData(); fd.set('file', file); fd.set('org', orgSlug)
        const r = await fetch('/api/cotacao/anexo-agencia', { method: 'POST', body: fd })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { toast.error(j.error || 'Falha ao enviar o arquivo'); break }
        setAnexos(a => [...a, j as ArquivoRef])
      }
    } finally { setSubindo(false) }
  }

  function enviar() {
    setErro('')
    if (!sel.size) { setErro('Escolha ao menos um fornecedor.'); return }
    const itensPedido: CotacaoItem[] = pedido.filter(p => p.incluir).map(p => ({
      idx: p.idx, nome: itens[p.idx].nome, descricao: itens[p.idx].descricao ?? '',
      faixas: parseFaixas(p.faixas), temImagem: !!itens[p.idx].imagem,
    }))
    if (modo === 'nova' && !itensPedido.length) { setErro('Inclua ao menos um item.'); return }
    start(async () => {
      const r = modo === 'nova'
        ? await criarCotacao(orgSlug, orcamentoId, { itens: itensPedido, mensagem, prazo, anexos, fornecedorIds: [...sel], tag })
        : await adicionarFornecedores(orgSlug, cotacaoId!, [...sel])
      if (r.error) { setErro(r.error); return }
      const partes = [`${r.enviados ?? 0} e-mail${r.enviados === 1 ? '' : 's'} enviado${r.enviados === 1 ? '' : 's'}`]
      if (r.semEmail) partes.push(`${r.semEmail} sem e-mail: mande pelo WhatsApp na lista`)
      toast.success(`Cotação enviada — ${partes.join('; ')}`)
      onClose()
      router.refresh()
    })
  }

  return (
    <Modal open onClose={onClose} size="xl" label={modo === 'nova' ? 'Pedir cotação' : 'Convidar mais fornecedores'} dismissOnBackdrop={false} dismissable={!pending}>
      <ModalHeader title={modo === 'nova' ? 'Pedir cotação' : 'Convidar mais fornecedores'} onClose={onClose} />
      <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
        {modo === 'nova' && (
          <>
            <section>
              <p className={labelCls}>Itens e quantidades</p>
              <div className="space-y-2">
                {pedido.map((p, i) => (
                  <div key={p.idx} className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <label className="flex items-center gap-2 flex-1 min-w-0 text-sm text-gray-800">
                      <input type="checkbox" checked={p.incluir} disabled={!itens[p.idx].nome.trim()}
                        onChange={e => setPedido(arr => arr.map((x, j) => j === i ? { ...x, incluir: e.target.checked } : x))} className="w-4 h-4 accent-orange-600" />
                      <span className="truncate">{itens[p.idx].nome || <span className="text-gray-400">Item sem nome</span>}</span>
                    </label>
                    <input value={p.faixas} disabled={!p.incluir} placeholder={`Quantidades (até ${MAX_FAIXAS}): 500, 1000, 2000`}
                      onChange={e => setPedido(arr => arr.map((x, j) => j === i ? { ...x, faixas: e.target.value } : x))}
                      className={cn(inputCls, 'sm:w-72 py-2')} />
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1.5">Várias quantidades mostram ao fornecedor que o volume muda o preço. Em branco = 1 unidade (serviço).</p>
            </section>

            <section className="grid grid-cols-1 sm:grid-cols-[1fr_11rem] gap-3">
              <div>
                <label className={labelCls}>Mensagem para o fornecedor</label>
                <textarea rows={3} value={mensagem} onChange={e => setMensagem(e.target.value)} placeholder="Especificação, acabamento, entrega, prazo desejado…" className={cn(inputCls, 'resize-y')} />
              </div>
              <div>
                <label className={labelCls}>Responder até</label>
                <input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} className={inputCls} />
              </div>
            </section>

            <section>
              <div className="flex flex-wrap items-center gap-2">
                {anexos.map((a, i) => (
                  <span key={a.chave} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg bg-gray-100 text-xs text-gray-700">
                    <Paperclip className="w-3 h-3" /> <span className="max-w-[12rem] truncate">{a.nome}</span>
                    <button type="button" aria-label="Remover anexo" onClick={() => setAnexos(arr => arr.filter((_, j) => j !== i))} className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                  </span>
                ))}
                {anexos.length < 6 && (
                  <label className={cn(btnSec, 'cursor-pointer')}>
                    {subindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Anexar arquivo (arte, faca, referência)
                    <input type="file" multiple hidden onChange={e => { subir(e.target.files); e.target.value = '' }} />
                  </label>
                )}
              </div>
            </section>
          </>
        )}

        <section>
          <div className="flex items-center justify-between mb-2">
            <p className={labelCls}>Fornecedores</p>
            <span className="text-xs text-gray-500">{sel.size} escolhido{sel.size === 1 ? '' : 's'}</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome ou tag" className={cn(inputCls, 'pl-9 py-2')} />
            </div>
            <MultiSelect values={tipos} onChange={setTipos} options={tipoOptions} allLabel="Todos os tipos" />
          </div>
          {todasTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {todasTags.slice(0, 24).map(t => {
                const on = tagsFiltro.includes(norm(t.tag))
                return (
                  <button key={t.tag} type="button" onClick={() => setTagsFiltro(a => on ? a.filter(x => x !== norm(t.tag)) : [...a, norm(t.tag)])}
                    className={cn('px-2.5 py-1 rounded-full text-xs transition-colors active:scale-[0.97]', on ? 'bg-orange-600 text-[#fff]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                    {t.tag} <span className={on ? 'text-orange-100' : 'text-gray-400'}>{t.n}</span>
                  </button>
                )
              })}
            </div>
          )}

          {filtrando ? (
            <div className="mt-3 border border-gray-100 rounded-xl max-h-72 overflow-y-auto">
              <label className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 border-b border-gray-100 sticky top-0 bg-white">
                <input type="checkbox" checked={todosVisiveis} onChange={() => setSel(s => {
                  const n = new Set(s); filtrados.forEach(f => todosVisiveis ? n.delete(f.id) : n.add(f.id)); return n
                })} className="w-4 h-4 accent-orange-600" />
                Marcar os {filtrados.length} da lista
              </label>
              {filtrados.map(f => (
                <label key={f.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors text-sm cursor-pointer">
                  <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} className="w-4 h-4 accent-orange-600" />
                  <span className="flex-1 min-w-0">
                    <span className="text-gray-900">{f.name}</span>
                    {(f.tipo || f.tags.length > 0) && <span className="block text-[11px] text-gray-400 truncate">{[f.tipo, ...f.tags].filter(Boolean).join(' · ')}</span>}
                  </span>
                  <Contato f={f} />
                </label>
              ))}
              {!filtrados.length && <p className="px-3 py-4 text-sm text-gray-400">Nenhum fornecedor com esse filtro.</p>}
            </div>
          ) : (
            <p className="mt-3 text-xs text-gray-400">Filtre por tipo, tag ou nome para listar os fornecedores ({disponiveis.length} no cadastro).</p>
          )}

          {escolhidos.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {escolhidos.map(f => (
                <span key={f.id} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-orange-50 text-xs text-orange-800">
                  {f.name}
                  <button type="button" aria-label={`Tirar ${f.name}`} onClick={() => toggle(f.id)} className="p-0.5 text-orange-400 hover:text-orange-700 transition-colors"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}
          {(soZap > 0 || semContato > 0) && (
            <p className="mt-2 text-xs text-amber-700">
              {soZap > 0 && `${soZap} sem e-mail: depois de enviar, mande o link pelo WhatsApp na lista. `}
              {semContato > 0 && `${semContato} sem e-mail nem telefone: copie o link e mande por onde tiver.`}
            </p>
          )}

          {modo === 'nova' && (
            <div className="mt-4">
              <label className={labelCls}>Marcar os escolhidos com a tag (opcional)</label>
              <input value={tag} onChange={e => setTag(e.target.value)} list="cotacao-tags" placeholder="Ex.: caneta, camiseta, lona" className={cn(inputCls, 'sm:max-w-xs py-2')} />
              <datalist id="cotacao-tags">{todasTags.map(t => <option key={t.tag} value={t.tag} />)}</datalist>
              <p className="text-xs text-gray-400 mt-1">Na próxima cotação desse tipo, é só clicar na tag.</p>
            </div>
          )}
        </section>

        {erro && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{erro}</p>}
      </div>
      <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
        <button type="button" onClick={onClose} disabled={pending} className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancelar</button>
        <button type="button" onClick={enviar} disabled={pending || !sel.size}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-colors active:scale-[0.97]">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Enviar para {sel.size} fornecedor{sel.size === 1 ? '' : 'es'}
        </button>
      </div>
    </Modal>
  )
}

function Contato({ f }: { f: FornecedorCotacaoOpt }) {
  if (!f.email && !f.telefone) return <span className="text-[11px] text-red-500 shrink-0">sem contato</span>
  return (
    <span className="flex items-center gap-1 shrink-0 text-gray-400">
      {f.email && <span title={f.email}><Mail className="w-3.5 h-3.5" /></span>}
      {f.telefone && <span title={f.telefone} className="text-emerald-600"><WhatsAppIcon className="w-3.5 h-3.5" /></span>}
    </span>
  )
}
