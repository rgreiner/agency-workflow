'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { parseMoney } from '@/lib/midia'
import { Upload, Loader2, FileText, X, Sparkles, Check, RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { uploadFile } from '@/lib/storage/upload-client'
import { downscaleImage } from '@/lib/image-resize'
import { lerDocumentoDespesa, lancarDespesaDeDocumento, lancarCronograma, type DocumentoLido } from '@/app/actions/despesa-documento'
import type { Anexo, FinanceCentro, FinanceCategoriaGrupo } from '@/app/actions/financeiro'
import { ClassificacaoFields, type Classificacao, type ContaRef } from '../faturamento/ClassificacaoFields'

export interface FornecedorRef { id: string; nome: string }

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

interface Formulario {
  fornecedorId: string
  nomeLivre: string
  descricao: string
  valor: string
  vencimento: string
  numero: string
}

const VAZIO: Formulario = { fornecedorId: '', nomeLivre: '', descricao: '', valor: '', vencimento: '', numero: '' }

export function LancarDespesaClient({ orgSlug, contas, contaPadrao, categorias, centros, fornecedores }: {
  orgSlug: string; contas: ContaRef[]; contaPadrao: string
  categorias: FinanceCategoriaGrupo[]; centros: FinanceCentro[]; fornecedores: FornecedorRef[]
}) {
  // Despesa da casa (mercado, energia, assinatura) é a maioria: nasce no centro
  // marcado como padrão no cadastro. Nada inventado se ninguém estiver marcado.
  const centroPadrao = centros.find(c => c.padrao && !c.arquivado)?.nome ?? ''
  const clsInicial: Classificacao = { conta: contaPadrao, categoria: '', centro: centroPadrao, forma: '' }

  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [arquivos, setArquivos] = useState<Anexo[]>([])
  const [subindo, setSubindo] = useState(false)
  const [lendo, setLendo] = useState(false)
  const [lido, setLido] = useState<DocumentoLido | null>(null)
  const [f, setF] = useState<Formulario>(VAZIO)
  const [cls, setCls] = useState<Classificacao>(clsInicial)
  const [arrastando, setArrastando] = useState(false)
  const [salvando, start] = useTransition()
  // Despesas já lançadas com o documento atual. Um cupom vira mais de uma
  // despesa com frequência: o de R$ 178,29 da Muffato virou "Happy Hour"
  // (R$ 112,55, só a cerveja e a coca) + "Supermercado" (o resto).
  const [lancadas, setLancadas] = useState<{ descricao: string; valor: number }[]>([])
  // Cronograma: quais parcelas entram (índices). A data de "hoje" é fixada na
  // LEITURA, não no render — Date durante o render é impuro e repinta sozinho.
  const [selecao, setSelecao] = useState<Set<number>>(new Set())
  const [hojeLeitura, setHojeLeitura] = useState('')

  const set = (k: keyof Formulario, v: string) => setF(x => ({ ...x, [k]: v }))

  function limpar() {
    setArquivos([]); setLido(null); setF(VAZIO); setCls(clsInicial); setLancadas([]); setSelecao(new Set())
  }

  const moeda = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const jaLancado = lancadas.reduce((a, l) => a + l.valor, 0)
  const restante = lido?.valor != null ? Math.round((lido.valor - jaLancado) * 100) / 100 : 0

  async function ler(lista: Anexo[]) {
    if (lista.length === 0) return
    setLendo(true)
    const r = await lerDocumentoDespesa(orgSlug, lista.map(a => a.url))
    setLendo(false)
    if (r.error) { toast.error(r.error); return }
    const d = r.doc!
    setLido(d)
    // Preenche só o que veio. Campo em branco é melhor que chute: valor ou data
    // errados viram despesa errada no fluxo de caixa.
    setF(x => ({
      ...x,
      fornecedorId: d.fornecedorId ?? x.fornecedorId,
      nomeLivre: d.fornecedorId ? '' : (d.emitente ?? x.nomeLivre),
      descricao: d.descricao ?? x.descricao,
      // Em formato brasileiro: é como a pessoa digita e como parseMoney lê.
      // "1454.4" cru viraria 14544 no parser (ele tira os pontos de milhar).
      // O que a pessoa marcou no papel vence o total impresso: o financeiro grifa
      // a parte da empresa e escreve o subtotal à mão (o resto é compra pessoal
      // ou outra despesa). Total só quando nada foi marcado.
      valor: (d.valorMarcado ?? d.valor) != null
        ? (d.valorMarcado ?? d.valor)!.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : x.valor,
      // Cupom já pago não tem vencimento: a data da compra é a data do lançamento.
      vencimento: d.vencimento ?? d.emissao ?? x.vencimento,
      numero: d.numero ?? x.numero,
    }))
    if (d.categoria) setCls(c => ({ ...c, categoria: d.categoria! }))
    if (d.parcelas.length > 1) {
      // Parcela já vencida começa DESMARCADA: o documento do banco não diz que
      // foi paga ("EM CONTRATAÇÃO" em todas), mas quem paga sabe. Lançá-la de
      // novo criaria uma despesa em aberto que já saiu do caixa.
      const hoje = new Date().toISOString().slice(0, 10)
      setHojeLeitura(hoje)
      setSelecao(new Set(d.parcelas.flatMap((p, i) => (!p.pago && p.vencimento >= hoje ? [i] : []))))
    }
  }

  async function adicionar(files: FileList | File[]) {
    const lista = Array.from(files).filter(file => file.type === 'application/pdf' || file.type.startsWith('image/'))
    if (lista.length === 0) { toast.error('Envie PDF ou foto.'); return }
    setSubindo(true)
    try {
      const novos: Anexo[] = []
      for (const original of lista) {
        // Foto reduzida e em WebP (regra da casa), mas com teto MAIOR que o
        // padrão: cupom é comprido, e a 1600px a letra miúda some para a IA.
        const file = await downscaleImage(original, 2400, 0.85)
        const ext = file.name.split('.').pop()?.toLowerCase() || (file.type === 'application/pdf' ? 'pdf' : 'webp')
        const url = await uploadFile('lancamentos', `${crypto.randomUUID()}.${ext}`, file)
        novos.push({ url, nome: original.name, tipo: 'NF', emitente: 'fornecedor' })
      }
      const todos = [...arquivos, ...novos]
      setArquivos(todos)
      // Lê de novo com TODOS os arquivos: a segunda foto do mesmo cupom completa
      // a primeira, e ler só a nova devolveria metade da compra.
      await ler(todos)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha no upload')
    } finally { setSubindo(false) }
  }

  function remover(i: number) {
    const resto = arquivos.filter((_, j) => j !== i)
    setArquivos(resto)
    if (resto.length === 0) setLido(null)
  }

  const valorNum = parseMoney(f.valor)
  const falta = [
    !(valorNum > 0) && 'valor',
    !f.vencimento && 'data',
    !f.descricao.trim() && 'descrição',
    !cls.categoria && 'categoria',
    !cls.centro && 'centro de custo',
  ].filter(Boolean) as string[]

  function salvar() {
    if (falta.length) { toast.error(`Falta: ${falta.join(', ')}.`); return }
    start(async () => {
      const r = await lancarDespesaDeDocumento(orgSlug, {
        valor: valorNum, vencimento: f.vencimento, descricao: f.descricao,
        numeroNf: f.numero.trim() || null,
        fornecedorId: f.fornecedorId || null,
        contatoNome: f.fornecedorId ? null : (f.nomeLivre.trim() || null),
        contaId: cls.conta || null, categoria: cls.categoria, centroCusto: cls.centro, forma: cls.forma || null,
        anexos: arquivos,
      })
      if (r.error) { toast.error(r.error); return }
      toast.success('Despesa lançada.', {
        action: { label: 'Ver em Lançamentos', onClick: () => router.push(`/${orgSlug}/financeiro/lancamentos`) },
      })
      const novas = [...lancadas, { descricao: f.descricao.trim(), valor: valorNum }]
      const sobra = lido?.valor != null ? Math.round((lido.valor - novas.reduce((a, l) => a + l.valor, 0)) * 100) / 100 : 0
      if (sobra > 0.009) {
        // Sobrou valor do documento: prepara a próxima despesa com o MESMO
        // arquivo e o restante já no campo. Se a sobra é compra pessoal (o item
        // de quem foi ao mercado), "Próximo documento" descarta sem lançar.
        setLancadas(novas)
        setF(x => ({ ...x, descricao: '', valor: moeda(sobra) }))
        setCls(c => ({ ...c, categoria: '' }))
      } else {
        // Tela feita para a pilha de papel: volta limpa para o próximo documento.
        limpar()
      }
    })
  }

  const ocupado = subindo || lendo
  const cronograma = lido && lido.parcelas.length > 1 ? lido.parcelas : null
  const escolhidas = cronograma ? cronograma.filter((_, i) => selecao.has(i)) : []
  const somaEscolhidas = escolhidas.reduce((a, p) => a + p.valor, 0)
  const alternar = (i: number) => setSelecao(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })

  function salvarCronograma() {
    const faltaC = [
      escolhidas.length === 0 && 'parcelas',
      !f.descricao.trim() && 'descrição',
      !cls.categoria && 'categoria',
      !cls.centro && 'centro de custo',
    ].filter(Boolean) as string[]
    if (faltaC.length) { toast.error(`Falta: ${faltaC.join(', ')}.`); return }
    start(async () => {
      const r = await lancarCronograma(orgSlug, {
        descricao: f.descricao,
        fornecedorId: f.fornecedorId || null,
        contatoNome: f.fornecedorId ? null : (f.nomeLivre.trim() || null),
        contaId: cls.conta || null, categoria: cls.categoria, centroCusto: cls.centro, forma: cls.forma || null,
        // Total DO DOCUMENTO (maior número impresso), não o que foi marcado:
        // pular a parcela 1 já paga não pode renumerar a 2 como "1/54".
        parcelaTotal: Math.max(...cronograma!.map(p => p.numero ?? 0)) || cronograma!.length,
        parcelas: escolhidas.map(p => ({ numero: p.numero, vencimento: p.vencimento, valor: p.valor })),
        anexos: arquivos,
      })
      if (r.error) { toast.error(r.error); return }
      toast.success(`${r.n} parcelas lançadas.`, {
        action: { label: 'Ver em Lançamentos', onClick: () => router.push(`/${orgSlug}/financeiro/lancamentos`) },
      })
      limpar()
    })
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Lançar despesa</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Envie a nota, o cupom ou o boleto. A leitura preenche o lançamento e você confere antes de salvar.
          </p>
        </div>
        <Link href={`/${orgSlug}/financeiro/lancamentos`}
          className="px-3 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors">
          Ver lançamentos
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* ── documento ─────────────────────────────────────────── */}
        <section className="space-y-3">
          <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple className="hidden"
            onChange={e => { if (e.target.files?.length) void adicionar(e.target.files); e.target.value = '' }} />

          <button
            type="button"
            disabled={ocupado}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setArrastando(true) }}
            onDragLeave={() => setArrastando(false)}
            onDrop={e => { e.preventDefault(); setArrastando(false); if (e.dataTransfer.files.length) void adicionar(e.dataTransfer.files) }}
            className={cn(
              'w-full flex flex-col items-center justify-center gap-2 text-center rounded-2xl border-2 border-dashed transition-colors disabled:cursor-wait',
              arquivos.length ? 'py-6' : 'py-14',
              arrastando ? 'border-orange-400 bg-orange-500/5' : 'border-gray-200 hover:border-orange-300 hover:bg-orange-500/5',
            )}
          >
            {ocupado ? (
              <>
                <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
                <span className="text-sm text-gray-600">{subindo ? 'Enviando…' : 'Lendo o documento…'}</span>
              </>
            ) : (
              <>
                <Upload className="w-6 h-6 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">
                  {arquivos.length ? 'Adicionar outra foto do mesmo documento' : 'Solte aqui a NF, o cupom ou o boleto'}
                </span>
                <span className="text-xs text-gray-400">PDF ou foto · cupom comprido pode ir em várias fotos</span>
              </>
            )}
          </button>

          {arquivos.length > 0 && (
            <ul className="space-y-1.5">
              {arquivos.map((a, i) => (
                <li key={a.url} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200">
                  <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                  <a href={a.url} target="_blank" rel="noreferrer"
                    className="text-sm text-gray-700 truncate hover:text-orange-600 transition-colors">{a.nome}</a>
                  <button type="button" onClick={() => remover(i)} aria-label={`Remover ${a.nome}`}
                    className="ml-auto p-1 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {lido && (
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 text-xs text-gray-600 space-y-1">
              <p className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                <Sparkles className="w-3.5 h-3.5 text-orange-500" /> Lido do documento
              </p>
              {lido.emitente && <p>{lido.emitente}{lido.cnpj && <span className="text-gray-400 tabular-nums"> · {lido.cnpj}</span>}</p>}
              {lido.documentos > 1 && <p>{lido.documentos} documentos diferentes nas imagens — valores somados.</p>}
              {(lido.valor != null || lido.valorMarcado != null) && (
                <p className="tabular-nums">
                  {lido.valor != null && <>Total impresso R$ {moeda(lido.valor)}</>}
                  {lido.valor != null && lido.valorMarcado != null && ' · '}
                  {lido.valorMarcado != null && (
                    <strong className="font-medium text-gray-800">
                      {lido.criterio === 'manuscrito' ? 'escrito à mão' : 'itens grifados'} R$ {moeda(lido.valorMarcado)}
                    </strong>
                  )}
                </p>
              )}
              <p className={lido.fornecedorId ? 'text-emerald-700' : 'text-gray-500'}>
                {lido.fornecedorId
                  ? `Fornecedor do cadastro: ${lido.fornecedorNome} (casou pelo ${lido.casouPor === 'cnpj' ? 'CNPJ' : 'nome'}).`
                  : 'Não está no cadastro de fornecedores — vai com o nome como texto.'}
              </p>
              {lido.pagoNoAto && <p>Parece compra paga na hora (cupom). A baixa vem da conciliação do extrato.</p>}
              <p className="text-gray-400">Confira antes de salvar.</p>
              <button type="button" onClick={() => ler(arquivos)} disabled={ocupado}
                className="inline-flex items-center gap-1 pt-1 text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-50">
                <RotateCw className="w-3 h-3" /> Ler de novo
              </button>
            </div>
          )}
        </section>

        {/* ── lançamento ────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4 self-start">
          {lancadas.length > 0 && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2.5 text-sm">
              <p className="text-emerald-800">
                <Check className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                Deste documento já foram lançadas {lancadas.length} despesa(s):{' '}
                {lancadas.map(l => `${l.descricao} (R$ ${moeda(l.valor)})`).join(', ')}.
              </p>
              {restante > 0.009 && (
                <p className="text-emerald-700 text-xs mt-1">
                  {lido?.criterio
                    ? <>O restante do papel (<strong className="tabular-nums">R$ {moeda(restante)}</strong>) não estava marcado. Se for outra despesa da empresa, lance abaixo; se é compra pessoal, siga para o próximo documento.</>
                    : <>Faltam <strong className="tabular-nums">R$ {moeda(restante)}</strong> do total de R$ {moeda(lido!.valor!)}. Lance o restante abaixo, ou siga para o próximo documento se ele não é despesa da empresa.</>}
                </p>
              )}
              <button type="button" onClick={limpar}
                className="mt-2 text-xs font-medium text-emerald-800 hover:text-emerald-950 underline-offset-2 hover:underline transition-colors">
                Próximo documento
              </button>
            </div>
          )}
          <div>
            <label className={labelCls}>Fornecedor</label>
            <Select value={f.fornecedorId} onChange={v => set('fornecedorId', v)}
              options={[{ value: '', label: '— sem cadastro —' }, ...fornecedores.map(x => ({ value: x.id, label: x.nome }))]} />
            {!f.fornecedorId && (
              <input value={f.nomeLivre} onChange={e => set('nomeLivre', e.target.value)}
                placeholder="Nome de quem cobrou (ex.: Supermercado Muffato)" className={cn(inputCls, 'mt-2')} />
            )}
          </div>

          <div>
            <label className={labelCls}>Descrição <span className="text-red-500">*</span></label>
            <input value={f.descricao} onChange={e => set('descricao', e.target.value)}
              placeholder="o que foi comprado ou contratado" className={inputCls} />
          </div>

          {cronograma ? (
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
                <label className={cn(labelCls, 'mb-0')}>Parcelas do cronograma</label>
                <span className="text-xs text-gray-500 tabular-nums">
                  {escolhidas.length} de {cronograma.length} · <strong className="font-medium text-gray-800">R$ {moeda(somaEscolhidas)}</strong>
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-gray-100 divide-y divide-gray-50">
                {cronograma.map((p, i) => {
                  const vencida = !!hojeLeitura && p.vencimento < hojeLeitura
                  const marcada = selecao.has(i)
                  return (
                    <label key={i} className={cn('flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
                      marcada ? 'hover:bg-gray-50' : 'bg-gray-50/60 hover:bg-gray-50')}>
                      <input type="checkbox" checked={marcada} onChange={() => alternar(i)}
                        className="w-4 h-4 accent-orange-600 shrink-0" />
                      <span className="w-12 text-xs text-gray-500 tabular-nums">{p.numero ?? i + 1}/{Math.max(...cronograma.map(x => x.numero ?? 0)) || cronograma.length}</span>
                      <span className={cn('text-sm tabular-nums', marcada ? 'text-gray-800' : 'text-gray-400')}>
                        {p.vencimento.split('-').reverse().join('/')}
                      </span>
                      {(vencida || p.pago) && (
                        <span className="text-[11px] text-amber-700">{p.pago ? 'paga no documento' : 'vencida — já paga?'}</span>
                      )}
                      <span className={cn('ml-auto text-sm tabular-nums', marcada ? 'text-gray-900 font-medium' : 'text-gray-400 line-through')}>
                        R$ {moeda(p.valor)}
                      </span>
                    </label>
                  )
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                Cada parcela vira um lançamento em aberto, ligado aos outros como série. Parcela vencida começa desmarcada: o documento não diz se foi paga.
              </p>
            </div>
          ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Valor <span className="text-red-500">*</span></label>
              <input value={f.valor} onChange={e => set('valor', e.target.value)} inputMode="decimal"
                placeholder="0,00" className={cn(inputCls, 'text-right tabular-nums')} />
            </div>
            <div>
              <label className={labelCls}>{lido?.pagoNoAto ? 'Data da compra' : 'Vencimento'} <span className="text-red-500">*</span></label>
              <input type="date" value={f.vencimento} onChange={e => set('vencimento', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Nº da nota</label>
              <input value={f.numero} onChange={e => set('numero', e.target.value)} placeholder="opcional" className={inputCls} />
            </div>
          </div>
          )}

          <ClassificacaoFields tipo="saida" contas={contas} categorias={categorias} centros={centros}
            value={cls} onChange={p => setCls(c => ({ ...c, ...p }))} />

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {!cronograma && falta.length > 0 && (arquivos.length > 0 || f.descricao) && (
              <span className="mr-auto text-xs text-gray-400">Falta: {falta.join(', ')}</span>
            )}
            {(arquivos.length > 0 || f.descricao || f.valor) && (
              <button type="button" onClick={limpar} disabled={salvando}
                className="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">Limpar</button>
            )}
            <button type="button" onClick={cronograma ? salvarCronograma : salvar} disabled={salvando || ocupado}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 active:scale-[0.97] disabled:opacity-50 transition-colors">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {cronograma ? `Lançar ${escolhidas.length} parcela${escolhidas.length === 1 ? '' : 's'}` : 'Lançar despesa'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
