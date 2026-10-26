'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Check, FileText, Loader2, Paperclip, Plus, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDateBR, parseMoney } from '@/lib/midia'
import { fmtBR, fmtBRUnit, MAX_FOTOS_ITEM, MAX_LINHAS_ITEM, type ArquivoRef, type CotacaoItem, type Resposta } from '@/lib/cotacao'
import { downscaleImage } from '@/lib/image-resize'

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-base sm:text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const cardCls = 'bg-white rounded-2xl border border-gray-200 p-5'

/** Linha de preço: quantidade é do fornecedor (vem preenchida com a pedida, mas ele troca). */
type Linha = { quant: string; unit: string; total: string }
/** Opção do fornecedor para o item (material, formato…). A primeira, sem nome, é a pedida. */
type Grupo = { variante: string; linhas: Linha[] }
type ItemState = { idx: number; nao_fornece: boolean; grupos: Grupo[]; obs: string; fotos: ArquivoRef[] }

const qtd = (s: string) => { const n = parseInt((s ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) && n > 0 ? n : 0 }
const linhaVazia = (quant = ''): Linha => ({ quant, unit: '', total: '' })
const nLinhas = (it: ItemState) => it.grupos.reduce((n, g) => n + g.linhas.length, 0)

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
    // Resposta anterior volta como ele deixou; senão, as quantidades pedidas numa opção só.
    const grupos: Grupo[] = []
    for (const p of ant?.precos ?? []) {
      const v = p.variante ?? ''
      let g = grupos.find(x => x.variante === v)
      if (!g) { g = { variante: v, linhas: [] }; grupos.push(g) }
      g.linhas.push({ quant: String(p.quant), unit: p.unit ? fmtBRUnit(p.unit) : '', total: p.total ? fmtBR(p.total) : '' })
    }
    if (!grupos.length) grupos.push({ variante: '', linhas: it.faixas.map(q => linhaVazia(String(q))) })
    return { idx: it.idx, nao_fornece: !!ant?.nao_fornece, obs: ant?.obs ?? '', fotos: ant?.fotos ?? [], grupos }
  }))
  const [cond, setCond] = useState({
    n_orc: respostaAnterior?.n_orc ?? '', pgto: respostaAnterior?.pgto ?? '',
    prazo_producao: respostaAnterior?.prazo_producao ?? '', validade: respostaAnterior?.validade ?? '',
    observacao: respostaAnterior?.observacao ?? '',
  })
  const [dados, setDados] = useState(dadosIniciais)
  const [arquivos, setArquivos] = useState<ArquivoRef[]>(anexosAnteriores)
  const [enviando, setEnviando] = useState<null | 'responder' | 'recusar' | 'upload' | `foto-${number}`>(null)
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

  const patchGrupos = (ii: number, fn: (g: Grupo[]) => Grupo[]) => setEstado(s => s.map((it, i) => i !== ii ? it : { ...it, grupos: fn(it.grupos) }))
  // Unitário ↔ total pela quantidade da linha; trocar a quantidade mantém o unitário.
  const patchLinha = (ii: number, gi: number, li: number, campo: keyof Linha, v: string) => patchGrupos(ii, gs => gs.map((g, j) => j !== gi ? g : {
    ...g,
    linhas: g.linhas.map((l, k) => {
      if (k !== li) return l
      if (campo === 'quant') { const q = qtd(v), u = parseMoney(l.unit); return { ...l, quant: v, total: q && u ? fmtBR(q * u) : l.total } }
      const n = parseMoney(v), q = qtd(l.quant)
      if (campo === 'unit') return { ...l, unit: v, total: n && q ? fmtBR(n * q) : '' }
      return { ...l, total: v, unit: n && q ? fmtBRUnit(n / q) : '' }
    }),
  }))
  const addLinha = (ii: number, gi: number) => patchGrupos(ii, gs => gs.map((g, j) => j === gi ? { ...g, linhas: [...g.linhas, linhaVazia()] } : g))
  const delLinha = (ii: number, gi: number, li: number) => patchGrupos(ii, gs => gs
    .map((g, j) => j === gi ? { ...g, linhas: g.linhas.filter((_, k) => k !== li) } : g)
    .filter((g, j) => g.linhas.length || j === 0)
    .map(g => g.linhas.length ? g : { ...g, linhas: [linhaVazia()] }))
  // Nova opção já nasce com as mesmas quantidades — é o caso comum (mesmo item, outro papel).
  const addGrupo = (ii: number) => patchGrupos(ii, gs => [...gs, { variante: '', linhas: gs[0].linhas.map(l => linhaVazia(l.quant)) }])
  const delGrupo = (ii: number, gi: number) => patchGrupos(ii, gs => gs.filter((_, j) => j !== gi))
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

  /** Foto do produto: reduzida para WebP no aparelho antes de subir (celular manda 4–8 MB). */
  async function subirFotos(ii: number, files: FileList | null) {
    if (!files?.length) return
    setErro(''); setEnviando(`foto-${ii}`)
    try {
      const livres = MAX_FOTOS_ITEM - estado[ii].fotos.length
      for (const original of Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, livres)) {
        const file = await downscaleImage(original)
        const fd = new FormData(); fd.set('file', file)
        const r = await fetch(`/api/cotacao/${token}/upload`, { method: 'POST', body: fd })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { setErro(j.error || 'Falha ao enviar a foto'); break }
        setEstado(s => s.map((it, i) => i === ii ? { ...it, fotos: [...it.fotos, j as ArquivoRef] } : it))
      }
    } finally {
      setEnviando(null)
    }
  }

  async function enviar(acao: 'responder' | 'recusar') {
    if (enviando) return
    setErro(''); setEnviando(acao)
    const resposta = {
      ...cond,
      itens: estado.map(it => ({
        idx: it.idx, nao_fornece: it.nao_fornece, obs: it.obs, fotos: it.fotos,
        precos: it.grupos.flatMap(g => g.linhas.map(l => ({
          variante: g.variante.trim(), quant: qtd(l.quant), unit: parseMoney(l.unit) || null, total: parseMoney(l.total) || null,
        }))),
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
              <div className="mt-3 space-y-3">
                {st.grupos.map((g, gi) => (
                  <div key={gi} className={cn('space-y-2', st.grupos.length > 1 && 'rounded-xl border border-gray-200 p-3')}>
                    {(st.grupos.length > 1 || g.variante) && (
                      <div className="flex items-center gap-2">
                        <input value={g.variante} onChange={e => patchGrupos(ii, gs => gs.map((x, j) => j === gi ? { ...x, variante: e.target.value } : x))}
                          placeholder={gi === 0 ? 'Opção 1 (ex.: Couchê 120g)' : `Opção ${gi + 1} (ex.: Sulfite 90g)`}
                          aria-label={`Nome da opção ${gi + 1}`} className={cn(inputCls, 'font-medium')} />
                        {gi > 0 && (
                          <button type="button" aria-label={`Remover opção ${gi + 1}`} onClick={() => delGrupo(ii, gi)}
                            className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-gray-50 transition-colors"><X className="w-4 h-4" /></button>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-[4.5rem_1fr_1fr_1.75rem] sm:grid-cols-[7rem_1fr_1fr_2rem] gap-1.5 sm:gap-2 text-[11px] font-medium text-gray-400 px-1">
                      <span>Quant.</span><span>Unitário (R$)</span><span>Total (R$)</span><span />
                    </div>
                    {g.linhas.map((l, li) => (
                      <div key={li} className="grid grid-cols-[4.5rem_1fr_1fr_1.75rem] sm:grid-cols-[7rem_1fr_1fr_2rem] gap-1.5 sm:gap-2 items-center">
                        <input inputMode="numeric" aria-label="Quantidade" placeholder="Quant." value={l.quant}
                          onChange={e => patchLinha(ii, gi, li, 'quant', e.target.value)} className={cn(inputCls, 'text-right px-2 sm:px-3')} />
                        <input inputMode="decimal" aria-label="Valor unitário" placeholder="Unitário" value={l.unit}
                          onChange={e => patchLinha(ii, gi, li, 'unit', e.target.value)} className={cn(inputCls, 'text-right px-2 sm:px-3')} />
                        <input inputMode="decimal" aria-label="Total" placeholder="Total" value={l.total}
                          onChange={e => patchLinha(ii, gi, li, 'total', e.target.value)} className={cn(inputCls, 'text-right px-2 sm:px-3')} />
                        <button type="button" aria-label="Remover quantidade" onClick={() => delLinha(ii, gi, li)}
                          className="p-1 sm:p-2 rounded-lg text-gray-400 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                      </div>
                    ))}
                    {nLinhas(st) < MAX_LINHAS_ITEM && (
                      <button type="button" onClick={() => addLinha(ii, gi)}
                        className="inline-flex items-center gap-1 text-sm text-orange-700 hover:text-orange-800 transition-colors">
                        <Plus className="w-3.5 h-3.5" /> Outra quantidade
                      </button>
                    )}
                  </div>
                ))}
                {nLinhas(st) + st.grupos[0].linhas.length <= MAX_LINHAS_ITEM && (
                  <button type="button" onClick={() => addGrupo(ii)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition-colors active:scale-[0.97]">
                    <Plus className="w-4 h-4" /> Outra opção (material, formato, acabamento)
                  </button>
                )}
                <p className="text-xs text-gray-400">Pode trocar as quantidades e incluir outras. Preencha o unitário ou o total — o outro é calculado.</p>
              </div>
            )}
            <input value={st.obs} onChange={e => patchItem(ii, { obs: e.target.value })} placeholder="Observação sobre este item (opcional)" className={cn(inputCls, 'mt-3')} />
            {!st.nao_fornece && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {st.fotos.map((f, fi) => (
                  <span key={f.chave} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/cotacao/${token}/arquivo?foto=${encodeURIComponent(f.chave)}`} alt="" className="w-16 h-16 rounded-xl object-cover border border-gray-200" />
                    <button type="button" aria-label="Remover foto" onClick={() => patchItem(ii, { fotos: st.fotos.filter((_, j) => j !== fi) })}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-red-500 flex items-center justify-center transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {st.fotos.length < MAX_FOTOS_ITEM && (
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer active:scale-[0.97]">
                    {enviando === `foto-${ii}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                    Foto do produto (opcional)
                    <input type="file" accept="image/*" multiple hidden disabled={!!enviando} onChange={e => { subirFotos(ii, e.target.files); e.target.value = '' }} />
                  </label>
                )}
              </div>
            )}
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

