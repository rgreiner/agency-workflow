'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Upload, Loader2, FileText, Check, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/midia'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { uploadFile } from '@/lib/storage/upload-client'
import { lerNfDoFornecedor, lancarDespesaDoPedido, type NfLidaView } from '@/app/actions/despesa-pedido'
import type { ContaRef } from '../faturamento/ClassificacaoFields'
import type { Anexo } from '@/app/actions/financeiro'

export interface PedidoCusto {
  id: string
  doc: string
  titulo: string
  cliente: string
  situacao: string
  valorCliente: number
  custoLancado: number
  notasLancadas: number
  fornecedorId: string | null
  fornecedorNome: string | null
}
export interface FornecedorRef { id: string; nome: string; cnpj: string | null }

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

export function CustosClient({ orgSlug, pedidos, contas, contaPadrao, fornecedores }: {
  orgSlug: string; pedidos: PedidoCusto[]; contas: ContaRef[]; contaPadrao: string; fornecedores: FornecedorRef[]
}) {
  const [lancando, setLancando] = useState<PedidoCusto | null>(null)

  // Sem custo em cima: é a fila de trabalho. Com custo lançado fica embaixo,
  // visível — o fornecedor às vezes manda uma segunda nota do mesmo pedido.
  const { pendentes, comCusto } = useMemo(() => ({
    pendentes: pedidos.filter(p => p.notasLancadas === 0),
    comCusto: pedidos.filter(p => p.notasLancadas > 0),
  }), [pedidos])

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900">Custos de produção</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        A nota do fornecedor vira despesa <strong className="text-gray-700">ligada ao pedido</strong> —
        o custo passa a ter o mesmo rastro que a receita já tem.
      </p>

      {pedidos.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Nenhum pedido com fornecedor</h3>
          <p className="text-gray-500 text-sm mt-1">
            Aparecem aqui os pedidos de produção aprovados ou faturados que têm fornecedor no cadastro.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <Tabela titulo="Sem custo lançado" pedidos={pendentes} onLancar={setLancando} destaque />
          <Tabela titulo="Com custo lançado" pedidos={comCusto} onLancar={setLancando} />
        </div>
      )}

      {lancando && (
        <DialogoNf orgSlug={orgSlug} pedido={lancando} contas={contas} contaPadrao={contaPadrao}
          fornecedores={fornecedores} onFechar={() => setLancando(null)} />
      )}
    </div>
  )
}

function Tabela({ titulo, pedidos, onLancar, destaque }: {
  titulo: string; pedidos: PedidoCusto[]; onLancar: (p: PedidoCusto) => void; destaque?: boolean
}) {
  if (pedidos.length === 0) return null
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-800 mb-2">
        {titulo} <span className="text-gray-400 font-normal">({pedidos.length})</span>
      </h2>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
              <th className="text-left px-4 py-3 w-24">Nº</th>
              <th className="text-left px-4 py-3">Pedido</th>
              <th className="text-left px-4 py-3">Cliente</th>
              <th className="text-left px-4 py-3">Fornecedor</th>
              <th className="text-right px-4 py-3">Cliente paga</th>
              <th className="text-right px-4 py-3">Custo lançado</th>
              <th className="w-44" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {pedidos.map(p => (
              <tr key={p.id} className={cn('transition-colors hover:bg-gray-50/50', destaque && 'bg-amber-50/30')}>
                <td className="px-4 py-3 text-sm text-gray-500 tabular-nums whitespace-nowrap">{p.doc}</td>
                <td className="px-4 py-3 text-sm text-gray-900">{p.titulo || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{p.cliente}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{p.fornecedorNome ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-700">{formatBRL(p.valorCliente)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {p.notasLancadas === 0
                    ? <span className="text-sm text-gray-300">—</span>
                    : <>
                        <div className="text-sm font-medium text-gray-900">{formatBRL(p.custoLancado)}</div>
                        <div className="text-[11px] text-gray-400">{p.notasLancadas} nota(s)</div>
                      </>}
                </td>
                <td className="px-3 py-3 text-right">
                  <button onClick={() => onLancar(p)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-orange-200 text-orange-700 text-xs font-medium rounded-lg hover:bg-orange-500/10 active:scale-[0.97] transition-colors">
                    <Upload className="w-3.5 h-3.5" /> Lançar NF
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function DialogoNf({ orgSlug, pedido, contas, contaPadrao, fornecedores, onFechar }: {
  orgSlug: string; pedido: PedidoCusto; contas: ContaRef[]; contaPadrao: string
  fornecedores: FornecedorRef[]; onFechar: () => void
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [lendo, setLendo] = useState(false)
  const [salvando, start] = useTransition()
  const [anexo, setAnexo] = useState<Anexo | null>(null)
  const [lida, setLida] = useState<NfLidaView | null>(null)

  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState('')
  const [numero, setNumero] = useState('')
  const [descricao, setDescricao] = useState('')
  const [fornecedorId, setFornecedorId] = useState(pedido.fornecedorId ?? '')
  const [contaId, setContaId] = useState(contaPadrao)

  async function escolher(file: File) {
    setLendo(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
      const url = await uploadFile('lancamentos', `${crypto.randomUUID()}.${ext}`, file)
      const novo: Anexo = { url, nome: file.name, tipo: 'NF', emitente: 'fornecedor' }
      setAnexo(novo)

      const r = await lerNfDoFornecedor(orgSlug, [url])
      if (r.error) { toast.error(r.error); return }
      const nf = r.nf!
      setLida(nf)
      // Preenche só o que veio: campo em branco é melhor que chute, porque o
      // valor errado vira despesa errada na margem do cliente.
      if (nf.valor != null) setValor(String(nf.valor))
      if (nf.vencimento) setVencimento(nf.vencimento)
      else if (nf.emissao) setVencimento(nf.emissao)
      if (nf.numero) setNumero(nf.numero)
      if (nf.descricao) setDescricao(nf.descricao)
      if (nf.fornecedorId) setFornecedorId(nf.fornecedorId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha no upload')
    } finally { setLendo(false) }
  }

  const fornecedorNome = fornecedores.find(f => f.id === fornecedorId)?.nome ?? pedido.fornecedorNome ?? ''
  const travado = !(Number(valor) > 0) || !vencimento || !descricao.trim()

  function salvar() {
    start(async () => {
      const r = await lancarDespesaDoPedido(orgSlug, pedido.id, {
        valor: Number(valor), vencimento, descricao: descricao.trim(),
        numeroNf: numero.trim() || null,
        contatoId: fornecedorId || null, contatoNome: fornecedorNome || null,
        contaId: contaId || null,
        anexos: anexo ? [anexo] : [],
      })
      if (r.error) { toast.error(r.error); return }
      toast.success(`Custo lançado em ${pedido.doc}.`)
      onFechar()
      router.refresh()
    })
  }

  return (
    <Modal open onClose={onFechar} size="md">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Lançar NF do fornecedor</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {pedido.doc} · {pedido.cliente} — a despesa fica ligada a este pedido.
        </p>
      </div>

      <div className="px-6 py-5 space-y-4">
        <div>
          <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) escolher(f); e.target.value = '' }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={lendo}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-gray-300 rounded-xl text-sm text-gray-600 hover:border-orange-300 hover:bg-orange-500/5 disabled:opacity-50 transition-colors">
            {lendo
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Lendo a nota…</>
              : anexo
                ? <><Check className="w-4 h-4 text-emerald-600" /> {anexo.nome}</>
                : <><Upload className="w-4 h-4" /> Anexar a NF (PDF ou foto)</>}
          </button>
          {lida && (
            <p className="text-[11px] text-gray-400 mt-1.5 inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Lido da nota{lida.emitente ? `: ${lida.emitente}` : ''}
              {lida.cnpj && !lida.fornecedorId && ' · CNPJ não casou com nenhum fornecedor cadastrado'}
              {' '}— confira antes de salvar.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Valor</label>
            <input value={valor} onChange={e => setValor(e.target.value.replace(',', '.'))}
              inputMode="decimal" placeholder="0,00" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Vencimento</label>
            <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Nº da NF</label>
            <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="opcional" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Conta</label>
            <Select value={contaId} onChange={setContaId}
              options={contas.map(c => ({ value: c.id, label: c.nome }))} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Fornecedor</label>
            <Select value={fornecedorId} onChange={setFornecedorId}
              options={[{ value: '', label: '— sem vínculo —' }, ...fornecedores.map(f => ({ value: f.id, label: f.nome }))]} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Descrição</label>
            <input value={descricao} onChange={e => setDescricao(e.target.value)}
              placeholder="o que o fornecedor entregou" className={inputCls} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onFechar} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancelar</button>
          <button onClick={salvar} disabled={travado || salvando}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-colors">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Lançar custo
          </button>
        </div>
      </div>
    </Modal>
  )
}
