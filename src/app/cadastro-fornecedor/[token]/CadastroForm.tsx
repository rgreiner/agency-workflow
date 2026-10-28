'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { TagInput } from '@/components/ui/TagInput'
import type { CadastroResposta } from '@/lib/fornecedor-cadastro'

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-base sm:text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

type Contato = CadastroResposta['comercial']

function BlocoContato({ titulo, sub, valor, onChange }: { titulo: string; sub: string; valor: Contato; onChange: (c: Contato) => void }) {
  return (
    <div className={cardCls}>
      <h2 className="font-semibold text-gray-900">{titulo}</h2>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">{sub}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><label className={labelCls}>Nome</label><input value={valor.nome} onChange={e => onChange({ ...valor, nome: e.target.value })} className={inputCls} /></div>
        <div><label className={labelCls}>E-mail</label><input type="email" value={valor.email} onChange={e => onChange({ ...valor, email: e.target.value })} className={inputCls} /></div>
        <div><label className={labelCls}>WhatsApp</label><input inputMode="tel" value={valor.whatsapp} onChange={e => onChange({ ...valor, whatsapp: e.target.value })} placeholder="(45) 99999-9999" className={inputCls} /></div>
      </div>
    </div>
  )
}

export function CadastroForm({ token, inicial, tipos, jaRespondeu, agencia }: {
  token: string; inicial: CadastroResposta; tipos: string[]; jaRespondeu: boolean; agencia: string
}) {
  const [d, setD] = useState<CadastroResposta>(inicial)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState(false)

  // "Abriu" marcado pelo navegador: o preview de link do WhatsApp não conta.
  useEffect(() => {
    fetch(`/api/cadastro-fornecedor/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'abrir' }) }).catch(() => {})
  }, [token])

  async function salvar() {
    if (enviando) return
    setErro('')
    if (!d.tipo && !d.tags.length) { setErro('Conte o que você fornece (o tipo principal ou ao menos um produto/serviço).'); return }
    if (!d.comercial.email && !d.comercial.whatsapp) { setErro('Informe o e-mail ou o WhatsApp de quem recebe os pedidos de orçamento.'); return }
    setEnviando(true)
    try {
      const r = await fetch(`/api/cadastro-fornecedor/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'salvar', dados: d }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.error || 'Não foi possível salvar. Tente de novo.'); return }
      setFeito(true)
    } catch {
      setErro('Sem conexão. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  if (feito) {
    return (
      <div className={`${cardCls} text-center py-10`}>
        <div className="mx-auto w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mb-4"><Check className="w-6 h-6 text-emerald-600" /></div>
        <h2 className="text-lg font-semibold text-gray-900">Cadastro atualizado. Obrigado!</h2>
        <p className="text-sm text-gray-500 mt-1">Os próximos pedidos de orçamento da {agencia} chegam por este caminho.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className={cardCls}>
        <h2 className="font-semibold text-gray-900">Empresa</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <div><label className={labelCls}>Razão social</label><input value={d.razao} onChange={e => setD({ ...d, razao: e.target.value })} className={inputCls} /></div>
          <div><label className={labelCls}>CNPJ</label><input inputMode="numeric" value={d.cnpj} onChange={e => setD({ ...d, cnpj: e.target.value })} className={inputCls} /></div>
          <div><label className={labelCls}>Cidade</label><input value={d.cidade} onChange={e => setD({ ...d, cidade: e.target.value })} className={inputCls} /></div>
          <div><label className={labelCls}>UF</label><input value={d.uf} maxLength={2} onChange={e => setD({ ...d, uf: e.target.value.toUpperCase() })} className={inputCls} /></div>
        </div>
      </div>

      <div className={cardCls}>
        <h2 className="font-semibold text-gray-900">O que você fornece</h2>
        <p className="text-xs text-gray-500 mt-0.5 mb-3">É por aqui que o sistema sabe quando te chamar para orçar.</p>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Tipo principal</label>
            <Select value={d.tipo} onChange={v => setD({ ...d, tipo: v })} placeholder="Escolha…"
              options={[...tipos.map(t => ({ value: t, label: t })), { value: 'Outros', label: 'Outro' }]} />
          </div>
          <div>
            <label className={labelCls}>Produtos e serviços</label>
            <TagInput value={d.tags} onChange={tags => setD({ ...d, tags: tags.slice(0, 15) })} sugestoes={tipos} placeholder="Ex.: canecas, banner, vídeo institucional — tecle Enter" />
          </div>
          <div><label className={labelCls}>Região que atende</label><input value={d.atende} onChange={e => setD({ ...d, atende: e.target.value })} placeholder="Ex.: Oeste do Paraná, todo o Brasil" className={inputCls} /></div>
        </div>
      </div>

      <BlocoContato titulo="Quem recebe os pedidos de orçamento" sub="Comercial / vendas: o link da cotação vai para este contato." valor={d.comercial} onChange={c => setD({ ...d, comercial: c })} />
      <BlocoContato titulo="Financeiro" sub="Para nota fiscal, boleto e pagamentos." valor={d.financeiro} onChange={c => setD({ ...d, financeiro: c })} />

      <div className={cardCls}>
        <label className={labelCls}>Observações</label>
        <textarea value={d.obs} onChange={e => setD({ ...d, obs: e.target.value })} rows={3} placeholder="Pedido mínimo, prazo médio, catálogo… o que ajudar no orçamento." className={inputCls} />
        <p className="text-xs text-gray-400 mt-2">Dados bancários não são pedidos por aqui: qualquer mudança de conta é combinada direto com o nosso financeiro.</p>
      </div>

      {erro && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{erro}</p>}

      <div className="flex justify-end pb-10">
        <button type="button" disabled={enviando} onClick={salvar}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 text-[#fff] text-sm font-semibold rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-colors active:scale-[0.97]">
          {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {jaRespondeu ? 'Atualizar cadastro' : 'Salvar cadastro'}
        </button>
      </div>
    </div>
  )
}
