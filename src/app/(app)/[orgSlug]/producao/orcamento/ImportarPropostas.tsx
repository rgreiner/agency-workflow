'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, FileText, Loader2, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Combobox } from '@/components/ui/Combobox'
import { downscaleImage } from '@/lib/image-resize'
import { parseMoney } from '@/lib/midia'
import { chaveNome } from '@/lib/nomes'
import { fmtBR, fmtBRUnit, type ArquivoRef } from '@/lib/cotacao'
import type { PropostaLida } from '@/lib/ai/proposta-fornecedor'
import { lerPropostaPdf, registrarPropostaLida } from '@/app/actions/cotacao-importar'
import type { FornecedorCotacaoOpt } from './CotacaoPainel'

/**
 * Propostas que chegaram POR FORA (PDF/foto): a IA lê e a pessoa CONFERE antes de
 * gravar — regra da casa, a IA sugere e quem decide é a pessoa. Cada arquivo vira
 * um cartão editável; "Adicionar ao orçamento" grava como resposta de cotação.
 */

const inputCls = 'w-full px-2.5 py-1.5 bg-gray-100 border border-transparent rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white'
const labelCls = 'block text-[11px] font-medium text-gray-500 mb-0.5'

type Linha = { variante: string; quant: string; unit: string; total: string }
type ItemC = { alvo: string /* idx do orçamento ou 'novo' / 'ignorar' */; nome: string; descricao: string; obs: string; linhas: Linha[] }
type Cartao = {
  id: number; arquivo: ArquivoRef | null; nomeArquivo: string
  estado: 'subindo' | 'lendo' | 'pronto' | 'erro' | 'gravando' | 'gravado'
  erro?: string
  fornecedorId: string /* '' = criar novo */
  novo: { nome: string; cnpj: string; email: string; telefone: string }
  contato: string
  condicoes: { n_orc: string; prazo_producao: string; validade: string; pgto: string; observacao: string }
  itens: ItemC[]
}

const vazioCond = { n_orc: '', prazo_producao: '', validade: '', pgto: '', observacao: '' }
const qtd = (s: string) => { const n = parseInt((s ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) && n > 0 ? n : 0 }

/** Item lido → item do orçamento: mesmo nome, nome contido, ou o único item; senão "novo". */
function alvoSugerido(nome: string, itens: { nome: string }[], totalLidos: number): string {
  const k = chaveNome(nome)
  const igual = itens.findIndex(it => chaveNome(it.nome) === k)
  if (igual >= 0) return String(igual)
  const parecido = itens.findIndex(it => { const n = chaveNome(it.nome); return n.length >= 4 && (k.includes(n) || n.includes(k)) })
  if (parecido >= 0) return String(parecido)
  const comNome = itens.filter(it => it.nome.trim())
  if (comNome.length === 1 && totalLidos === 1) return String(itens.indexOf(comNome[0]))
  return 'novo'
}

export function ImportarPropostas({ orgSlug, orcamentoId, itens, fornecedores, onClose, onImportado }: {
  orgSlug: string; orcamentoId: string
  itens: { nome: string }[]
  fornecedores: FornecedorCotacaoOpt[]
  onClose: () => void
  onImportado: (itens: unknown[]) => void
}) {
  const router = useRouter()
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const seq = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // Itens do orçamento podem crescer a cada proposta gravada (item "novo").
  const [itensOrc, setItensOrc] = useState(itens)

  const patch = (id: number, fn: (c: Cartao) => Cartao) => setCartoes(cs => cs.map(c => c.id === id ? fn(c) : c))

  async function adicionar(files: FileList | null) {
    if (!files?.length) return
    for (const original of Array.from(files).slice(0, 10)) {
      const id = ++seq.current
      setCartoes(cs => [...cs, {
        id, arquivo: null, nomeArquivo: original.name, estado: 'subindo', fornecedorId: '',
        novo: { nome: '', cnpj: '', email: '', telefone: '' }, contato: '', condicoes: vazioCond, itens: [],
      }])
      ;(async () => {
        try {
          // Foto de orçamento: reduz (legível em 1600px); PDF vai como veio.
          const file = original.type.startsWith('image/') ? await downscaleImage(original, 2000, 0.85) : original
          const fd = new FormData(); fd.set('file', file); fd.set('org', orgSlug)
          const r = await fetch('/api/cotacao/anexo-agencia', { method: 'POST', body: fd })
          const j = await r.json().catch(() => ({}))
          if (!r.ok) { patch(id, c => ({ ...c, estado: 'erro', erro: j.error || 'Falha ao enviar o arquivo' })); return }
          const arquivo = { chave: j.chave, nome: original.name } as ArquivoRef
          patch(id, c => ({ ...c, arquivo, estado: 'lendo' }))
          const res = await lerPropostaPdf(orgSlug, arquivo)
          const lida: PropostaLida | undefined = res.lida
          patch(id, c => ({
            ...c,
            estado: res.error && !lida?.itens.length ? 'erro' : 'pronto',
            erro: res.error,
            fornecedorId: res.fornecedorId ?? '',
            novo: { nome: lida?.fornecedor.nome ?? '', cnpj: lida?.fornecedor.cnpj ?? '', email: lida?.fornecedor.email ?? '', telefone: lida?.fornecedor.telefone ?? '' },
            contato: lida?.fornecedor.contato ?? '',
            condicoes: lida ? { n_orc: lida.n_orc, prazo_producao: lida.prazo_producao, validade: lida.validade, pgto: lida.pgto, observacao: lida.observacao } : vazioCond,
            itens: (lida?.itens ?? []).map(it => ({
              alvo: alvoSugerido(it.nome, itensOrc, lida!.itens.length), nome: it.nome, descricao: it.descricao, obs: it.obs,
              linhas: it.linhas.map(l => ({
                variante: l.variante, quant: String(l.quant),
                unit: l.unit ? fmtBRUnit(l.unit) : (l.total && l.quant ? fmtBRUnit(l.total / l.quant) : ''),
                total: l.total ? fmtBR(l.total) : (l.unit ? fmtBR(l.unit * l.quant) : ''),
              })),
            })),
          }))
        } catch {
          patch(id, c => ({ ...c, estado: 'erro', erro: 'Falha ao ler o arquivo' }))
        }
      })()
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  async function gravar(c: Cartao) {
    if (!c.arquivo) return
    if (!c.fornecedorId && c.novo.nome.trim().length < 2) { toast.error('Escolha o fornecedor ou informe o nome dele'); return }
    const validos = c.itens.filter(it => it.alvo !== 'ignorar')
    if (!validos.length) { toast.error('Nenhum item para adicionar'); return }
    patch(c.id, x => ({ ...x, estado: 'gravando' }))
    const r = await registrarPropostaLida(orgSlug, orcamentoId, {
      arquivo: c.arquivo,
      fornecedor: c.fornecedorId ? { id: c.fornecedorId } : { novo: c.novo },
      condicoes: c.condicoes, contato: c.contato,
      itens: validos.map(it => ({
        alvo: it.alvo === 'novo' ? null : Number(it.alvo), nome: it.nome, descricao: it.descricao, obs: it.obs,
        linhas: it.linhas.map(l => ({ variante: l.variante.trim(), quant: qtd(l.quant), unit: parseMoney(l.unit) || null, total: parseMoney(l.total) || null })),
      })),
    })
    if (r.error || !r.itens) { patch(c.id, x => ({ ...x, estado: 'pronto' })); toast.error(r.error ?? 'Não foi possível gravar'); return }
    patch(c.id, x => ({ ...x, estado: 'gravado' }))
    const novos = r.itens as { nome: string }[]
    setItensOrc(novos)
    onImportado(r.itens)
    router.refresh()
    toast.success('Proposta adicionada ao orçamento')
  }

  const fornecedorOptions = fornecedores.map(f => ({ value: f.id, label: f.name }))
  const alvoOptions = [
    ...itensOrc.map((it, i) => ({ value: String(i), label: it.nome || `Item ${i + 1}` })),
    { value: 'novo', label: '+ Criar item novo' },
    { value: 'ignorar', label: 'Não adicionar' },
  ]
  const ocupado = cartoes.some(c => c.estado === 'subindo' || c.estado === 'lendo' || c.estado === 'gravando')

  return (
    <Modal open onClose={onClose} size="full" label="Ler propostas (PDF)" dismissOnBackdrop={false} dismissable={!ocupado}>
      <ModalHeader title="Ler propostas de fornecedores" onClose={onClose} />
      <div className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto">
        <button type="button" onClick={() => inputRef.current?.click()}
          className="w-full flex flex-col items-center gap-1 py-6 rounded-2xl border-2 border-dashed border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
          <Upload className="w-5 h-5 text-gray-400" />
          <span className="text-sm font-medium">Escolher PDFs ou fotos dos orçamentos</span>
          <span className="text-xs text-gray-400">A IA lê cada arquivo; você confere e adiciona ao orçamento</span>
        </button>
        <input ref={inputRef} type="file" multiple hidden accept=".pdf,image/*" onChange={e => adicionar(e.target.files)} />

        {cartoes.map(c => (
          <div key={c.id} className={cn('rounded-2xl border p-4', c.estado === 'gravado' ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200')}>
            <div className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="font-medium text-gray-900 truncate">{c.nomeArquivo}</span>
              <span className="flex-1" />
              {(c.estado === 'subindo' || c.estado === 'lendo') && <span className="inline-flex items-center gap-1.5 text-xs text-gray-500"><Loader2 className="w-3.5 h-3.5 animate-spin" />{c.estado === 'subindo' ? 'Enviando…' : 'A IA está lendo…'}</span>}
              {c.estado === 'gravado' && <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Check className="w-3.5 h-3.5" /> Adicionada</span>}
              {c.estado !== 'gravado' && c.estado !== 'gravando' && (
                <button type="button" aria-label="Descartar" onClick={() => setCartoes(cs => cs.filter(x => x.id !== c.id))} className="p-1 text-gray-300 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
              )}
            </div>
            {c.erro && <p className="mt-2 text-xs text-amber-700">{c.erro}</p>}

            {(c.estado === 'pronto' || c.estado === 'gravando') && (
              <div className="mt-3 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-3">
                  <div>
                    <label className={labelCls}>Fornecedor {c.fornecedorId ? '(do cadastro)' : '(novo — será cadastrado)'}</label>
                    <Combobox size="sm" value={c.fornecedorId} options={fornecedorOptions} placeholder={c.novo.nome ? `Criar: ${c.novo.nome}` : 'Escolher fornecedor'}
                      onChange={v => patch(c.id, x => ({ ...x, fornecedorId: v }))} />
                    {c.fornecedorId && <button type="button" onClick={() => patch(c.id, x => ({ ...x, fornecedorId: '' }))} className="mt-1 text-[11px] text-gray-500 hover:text-gray-800 transition-colors">Não é este — cadastrar o do PDF</button>}
                  </div>
                  {!c.fornecedorId && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2"><label className={labelCls}>Nome</label><input value={c.novo.nome} onChange={e => patch(c.id, x => ({ ...x, novo: { ...x.novo, nome: e.target.value } }))} className={inputCls} /></div>
                      <div><label className={labelCls}>CNPJ</label><input value={c.novo.cnpj} onChange={e => patch(c.id, x => ({ ...x, novo: { ...x.novo, cnpj: e.target.value } }))} className={inputCls} /></div>
                      <div><label className={labelCls}>Telefone</label><input value={c.novo.telefone} onChange={e => patch(c.id, x => ({ ...x, novo: { ...x.novo, telefone: e.target.value } }))} className={inputCls} /></div>
                      <div className="col-span-2"><label className={labelCls}>E-mail</label><input value={c.novo.email} onChange={e => patch(c.id, x => ({ ...x, novo: { ...x.novo, email: e.target.value } }))} className={inputCls} /></div>
                    </div>
                  )}
                </div>

                {c.itens.map((it, ii) => {
                  const setItem = (p: Partial<ItemC>) => patch(c.id, x => ({ ...x, itens: x.itens.map((y, j) => j === ii ? { ...y, ...p } : y) }))
                  const setLinha = (li: number, campo: keyof Linha, v: string) => setItem({
                    linhas: it.linhas.map((l, k) => {
                      if (k !== li) return l
                      if (campo === 'variante') return { ...l, variante: v }
                      if (campo === 'quant') { const q = qtd(v), u = parseMoney(l.unit); return { ...l, quant: v, total: q && u ? fmtBR(q * u) : l.total } }
                      const n = parseMoney(v), q = qtd(l.quant)
                      return campo === 'unit' ? { ...l, unit: v, total: n && q ? fmtBR(n * q) : '' } : { ...l, total: v, unit: n && q ? fmtBRUnit(n / q) : '' }
                    }),
                  })
                  return (
                    <div key={ii} className={cn('rounded-xl bg-gray-50 p-3', it.alvo === 'ignorar' && 'opacity-50')}>
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_16rem] gap-2 items-end">
                        <div>
                          <label className={labelCls}>Item lido</label>
                          <input value={it.nome} onChange={e => setItem({ nome: e.target.value })} className={cn(inputCls, 'font-medium bg-white')} />
                        </div>
                        <div>
                          <label className={labelCls}>Entra no orçamento como</label>
                          <Select size="sm" value={it.alvo} onChange={v => setItem({ alvo: v })} options={alvoOptions} />
                        </div>
                      </div>
                      {it.descricao && <p className="mt-1.5 text-xs text-gray-500">{it.descricao}</p>}
                      {it.alvo !== 'ignorar' && (
                        <div className="mt-2 space-y-1.5">
                          <div className="grid grid-cols-[1fr_5.5rem_7rem_7rem_1.75rem] gap-1.5 text-[11px] font-medium text-gray-400 px-0.5">
                            <span>Opção (material/formato)</span><span className="text-right">Quant.</span><span className="text-right">Unitário</span><span className="text-right">Total</span><span />
                          </div>
                          {it.linhas.map((l, li) => (
                            <div key={li} className="grid grid-cols-[1fr_5.5rem_7rem_7rem_1.75rem] gap-1.5">
                              <input value={l.variante} onChange={e => setLinha(li, 'variante', e.target.value)} placeholder="—" className={cn(inputCls, 'bg-white')} />
                              <input inputMode="numeric" value={l.quant} onChange={e => setLinha(li, 'quant', e.target.value)} className={cn(inputCls, 'bg-white text-right')} />
                              <input inputMode="decimal" value={l.unit} onChange={e => setLinha(li, 'unit', e.target.value)} className={cn(inputCls, 'bg-white text-right')} />
                              <input inputMode="decimal" value={l.total} onChange={e => setLinha(li, 'total', e.target.value)} className={cn(inputCls, 'bg-white text-right')} />
                              <button type="button" aria-label="Remover linha" onClick={() => setItem({ linhas: it.linhas.filter((_, k) => k !== li) })} className="p-1 text-gray-300 hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          ))}
                          <button type="button" onClick={() => setItem({ linhas: [...it.linhas, { variante: '', quant: '', unit: '', total: '' }] })}
                            className="inline-flex items-center gap-1 text-xs text-orange-700 hover:text-orange-800 transition-colors"><Plus className="w-3 h-3" /> Linha</button>
                          <input value={it.obs} onChange={e => setItem({ obs: e.target.value })} placeholder="Observação do fornecedor sobre o item" className={cn(inputCls, 'bg-white')} />
                        </div>
                      )}
                    </div>
                  )
                })}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {([['prazo_producao', 'Prazo de produção'], ['pgto', 'Pagamento'], ['validade', 'Validade'], ['n_orc', 'Nº da proposta']] as const).map(([k, rotulo]) => (
                    <div key={k}><label className={labelCls}>{rotulo}</label>
                      <input value={c.condicoes[k]} onChange={e => patch(c.id, x => ({ ...x, condicoes: { ...x.condicoes, [k]: e.target.value } }))} className={inputCls} /></div>
                  ))}
                  <div className="col-span-2 md:col-span-4"><label className={labelCls}>Observações</label>
                    <textarea rows={2} value={c.condicoes.observacao} onChange={e => patch(c.id, x => ({ ...x, condicoes: { ...x.condicoes, observacao: e.target.value } }))} className={cn(inputCls, 'resize-y')} /></div>
                </div>

                <div className="flex justify-end">
                  <button type="button" disabled={c.estado === 'gravando'} onClick={() => gravar(c)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-colors active:scale-[0.97]">
                    {c.estado === 'gravando' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Adicionar ao orçamento
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end px-6 py-4 border-t border-gray-100">
        <button type="button" onClick={onClose} disabled={ocupado} className="px-4 py-2.5 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 transition-colors">Fechar</button>
      </div>
    </Modal>
  )
}
