'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, FileText, Loader2, Paperclip, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDateBR, parseMoney } from '@/lib/midia'
import { fmtBR, fmtBRUnit, type ArquivoRef, type CotacaoItem, type Resposta } from '@/lib/cotacao'

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-base sm:text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

type Preco = { quant: number; unit: string; total: string }
type ItemState = { idx: number; nao_fornece: boolean; precos: Preco[]; obs: string }

const intBR = (n: number) => n.toLocaleString('pt-BR')

export function RespostaForm({
  token, mensagem, itens, anexosAgencia, respostaAnterior, anexosAnteriores, dados: dadosIniciais, jaRespondeu, jaRecusou, prazo,
}: {
  token: string; mensagem: string | null; itens: CotacaoItem[]; anexosAgencia: ArquivoRef[]
  respostaAnterior: Resposta | null; anexosAnteriores: ArquivoRef[]
  dados: { contato: string; cnpj: string; email: string; whatsapp: string }
  jaRespondeu: boolean; jaRecusou: boolean; prazo: string | null
}) {
  const [estado, setEstado] = useState<ItemState[]>(() => itens.map(it => {
    const ant = respostaAnterior?.itens.find(r => r.idx === it.idx)
    return {
      idx: it.idx, nao_fornece: !!ant?.nao_fornece, obs: ant?.obs ?? '',
      precos: it.faixas.map(q => {
        const p = ant?.precos.find(x => x.quant === q)
        return { quant: q, unit: p?.unit ? fmtBRUnit(p.unit) : '', total: p?.total ? fmtBR(p.total) : '' }
      }),
    }
  }))
  const [cond, setCond] = useState({
    n_orc: respostaAnterior?.n_orc ?? '', pgto: respostaAnterior?.pgto ?? '',
    prazo_producao: respostaAnterior?.prazo_producao ?? '', validade: respostaAnterior?.validade ?? '',
    observacao: respostaAnterior?.observacao ?? '',
  })
  const [dados, setDados] = useState(dadosIniciais)
  const [arquivos, setArquivos] = useState<ArquivoRef[]>(anexosAnteriores)
  const [enviando, setEnviando] = useState<null | 'responder' | 'recusar' | 'upload'>(null)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState<null | 'respondeu' | 'recusou'>(null)
  const [recusando, setRecusando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // "Abriu" é marcado aqui (e não no servidor) para o preview de link do
  // WhatsApp não contar como abertura.
  useEffect(() => {
    fetch(`/api/cotacao/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'abrir' }) }).catch(() => {})
  }, [token])

  const patchPreco = (ii: number, pi: number, campo: 'unit' | 'total', v: string) => setEstado(s => s.map((it, i) => i !== ii ? it : {
    ...it,
    precos: it.precos.map((p, j) => {
      if (j !== pi) return p
      const n = parseMoney(v)
      if (campo === 'unit') return { ...p, unit: v, total: n ? fmtBR(n * p.quant) : '' }
      return { ...p, total: v, unit: n && p.quant ? fmtBRUnit(n / p.quant) : '' }
    }),
  }))
  const patchItem = (ii: number, patch: Partial<ItemState>) => setEstado(s => s.map((it, i) => i === ii ? { ...it, ...patch } : it))

  async function subir(files: FileList | null) {
    if (!files?.length) return
    setErro(''); setEnviando('upload')
    try {
      for (const file of Array.from(files).slice(0, 6 - arquivos.length)) {
        const fd = new FormData(); fd.set('file', file)
        const r = await fetch(`/api/cotacao/${token}/upload`, { method: 'POST', body: fd })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { setErro(j.error || 'Falha ao enviar o arquivo'); break }
        setArquivos(a => [...a, j as ArquivoRef])
      }
    } finally {
      setEnviando(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function enviar(acao: 'responder' | 'recusar') {
    if (enviando) return
    setErro(''); setEnviando(acao)
    const resposta = {
      ...cond,
      itens: estado.map(it => ({
        idx: it.idx, nao_fornece: it.nao_fornece, obs: it.obs,
        precos: it.precos.map(p => ({ quant: p.quant, unit: parseMoney(p.unit) || null, total: parseMoney(p.total) || null })),
      })),
    }
    try {
      const r = await fetch(`/api/cotacao/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(acao === 'recusar' ? { acao, motivo } : { acao, resposta, anexos: arquivos, dados }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.error || 'Não foi possível enviar. Tente de novo.'); return }
      setFeito(acao === 'recusar' ? 'recusou' : 'respondeu')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setErro('Sem conexão. Tente de novo.')
    } finally {
      setEnviando(null)
    }
  }

  if (feito) {
    return (
      <div className={cn(cardCls, 'text-center py-10')}>
        <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4"><Check className="w-6 h-6 text-green-600" /></div>
        <h2 className="text-lg font-semibold text-gray-900">{feito === 'respondeu' ? 'Proposta enviada. Obrigado!' : 'Tudo certo, registramos.'}</h2>
        <p className="text-sm text-gray-500 mt-2 leading-relaxed">
          {feito === 'respondeu'
            ? `A agência já recebeu os valores.${prazo ? ` Se precisar corrigir, é só abrir este mesmo link até ${formatDateBR(prazo)}.` : ' Se precisar corrigir, é só abrir este mesmo link.'}`
            : 'Obrigado pelo retorno. Contamos com você nas próximas.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {(jaRespondeu || jaRecusou) && (
        <p className="text-sm text-gray-700 bg-orange-50 border border-orange-100 rounded-xl px-4 py-3">
          {jaRespondeu ? 'Você já enviou uma proposta. O que mudar aqui substitui a anterior.' : 'Você informou que não vai cotar. Se mudou de ideia, ainda dá para enviar a proposta.'}
        </p>
      )}

      {(mensagem || anexosAgencia.length > 0) && (
        <div className={cardCls}>
          {mensagem && <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{mensagem}</p>}
          {anexosAgencia.length > 0 && (
            <div className={cn('flex flex-wrap gap-2', mensagem && 'mt-4')}>
              {anexosAgencia.map((a, i) => (
                <a key={i} href={`/api/cotacao/${token}/arquivo?a=${i}`} target="_blank" rel="noopener"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-sm text-gray-700 hover:bg-gray-200 transition-colors">
                  <Paperclip className="w-3.5 h-3.5" /> {a.nome}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {itens.map((it, ii) => {
        const st = estado[ii]
        return (
          <div key={it.idx} className={cardCls}>
            <div className="flex gap-3">
              {it.temImagem && (
                <a href={`/api/cotacao/${token}/arquivo?item=${it.idx}`} target="_blank" rel="noopener" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/cotacao/${token}/arquivo?item=${it.idx}`} alt="" className="w-16 h-16 rounded-xl object-cover border border-gray-200" />
                </a>
              )}
              <div className="min-w-0">
                <h2 className="font-semibold text-gray-900">{it.nome || `Item ${ii + 1}`}</h2>
                {it.descricao && <p className="text-sm text-gray-600 whitespace-pre-line mt-1 leading-relaxed">{it.descricao}</p>}
              </div>
            </div>

            <label className="flex items-center gap-2 mt-4 text-sm text-gray-600 select-none">
              <input type="checkbox" checked={st.nao_fornece} onChange={e => patchItem(ii, { nao_fornece: e.target.checked })} className="w-4 h-4 accent-orange-600" />
              Não fornecemos este item
            </label>

            {!st.nao_fornece && (
              <div className="mt-3 space-y-2">
                <div className="hidden sm:grid grid-cols-[6rem_1fr_1fr] gap-2 text-[11px] font-medium text-gray-400 px-1">
                  <span>Quantidade</span><span>Valor unitário (R$)</span><span>Total (R$)</span>
                </div>
                {st.precos.map((p, pi) => (
                  <div key={p.quant} className="grid grid-cols-2 sm:grid-cols-[6rem_1fr_1fr] gap-2 items-center">
                    <span className="col-span-2 sm:col-span-1 text-sm font-medium text-gray-900 sm:px-1">{intBR(p.quant)} un.</span>
                    <input inputMode="decimal" aria-label={`Valor unitário para ${intBR(p.quant)}`} placeholder="Unitário" value={p.unit}
                      onChange={e => patchPreco(ii, pi, 'unit', e.target.value)} className={cn(inputCls, 'text-right')} />
                    <input inputMode="decimal" aria-label={`Total para ${intBR(p.quant)}`} placeholder="Total" value={p.total}
                      onChange={e => patchPreco(ii, pi, 'total', e.target.value)} className={cn(inputCls, 'text-right')} />
                  </div>
                ))}
                <p className="text-xs text-gray-400">Preencha o unitário ou o total — o outro é calculado.</p>
              </div>
            )}
            <input value={st.obs} onChange={e => patchItem(ii, { obs: e.target.value })} placeholder="Observação sobre este item (opcional)" className={cn(inputCls, 'mt-3')} />
          </div>
        )
      })}

      <div className={cardCls}>
        <h2 className="font-semibold text-gray-900 mb-3">Condições</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>Prazo de produção</label><input value={cond.prazo_producao} onChange={e => setCond(c => ({ ...c, prazo_producao: e.target.value }))} placeholder="Ex.: 10 dias úteis" className={inputCls} /></div>
          <div><label className={labelCls}>Condição de pagamento</label><input value={cond.pgto} onChange={e => setCond(c => ({ ...c, pgto: e.target.value }))} placeholder="Ex.: 30 dias" className={inputCls} /></div>
          <div><label className={labelCls}>Validade da proposta</label><input value={cond.validade} onChange={e => setCond(c => ({ ...c, validade: e.target.value }))} placeholder="Ex.: 15 dias" className={inputCls} /></div>
          <div><label className={labelCls}>Nº da sua proposta</label><input value={cond.n_orc} onChange={e => setCond(c => ({ ...c, n_orc: e.target.value }))} placeholder="Opcional" className={inputCls} /></div>
        </div>
        <label className={cn(labelCls, 'mt-3')}>Observações</label>
        <textarea rows={3} value={cond.observacao} onChange={e => setCond(c => ({ ...c, observacao: e.target.value }))} placeholder="Frete, material, acabamento…" className={cn(inputCls, 'resize-y')} />

        <div className="mt-4">
          <p className={labelCls}>Arquivo da proposta (opcional)</p>
          <div className="flex flex-wrap gap-2">
            {arquivos.map((a, i) => (
              <span key={a.chave} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-lg bg-gray-100 text-sm text-gray-700">
                <FileText className="w-3.5 h-3.5" /> <span className="max-w-[14rem] truncate">{a.nome}</span>
                <button type="button" aria-label="Remover arquivo" onClick={() => setArquivos(arr => arr.filter((_, j) => j !== i))} className="p-0.5 rounded text-gray-400 hover:text-red-500 transition-colors"><X className="w-3.5 h-3.5" /></button>
              </span>
            ))}
            {arquivos.length < 6 && (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={enviando === 'upload'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition-colors active:scale-[0.97]">
                {enviando === 'upload' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Anexar arquivo
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.zip" onChange={e => subir(e.target.files)} />
          <p className="text-xs text-gray-400 mt-1.5">Pode enviar o seu orçamento em PDF junto com os valores.</p>
        </div>
      </div>

      <div className={cardCls}>
        <h2 className="font-semibold text-gray-900">Seus dados</h2>
        <p className="text-xs text-gray-500 mt-0.5 mb-3">Confira e corrija se precisar — assim o próximo pedido chega no lugar certo.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>Seu nome</label><input value={dados.contato} onChange={e => setDados(d => ({ ...d, contato: e.target.value }))} className={inputCls} /></div>
          <div><label className={labelCls}>CNPJ</label><input inputMode="numeric" value={dados.cnpj} onChange={e => setDados(d => ({ ...d, cnpj: e.target.value }))} className={inputCls} /></div>
          <div><label className={labelCls}>E-mail</label><input type="email" value={dados.email} onChange={e => setDados(d => ({ ...d, email: e.target.value }))} className={inputCls} /></div>
          <div><label className={labelCls}>WhatsApp</label><input inputMode="tel" value={dados.whatsapp} onChange={e => setDados(d => ({ ...d, whatsapp: e.target.value }))} placeholder="(45) 99999-9999" className={inputCls} /></div>
        </div>
      </div>

      {erro && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{erro}</p>}

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pb-10">
        {!recusando ? (
          <button type="button" onClick={() => setRecusando(true)} className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Não vamos cotar desta vez</button>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center flex-1 sm:mr-4">
            <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo (opcional)" className={cn(inputCls, 'sm:max-w-xs')} />
            <button type="button" disabled={!!enviando} onClick={() => enviar('recusar')}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50">
              {enviando === 'recusar' ? 'Enviando…' : 'Confirmar'}
            </button>
            <button type="button" onClick={() => setRecusando(false)} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Cancelar</button>
          </div>
        )}
        <button type="button" disabled={!!enviando} onClick={() => enviar('responder')}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 text-[#fff] text-sm font-semibold rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-colors active:scale-[0.97]">
          {enviando === 'responder' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {jaRespondeu ? 'Atualizar proposta' : 'Enviar proposta'}
        </button>
      </div>
    </div>
  )
}

