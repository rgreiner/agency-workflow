'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RotateCcw, Table2 } from 'lucide-react'
import { Select, MultiSelect } from '@/components/ui/Select'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { formatBRL, formatDateBR } from '@/lib/midia'
import { coresPorNome, type CategoriaGrupoLike } from '@/lib/finance-categorias'
import {
  aplicaFiltros, categoriasDoMacro, fimDoMes, limitesDoCubo, opcoesDeFiltro, pivot,
  rangeDoPreset, rotuloMes, totalDe, DIMENSOES, DIMENSOES_COLUNA, PRESETS,
  type Base, type Celula, type CuboRow, type Dim, type Filtros, type Preset, type TipoFiltro,
} from '@/lib/fin-cubo'
import { carregarMovimentosDrill, type FinanceCentro, type MovimentoDrill } from '@/app/actions/financeiro'

/** Preferências de view por usuário. Versionar a chave quando o default mudar. */
const PREF_KEY = 'flow.analise.v1'
/** Acima disso a tabela vira ilegível; o excedente vira a coluna "Outros". */
const MAX_COLUNAS = 14
const LINHAS_INICIAIS = 25

/** Realizado sólido, previsto claro — a mesma convenção do gráfico do Fluxo. */
const TOM = {
  despesa: { forte: '#ef4444', fraco: '#fecaca' },
  receita: { forte: '#22c55e', fraco: '#a7f3d0' },
} as const

const TIPOS: { value: TipoFiltro; label: string }[] = [
  { value: 'despesa', label: 'Pagamentos' },
  { value: 'receita', label: 'Recebimentos' },
]
const BASES: { value: Base; label: string; hint: string }[] = [
  { value: 'caixa', label: 'Caixa', hint: 'Pela data em que o dinheiro andou (previsto entra no vencimento)' },
  { value: 'competencia', label: 'Competência', hint: 'Pelo mês a que o valor se refere' },
]

interface Prefs {
  base: Base; tipo: TipoFiltro; situacoes: string[]
  linhaDim: Dim; colunaDim: Dim; preset: Preset
}
const PREFS_PADRAO: Prefs = {
  base: 'caixa', tipo: 'despesa', situacoes: ['realizado', 'previsto'],
  linhaDim: 'categoria', colunaDim: 'mes', preset: 'ultimos12',
}

export function AnaliseClient({ orgSlug, rows, categorias, centros }: {
  orgSlug: string
  rows: CuboRow[]
  categorias: CategoriaGrupoLike[]
  centros: FinanceCentro[]
}) {
  const [prefs, setPrefs] = useState<Prefs>(PREFS_PADRAO)
  const [prontas, setProntas] = useState(false)
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [selCategorias, setSelCategorias] = useState<string[]>([])
  const [selCentros, setSelCentros] = useState<string[]>([])
  const [selContatos, setSelContatos] = useState<string[]>([])
  const [selContas, setSelContas] = useState<string[]>([])
  const [ordenarPor, setOrdenarPor] = useState<number | null>(null)
  const [limite, setLimite] = useState(LINHAS_INICIAIS)
  const [drill, setDrill] = useState<{ titulo: string; linhas: MovimentoDrill[] } | null>(null)
  const [carregandoDrill, setCarregandoDrill] = useState(false)

  const limites = useMemo(() => limitesDoCubo(rows, prefs.base), [rows, prefs.base])

  // As preferências e o período dependem do relógio/localStorage — resolver no
  // efeito, não no primeiro render, senão o servidor e o cliente divergem.
  useEffect(() => {
    let p = PREFS_PADRAO
    try {
      const cru = localStorage.getItem(PREF_KEY)
      if (cru) p = { ...PREFS_PADRAO, ...(JSON.parse(cru) as Partial<Prefs>) }
    } catch { /* preferência corrompida não pode derrubar a tela */ }
    if (p.situacoes.length === 0) p = { ...p, situacoes: PREFS_PADRAO.situacoes }
    const r = rangeDoPreset(p.preset === 'custom' ? 'ultimos12' : p.preset, new Date(), limites)
    /* eslint-disable react-hooks/set-state-in-effect */
    setPrefs(p)
    setDe(r.de); setAte(r.ate)
    setProntas(true)
    /* eslint-enable react-hooks/set-state-in-effect */
    // Só na montagem: depois disso quem manda no período é o usuário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!prontas) return
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)) } catch { /* modo privado */ }
  }, [prefs, prontas])

  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs(p => ({ ...p, [k]: v }))

  function trocaPreset(p: Preset) {
    setPref('preset', p)
    if (p === 'custom') return
    const r = rangeDoPreset(p, new Date(), limites)
    setDe(r.de); setAte(r.ate)
  }

  const filtros: Filtros = useMemo(() => ({
    base: prefs.base, de, ate, tipo: prefs.tipo, situacoes: prefs.situacoes,
    categorias: selCategorias, centros: selCentros, contatos: selContatos, contas: selContas,
  }), [prefs, de, ate, selCategorias, selCentros, selContatos, selContas])

  const opcoes = useMemo(() => opcoesDeFiltro(rows, filtros), [rows, filtros])
  const filtradas = useMemo(() => aplicaFiltros(rows, filtros), [rows, filtros])

  const cores = useMemo(() => {
    const m = coresPorNome(categorias)
    for (const c of centros) if (c.cor) m.set(c.nome.toLowerCase(), c.cor)
    return m
  }, [categorias, centros])

  const p = useMemo(() => pivot(filtradas, {
    linha: prefs.linhaDim, coluna: prefs.colunaDim, base: prefs.base,
    categorias, cores, ordenarPor, maxColunas: MAX_COLUNAS,
  }), [filtradas, prefs.linhaDim, prefs.colunaDim, prefs.base, categorias, cores, ordenarPor])

  const tom = TOM[prefs.tipo === 'receita' ? 'receita' : 'despesa']
  const geral = totalDe(p.total)
  const mostraSplit = prefs.situacoes.length > 1

  // Meses disponíveis para o período personalizado.
  const mesesOpts = useMemo(() => {
    const out: { value: string; label: string }[] = []
    for (let m = limites.max; m >= limites.min; m = addMesLocal(m, -1)) out.push({ value: m, label: rotuloMes(m) })
    return out
  }, [limites])

  function limpar() {
    setSelCategorias([]); setSelCentros([]); setSelContatos([]); setSelContas([])
    setOrdenarPor(null); setLimite(LINHAS_INICIAIS)
  }

  const filtrosAtivos = selCategorias.length + selCentros.length + selContatos.length + selContas.length

  /** Abre os lançamentos por trás de uma célula (ou de uma linha inteira). */
  async function abrirDrill(linhaKey: string, colunaKey: string | null) {
    if (carregandoDrill) return
    const f = { ...filtros }
    let deDrill = de, ateDrill = ate
    const titulo: string[] = []

    const aplicaDim = (dim: Dim, key: string) => {
      switch (dim) {
        case 'categoria': f.categorias = [key]; titulo.push(key); break
        case 'macro':
          f.categorias = categoriasDoMacro(filtradas, key, prefs.base, categorias)
          titulo.push(key); break
        case 'contato': f.contatos = [key]; titulo.push(key); break
        case 'centro_custo': f.centros = [key]; titulo.push(key); break
        case 'conta': f.contas = [key]; titulo.push(key); break
        case 'mes': deDrill = key; ateDrill = key; titulo.push(rotuloMes(key)); break
        case 'ano': deDrill = `${key}-01`; ateDrill = `${key}-12`; titulo.push(key); break
        case 'nenhum': break
      }
    }
    aplicaDim(prefs.linhaDim, linhaKey)
    if (colunaKey != null) aplicaDim(prefs.colunaDim, colunaKey)

    setCarregandoDrill(true)
    const r = await carregarMovimentosDrill(orgSlug, {
      base: prefs.base,
      de: `${deDrill}-01`,
      ate: fimDoMes(ateDrill),
      tipos: [prefs.tipo],
      situacoes: prefs.situacoes,
      categorias: f.categorias, centros: f.centros, contatos: f.contatos, contas: f.contas,
    })
    setCarregandoDrill(false)
    if ('error' in r && r.error) { toast.error(`Não foi possível abrir os lançamentos: ${r.error}`); return }
    setDrill({ titulo: titulo.join(' · ') || 'Lançamentos', linhas: r.linhas ?? [] })
  }

  if (rows.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-gray-900 mb-1">Análise financeira</h1>
        <div className="mt-8 text-center py-20 bg-white rounded-2xl border border-gray-200">
          <Table2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">Nenhum movimento ainda</h3>
          <p className="text-gray-500 text-sm mt-1">Importe o extrato ou lance no livro-caixa para analisar.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Análise financeira</h1>
        <p className="text-gray-500 text-sm mt-0.5">Cruze categoria, centro de custo e fornecedor no período que quiser</p>
      </div>

      {/* ── Filtros ─────────────────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex bg-gray-100 rounded-xl p-0.5">
            {TIPOS.map(t => (
              <button key={t.value} onClick={() => { setPref('tipo', t.value); limpar() }} aria-pressed={prefs.tipo === t.value}
                className={`px-4 py-1.5 text-sm font-medium rounded-[10px] transition-colors ${prefs.tipo === t.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="w-44"><Select value={prefs.preset} onChange={v => trocaPreset(v as Preset)} options={PRESETS} /></div>
          {prefs.preset === 'custom' && (
            <div className="flex items-center gap-2">
              <div className="w-28"><Select value={de} onChange={v => { setDe(v > ate ? ate : v) }} options={mesesOpts} /></div>
              <span className="text-gray-400 text-sm">até</span>
              <div className="w-28"><Select value={ate} onChange={v => { setAte(v < de ? de : v) }} options={mesesOpts} /></div>
            </div>
          )}

          <div className="inline-flex bg-gray-100 rounded-xl p-0.5">
            {BASES.map(b => (
              <button key={b.value} onClick={() => setPref('base', b.value)} aria-pressed={prefs.base === b.value} title={b.hint}
                className={`px-3 py-1.5 text-sm font-medium rounded-[10px] transition-colors ${prefs.base === b.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {b.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {(['realizado', 'previsto'] as const).map(s => {
              const on = prefs.situacoes.includes(s)
              return (
                <button key={s} aria-pressed={on}
                  onClick={() => {
                    const novo = on ? prefs.situacoes.filter(x => x !== s) : [...prefs.situacoes, s]
                    // Desligar as duas deixaria a tela vazia sem explicar por quê.
                    if (novo.length === 0) return
                    setPref('situacoes', novo)
                  }}
                  className={`inline-flex items-center gap-2 pl-2 pr-3 py-1.5 text-sm font-medium rounded-xl border transition-colors ${on ? 'bg-white border-gray-300 text-gray-900' : 'bg-gray-50 border-transparent text-gray-400'}`}>
                  <span className="w-3 h-3 rounded-[4px] border" style={{
                    background: on ? (s === 'realizado' ? tom.forte : tom.fraco) : 'transparent',
                    borderColor: s === 'realizado' ? tom.forte : tom.fraco,
                  }} />
                  {s === 'realizado' ? 'Realizado' : 'Previsto'}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-56"><MultiSelect values={selCategorias} onChange={setSelCategorias} options={opcoes.categorias} allLabel="Todas as categorias" /></div>
          <div className="w-52"><MultiSelect values={selCentros} onChange={setSelCentros} options={opcoes.centros} allLabel="Todos os centros de custo" /></div>
          <div className="w-56"><MultiSelect values={selContatos} onChange={setSelContatos} options={opcoes.contatos} allLabel={prefs.tipo === 'receita' ? 'Todos os clientes' : 'Todos os fornecedores'} /></div>
          <div className="w-44"><MultiSelect values={selContas} onChange={setSelContas} options={opcoes.contas} allLabel="Todas as contas" /></div>
          {filtrosAtivos > 0 && (
            <button onClick={limpar} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">
              <RotateCcw className="w-3.5 h-3.5" /> Limpar ({filtrosAtivos})
            </button>
          )}
        </div>
      </section>

      {/* ── Totais ──────────────────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-4 gap-3">
        <Kpi label={prefs.tipo === 'receita' ? 'Total recebimentos' : 'Total pagamentos'} valor={geral} destaque />
        <Kpi label="Realizado" valor={p.total.realizado} cor={tom.forte} />
        <Kpi label="Previsto" valor={p.total.previsto} cor={tom.fraco} />
        <Kpi label="Lançamentos" valor={p.total.qtd} contagem />
      </div>

      {/* ── Tabela dinâmica ─────────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-2xl">
        <div className="flex items-center gap-3 flex-wrap p-4 border-b border-gray-100">
          <span className="text-sm text-gray-500">Linhas</span>
          <div className="w-52">
            <Select value={prefs.linhaDim} onChange={v => { setPref('linhaDim', v as Dim); setOrdenarPor(null); setLimite(LINHAS_INICIAIS) }} options={DIMENSOES} />
          </div>
          <span className="text-sm text-gray-500">Colunas</span>
          <div className="w-52">
            <Select value={prefs.colunaDim} onChange={v => { setPref('colunaDim', v as Dim); setOrdenarPor(null) }} options={DIMENSOES_COLUNA} />
          </div>
          <span className="text-xs text-gray-400 ml-auto">Clique numa célula para ver os lançamentos</span>
        </div>

        {p.linhas.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">Nenhum movimento no período com esses filtros.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500">
                  <th className="sticky left-0 bg-white text-left font-medium px-4 py-2.5 min-w-[220px] z-10">
                    {DIMENSOES.find(d => d.value === prefs.linhaDim)?.label}
                  </th>
                  {p.colunas.map((c, i) => (
                    <th key={c.key} className="text-right font-medium px-3 py-2.5 whitespace-nowrap">
                      {prefs.colunaDim === 'nenhum' || c.key === '__outros__' ? (
                        <span>{c.label}</span>
                      ) : (
                        <button onClick={() => setOrdenarPor(ordenarPor === i ? null : i)}
                          className={`transition-colors ${ordenarPor === i ? 'text-gray-900 font-semibold' : 'hover:text-gray-800'}`}>
                          {c.label}
                        </button>
                      )}
                    </th>
                  ))}
                  <th className="text-right font-medium px-4 py-2.5 whitespace-nowrap">
                    <button onClick={() => setOrdenarPor(null)}
                      className={`transition-colors ${ordenarPor === null ? 'text-gray-900 font-semibold' : 'hover:text-gray-800'}`}>Total</button>
                  </th>
                  <th className="text-right font-medium px-4 py-2.5 w-16">%</th>
                </tr>
              </thead>
              <tbody>
                {p.linhas.slice(0, limite).map(l => (
                  <tr key={l.key} className="border-t border-gray-100 hover:bg-gray-50/70 transition-colors">
                    <td className="sticky left-0 bg-white hover:bg-gray-50/70 px-4 py-2 z-10">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: l.cor ?? '#d1d5db' }} />
                        <span className="text-gray-900 truncate" title={l.label}>{l.label}</span>
                      </div>
                      <div className="h-1 mt-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(totalDe(l.total) / p.maxLinha) * 100}%`, background: tom.forte }} />
                      </div>
                    </td>
                    {l.celulas.map((c, i) => (
                      <td key={i} className="text-right px-3 py-2 whitespace-nowrap">
                        <CelulaValor c={c} tom={tom} split={mostraSplit}
                          onClick={p.colunas[i].key === '__outros__' ? undefined : () => abrirDrill(l.key, p.colunas[i].key)} />
                      </td>
                    ))}
                    <td className="text-right px-4 py-2 font-medium text-gray-900 whitespace-nowrap">
                      <CelulaValor c={l.total} tom={tom} split={mostraSplit} onClick={() => abrirDrill(l.key, null)} />
                    </td>
                    <td className="text-right px-4 py-2 text-gray-400 text-xs">
                      {geral > 0 ? `${((totalDe(l.total) / geral) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-semibold text-gray-900">
                  <td className="sticky left-0 bg-white px-4 py-2.5 z-10">Total</td>
                  {p.totalColunas.map((c, i) => (
                    <td key={i} className="text-right px-3 py-2.5 whitespace-nowrap">{fmt(totalDe(c))}</td>
                  ))}
                  <td className="text-right px-4 py-2.5 whitespace-nowrap">{fmt(geral)}</td>
                  <td className="text-right px-4 py-2.5 text-gray-400 text-xs">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {p.linhas.length > limite && (
          <div className="p-3 text-center border-t border-gray-100">
            <button onClick={() => setLimite(p.linhas.length)} className="text-sm text-orange-600 hover:text-orange-700 font-medium transition-colors">
              Mostrar todas as {p.linhas.length} linhas
            </button>
          </div>
        )}
      </section>

      {carregandoDrill && (
        <div className="fixed bottom-6 right-6 inline-flex items-center gap-2 bg-gray-900 text-[#fff] text-sm px-3 py-2 rounded-xl shadow-lg">
          <Loader2 className="w-4 h-4 animate-spin" /> Buscando lançamentos…
        </div>
      )}

      <Modal open={!!drill} onClose={() => setDrill(null)} size="full" label="Lançamentos">
        <ModalHeader title={drill?.titulo ?? ''} onClose={() => setDrill(null)} />
        <div className="max-h-[65vh] overflow-y-auto">
          {drill && drill.linhas.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-gray-500">Nenhum lançamento nesse recorte.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-gray-500 border-b border-gray-100">
                  <th className="text-left font-medium px-6 py-2">Data</th>
                  <th className="text-left font-medium px-3 py-2">Descrição</th>
                  <th className="text-left font-medium px-3 py-2">{prefs.tipo === 'receita' ? 'Cliente' : 'Fornecedor'}</th>
                  <th className="text-left font-medium px-3 py-2">Categoria</th>
                  <th className="text-right font-medium px-6 py-2">Valor</th>
                </tr>
              </thead>
              <tbody>
                {drill?.linhas.map((m, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-6 py-2 whitespace-nowrap text-gray-500">
                      {formatDateBR(m.data)}
                      {m.situacao === 'previsto' && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400">prev.</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-900 max-w-[280px] truncate" title={m.descricao ?? ''}>{m.descricao ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-[180px] truncate" title={m.contato ?? ''}>{m.contato ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-[200px] truncate" title={m.categoria ?? ''}>{m.categoria ?? '—'}</td>
                    <td className="px-6 py-2 text-right whitespace-nowrap font-medium text-gray-900">{formatBRL(m.valor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-gray-900">
                  <td className="px-6 py-3" colSpan={4}>{drill?.linhas.length} lançamento(s)</td>
                  <td className="px-6 py-3 text-right">{formatBRL((drill?.linhas ?? []).reduce((s, m) => s + m.valor, 0))}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </Modal>
    </div>
  )
}

/** 'YYYY-MM' + n meses — cópia local para não importar o módulo inteiro no loop. */
function addMesLocal(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Sem centavos: numa tabela de 14 colunas o centavo só rouba largura. */
const fmt = (v: number) =>
  v === 0 ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v)

function CelulaValor({ c, tom, split, onClick }: {
  c: Celula
  tom: { forte: string; fraco: string }
  split: boolean
  onClick?: () => void
}) {
  const t = totalDe(c)
  if (t === 0) return <span className="text-gray-300">—</span>
  const pctPrevisto = (c.previsto / t) * 100
  const conteudo = (
    <>
      <span className={c.realizado === 0 ? 'text-gray-500' : 'text-gray-900'}>{fmt(t)}</span>
      {split && c.previsto > 0 && (
        <span className="block h-[3px] mt-1 rounded-full overflow-hidden bg-gray-100">
          <span className="block h-full float-right" style={{ width: `${pctPrevisto}%`, background: tom.fraco }} />
          <span className="block h-full" style={{ width: `${100 - pctPrevisto}%`, background: tom.forte }} />
        </span>
      )}
    </>
  )
  if (!onClick) return <span className="inline-block min-w-[56px]">{conteudo}</span>
  return (
    <button onClick={onClick} title={split ? `Realizado ${formatBRL(c.realizado)} · Previsto ${formatBRL(c.previsto)}` : formatBRL(t)}
      className="inline-block min-w-[56px] text-right hover:underline decoration-gray-300 underline-offset-4 transition-colors">
      {conteudo}
    </button>
  )
}

function Kpi({ label, valor, cor, destaque, contagem }: {
  label: string; valor: number; cor?: string; destaque?: boolean; contagem?: boolean
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
      <div className="flex items-center gap-2">
        {cor && <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: cor }} />}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className={`mt-1 font-semibold text-gray-900 ${destaque ? 'text-xl' : 'text-lg'}`}>
        {contagem ? new Intl.NumberFormat('pt-BR').format(valor) : formatBRL(valor)}
      </p>
    </div>
  )
}
