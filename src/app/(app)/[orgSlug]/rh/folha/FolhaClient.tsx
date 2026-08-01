'use client'

import { useState, useMemo, useRef, useEffect, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Wallet, Upload, Loader2, Check, X, Users, Landmark, Link2, Plus, AlertTriangle, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '@/components/ui/Select'
import { formatBRL, parseMoney } from '@/lib/midia'
import { importarFolha, carregarPlanoFolha, aplicarFolhaFinanceiro, type PlanoPessoa, type PlanoGuia, type AplicarSalario } from '@/app/actions/rh'

export interface FolhaRow {
  competencia: string; nome: string | null; liquido: number | string | null
  vencimentos: number | string | null; descontos: number | string | null
  inss: number | string | null; fgts: number | string | null; colaborador_id: string | null
  cpf: string | null; tratamento: string | null
}
interface LinhaExtraida {
  matricula?: string; nome?: string; cpf?: string; cargo?: string; categoria?: string; data_admissao?: string
  salario_base?: number; vencimentos?: number; descontos?: number; inss?: number; irrf?: number
  fgts?: number; vale_refeicao?: number; faltas?: number; liquido?: number
  tratamento?: Tratamento
}

/** Como a linha entra no Financeiro: salário (gera remuneração) ou sócio (só guias). */
type Tratamento = 'salario' | 'socio'
const soDigitos = (s?: string | null) => (s ?? '').replace(/\D/g, '')
const ehSocioCategoria = (cat?: string) => /722|individual/i.test(cat ?? '')

const n = (v: number | string | null | undefined) => Number(v ?? 0)
const compLabel = (c: string) => { const [y, m] = c.split('-'); return `${m}/${y}` }

interface CompAgg { competencia: string; liquido: number; vencimentos: number; fgts: number; pessoas: number }

export function FolhaClient({ orgSlug, linhas }: { orgSlug: string; linhas: FolhaRow[] }) {
  const [preview, setPreview] = useState<{ competencia: string; linhas: LinhaExtraida[] } | null>(null)
  const [reconc, setReconc] = useState<CompAgg | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const competencias = useMemo(() => {
    const map = new Map<string, { liquido: number; vencimentos: number; fgts: number; pessoas: number }>()
    for (const l of linhas) {
      const cur = map.get(l.competencia) ?? { liquido: 0, vencimentos: 0, fgts: 0, pessoas: 0 }
      cur.liquido += n(l.liquido); cur.vencimentos += n(l.vencimentos); cur.fgts += n(l.fgts); cur.pessoas += 1
      map.set(l.competencia, cur)
    }
    return [...map.entries()].map(([competencia, v]) => ({ competencia, ...v })).sort((a, b) => b.competencia.localeCompare(a.competencia))
  }, [linhas])

  const maxLiq = Math.max(1, ...competencias.map(c => c.liquido))

  async function onPick(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('orgSlug', orgSlug); fd.append('file', file)
      const res = await fetch('/api/rh/folha/extract', { method: 'POST', body: fd })
      const j = await res.json()
      if (!res.ok) { toast.error(j.error || 'Falha na extração'); return }
      const comp: string | null = j.competencia
      setPreview({ competencia: comp || '', linhas: j.linhas || [] })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Falha na extração') }
    finally { setUploading(false) }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Wallet className="w-5 h-5 text-orange-600" /> Folha</h1>
          <p className="text-gray-500 text-sm mt-0.5">Importe a folha da contabilidade (PDF); a IA extrai e casa por CPF.</p>
        </div>
        <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
          onChange={e => { const x = e.target.files?.[0]; if (x) onPick(x); e.target.value = '' }} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {uploading ? 'Lendo…' : 'Importar folha (PDF)'}
        </button>
      </div>

      {competencias.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">Nenhuma folha importada. Suba o PDF da contabilidade.</div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-xs text-gray-400">
              <th className="text-left px-4 py-3 font-medium">Competência</th>
              <th className="text-left px-4 py-3 font-medium">Pessoas</th>
              <th className="text-right px-4 py-3 font-medium">Líquido</th>
              <th className="text-right px-4 py-3 font-medium">FGTS</th>
              <th className="text-left px-4 py-3 font-medium w-1/4">Evolução</th>
              <th className="px-4 py-3" />
            </tr></thead>
            <tbody>
              {competencias.map(c => (
                <tr key={c.competencia} className="border-b border-gray-50 last:border-0 hover:bg-orange-50/40 transition">
                  <td className="px-4 py-3 font-medium text-gray-900 tabular-nums">{compLabel(c.competencia)}</td>
                  <td className="px-4 py-3 text-gray-500"><span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" />{c.pessoas}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">{formatBRL(c.liquido)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">{formatBRL(c.fgts)}</td>
                  <td className="px-4 py-3">
                    <div className="h-2 rounded-full bg-orange-100 overflow-hidden"><div className="h-full bg-orange-500 rounded-full" style={{ width: `${Math.round((c.liquido / maxLiq) * 100)}%` }} /></div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setReconc(c)} title="Gerar lançamentos no Financeiro"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-600 hover:bg-gray-100 transition">
                      <Landmark className="w-3.5 h-3.5" /> Financeiro
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && <PreviewModal orgSlug={orgSlug} data={preview} existentes={linhas} onClose={() => setPreview(null)} />}
      {reconc && <ReconcModal orgSlug={orgSlug} comp={reconc} onClose={() => setReconc(null)} />}
    </div>
  )
}

/** Último dia ÚTIL do mês da competência (salários são pagos nele). */
function vencSalarios(comp: string): string {
  const [y, m] = comp.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0))            // último dia do mês
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
/** INSS/FGTS: dia 20 do mês seguinte (recebe a guia dia 10, paga dia 20). */
function vencEncargos(comp: string): string {
  const [y, m] = comp.split('-').map(Number)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  return `${ny}-${String(nm).padStart(2, '0')}-20`
}

const ddmm = (iso: string | null) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''

/** O que vai acontecer com o provisionado da guia (Darf/FGTS) ao aplicar. */
function GuiaHint({ guia }: { guia?: PlanoGuia }) {
  if (!guia || guia.status === 'novo') {
    return <p className="text-[11px] text-amber-600 mt-1">sem provisionado no mês seguinte — cria um lançamento novo</p>
  }
  if (guia.status === 'vinculado') {
    return <p className="text-[11px] text-emerald-600 mt-1">já vinculado · {guia.situacao === 'em_aberto' ? 'reprocessar atualiza o valor' : 'já pago — não muda'}</p>
  }
  return (
    <p className="text-[11px] text-sky-700 mt-1">
      atualiza o provisionado “{guia.descricao}” de {formatBRL(n(guia.valor))} ({ddmm(guia.venc)})
    </p>
  )
}

type Acao = 'vincular' | 'criar' | 'ignorar'
const money = 'w-32 px-3 py-1.5 text-sm text-right bg-gray-100 border border-transparent rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'
const dateI = 'px-3 py-1.5 text-sm bg-gray-100 border border-transparent rounded-lg text-gray-800'

function ReconcModal({ orgSlug, comp, onClose }: { orgSlug: string; comp: CompAgg; onClose: () => void }) {
  const router = useRouter()
  const [plano, setPlano] = useState<{ salarios: PlanoPessoa[]; socios: { nome: string }[]; guias?: { inss: PlanoGuia; fgts: PlanoGuia } } | null>(null)
  const [loading, setLoading] = useState(true)
  const [acoes, setAcoes] = useState<Record<string, Acao>>({})
  const [inss, setInss] = useState('')
  const [vInss, setVInss] = useState(vencEncargos(comp.competencia))
  const [fgts, setFgts] = useState(comp.fgts > 0 ? formatBRL(comp.fgts).replace('R$', '').trim() : '')
  const [vFgts, setVFgts] = useState(vencEncargos(comp.competencia))
  const [saving, start] = useTransition()
  const [down, setDown] = useState(false)

  const carregar = useCallback(async () => {
    const r = await carregarPlanoFolha(orgSlug, comp.competencia)
    if (r?.error) { toast.error(r.error); setLoading(false); return }
    const p = r?.plano
    setPlano({ salarios: p?.salarios ?? [], socios: p?.socios ?? [], guias: p?.guias })
    // Default: achou → vincular; não achou → criar; já vinculado → nada a fazer.
    const ini: Record<string, Acao> = {}
    for (const s of p?.salarios ?? []) {
      const k = s.colaborador_id ?? s.nome
      ini[k] = s.status === 'achado' ? 'vincular' : s.status === 'novo' ? 'criar' : 'ignorar'
    }
    setAcoes(ini)
    // Palpite das guias vem da própria folha (Darf = INSS+IRRF; FGTS = soma).
    // O valor real chega com a guia dia 10 — reprocessar atualiza o em aberto.
    const brl = (v: number) => formatBRL(v).replace('R$', '').trim()
    if (n(p?.palpite_inss) > 0) setInss(brl(n(p?.palpite_inss)))
    if (n(p?.palpite_fgts) > 0) setFgts(brl(n(p?.palpite_fgts)))
    if (p?.guias?.inss?.venc) setVInss(p.guias.inss.venc)
    if (p?.guias?.fgts?.venc) setVFgts(p.guias.fgts.venc)
    setLoading(false)
  }, [orgSlug, comp.competencia])

  // O plano vem do servidor (read-only) ao abrir a modal.
  useEffect(() => { carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  function aplicar() {
    const salarios: AplicarSalario[] = (plano?.salarios ?? []).map(s => {
      const k = s.colaborador_id ?? s.nome
      return {
        colaborador_id: s.colaborador_id, nome: s.nome, acao: acoes[k] ?? 'ignorar',
        lancamento_id: s.lancamento_id, valor: s.liquido, venc: vencSalarios(comp.competencia),
      }
    })
    start(async () => {
      const r = await aplicarFolhaFinanceiro(orgSlug, {
        competencia: comp.competencia, salarios,
        inss: parseMoney(inss), vencInss: vInss, fgts: parseMoney(fgts), vencFgts: vFgts,
        inssLanc: plano?.guias?.inss?.lancamento_id ?? null,
        fgtsLanc: plano?.guias?.fgts?.lancamento_id ?? null,
      })
      if (r?.error) { toast.error(r.error); return }
      const x = r.resultado
      toast.success(`${x?.vinculados ?? 0} vinculado(s) · ${x?.criados ?? 0} criado(s) · ${x?.guias ?? 0} guia(s).`)
      onClose(); router.refresh()
    })
  }

  const setAcao = (k: string, a: Acao) => setAcoes(p => ({ ...p, [k]: a }))
  const totalFolha = (plano?.salarios ?? []).reduce((s, p) => s + n(p.liquido), 0)

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onMouseDown={() => setDown(true)}
      onClick={e => { if (down && e.target === e.currentTarget) onClose(); setDown(false) }}>
      <div className="modal-card w-full max-w-3xl max-h-[90vh] overflow-hidden bg-white rounded-2xl shadow-xl border border-gray-200 flex flex-col" onMouseDown={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Financeiro — {compLabel(comp.competencia)}</h2>
          <p className="text-xs text-gray-500 mt-0.5">Previsto → realizado: acha o custo provisionado da pessoa no mês e atualiza pro valor da folha; se não achar, cria. Sócios não recebem salário — só as guias.</p>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <p className="text-sm text-gray-400 py-8 text-center">Buscando lançamentos…</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-700">Salários por pessoa</h3>
                <span className="text-xs text-gray-400">{plano?.salarios.length ?? 0} pessoas · <b className="text-gray-700 tabular-nums">{formatBRL(totalFolha)}</b></span>
              </div>
              <div className="rounded-xl border border-gray-200 divide-y divide-gray-50 mb-5">
                {(plano?.salarios ?? []).map(s => {
                  const k = s.colaborador_id ?? s.nome
                  const acao = acoes[k] ?? 'ignorar'
                  const diverge = s.lanc_valor != null && Math.abs(n(s.lanc_valor) - n(s.liquido)) > 0.005
                  return (
                    <div key={k} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">{s.nome}</div>
                          <div className="text-xs text-gray-500 tabular-nums">
                            folha <b className="text-gray-700">{formatBRL(n(s.liquido))}</b>
                            {s.status === 'vinculado' && <span className="text-emerald-600"> · já vinculado</span>}
                            {s.status === 'achado' && <span className="text-sky-600"> · provisionado de {formatBRL(n(s.lanc_valor))}</span>}
                            {s.status === 'novo' && <span className="text-amber-600"> · sem provisionado no mês</span>}
                          </div>
                          {diverge && s.status === 'achado' && (s.lanc_situacao === 'em_aberto' ? (
                            <div className="text-[11px] text-sky-700 mt-1 flex items-center gap-1">
                              <Link2 className="w-3 h-3" /> vincular atualiza o provisionado para {formatBRL(n(s.liquido))} (diferença de {formatBRL(Math.abs(n(s.lanc_valor) - n(s.liquido)))})
                            </div>
                          ) : (
                            <div className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> lançamento já pago — vincular só carimba a origem, sem alterar o valor
                            </div>
                          ))}
                        </div>
                        {s.status === 'vinculado' ? (
                          <span className="text-xs text-emerald-600 inline-flex items-center gap-1 shrink-0"><Check className="w-3.5 h-3.5" /> ok</span>
                        ) : (
                          <div className="flex items-center gap-1 shrink-0">
                            {s.status === 'achado' && (
                              <button onClick={() => setAcao(k, 'vincular')}
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition active:scale-[0.97] ${acao === 'vincular' ? 'bg-sky-600 text-[#fff]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                <Link2 className="w-3.5 h-3.5" /> Vincular
                              </button>
                            )}
                            <button onClick={() => setAcao(k, 'criar')}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition active:scale-[0.97] ${acao === 'criar' ? 'bg-orange-600 text-[#fff]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                              <Plus className="w-3.5 h-3.5" /> Criar
                            </button>
                            <button onClick={() => setAcao(k, 'ignorar')} title="Não fazer nada"
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition active:scale-[0.97] ${acao === 'ignorar' ? 'bg-gray-700 text-[#fff]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {!!plano?.socios.length && (
                <div className="rounded-xl bg-gray-50 px-4 py-3 mb-5">
                  <div className="text-xs font-medium text-gray-600 mb-1">Sócios (pró-labore) — sem lançamento de salário</div>
                  <div className="text-xs text-gray-500">{plano.socios.map(s => s.nome).join(' · ')}</div>
                  <div className="text-[11px] text-gray-400 mt-1">As guias abaixo já incluem a parte deles.</div>
                </div>
              )}

              <h3 className="text-sm font-semibold text-gray-700 mb-2">Guias (consolidadas)</h3>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div><span className="text-sm text-gray-700">INSS + IRRF (Darf)</span> <span className="text-[11px] text-gray-400">valor da guia · paga dia 20</span></div>
                    <div className="flex items-center gap-2">
                      <input inputMode="decimal" value={inss} onChange={e => setInss(e.target.value)} placeholder="da guia" className={money} />
                      <input type="date" value={vInss} onChange={e => setVInss(e.target.value)} className={dateI} />
                    </div>
                  </div>
                  <GuiaHint guia={plano?.guias?.inss} />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div><span className="text-sm text-gray-700">FGTS</span> <span className="text-[11px] text-gray-400">valor da guia · paga dia 20</span></div>
                    <div className="flex items-center gap-2">
                      <input inputMode="decimal" value={fgts} onChange={e => setFgts(e.target.value)} className={money} />
                      <input type="date" value={vFgts} onChange={e => setVFgts(e.target.value)} className={dateI} />
                    </div>
                  </div>
                  <GuiaHint guia={plano?.guias?.fgts} />
                </div>
                <p className="text-[11px] text-gray-400">Valores pré-preenchidos com o palpite da própria folha — confira com a guia (chega dia 10). Deixe zerado o que não quiser gerar. Reprocessar atualiza só o que está em aberto (não duplica nem mexe no que já foi pago).</p>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button onClick={aplicar} disabled={saving || loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Landmark className="w-4 h-4" />} Aplicar
          </button>
        </div>
      </div>
    </div>
  )
}

function PreviewModal({ orgSlug, data, existentes, onClose }: {
  orgSlug: string; data: { competencia: string; linhas: LinhaExtraida[] }
  existentes: FolhaRow[]; onClose: () => void
}) {
  const router = useRouter()
  const [competencia, setCompetencia] = useState(data.competencia)
  const [autoCriar, setAutoCriar] = useState(true)
  const [saving, start] = useTransition()
  // Salário × sócio por linha: herda a escolha já gravada da mesma competência
  // (reimportação preserva); linha nova cai na heurística da categoria (722).
  const [tratamentos, setTratamentos] = useState<Record<number, Tratamento>>(() => {
    const comp = data.competencia ? `${data.competencia}-01` : ''
    const porCpf = new Map(existentes
      .filter(e => e.competencia === comp && soDigitos(e.cpf))
      .map(e => [soDigitos(e.cpf), e.tratamento]))
    const ini: Record<number, Tratamento> = {}
    data.linhas.forEach((l, i) => {
      const gravado = porCpf.get(soDigitos(l.cpf))
      ini[i] = gravado === 'salario' || gravado === 'socio' ? gravado
        : ehSocioCategoria(l.categoria) ? 'socio' : 'salario'
    })
    return ini
  })

  const totalLiq = data.linhas.reduce((s, l) => s + n(l.liquido), 0)
  const nSocios = Object.values(tratamentos).filter(t => t === 'socio').length

  function importar() {
    if (!/^\d{4}-\d{2}$/.test(competencia)) { toast.error('Informe a competência (AAAA-MM).'); return }
    start(async () => {
      const linhas = data.linhas.map((l, i) => ({ ...l, tratamento: tratamentos[i] ?? 'salario' }))
      const r = await importarFolha(orgSlug, competencia, linhas, autoCriar)
      if (r?.error) { toast.error(r.error); return }
      const res = r.resultado
      toast.success(`Folha importada: ${res?.linhas} linhas · ${res?.criados} criados · ${res?.casados} casados.`)
      onClose(); router.refresh()
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-3xl max-h-[90vh] overflow-hidden bg-white rounded-2xl shadow-xl border border-gray-200 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Conferir folha extraída</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4 flex items-center gap-4 border-b border-gray-100 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Competência</label>
            <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)}
              className="px-3 py-1.5 text-sm bg-gray-100 border border-transparent rounded-lg text-gray-800" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={autoCriar} onChange={e => setAutoCriar(e.target.checked)} className="rounded text-orange-600 focus:ring-orange-500" />
            Criar ficha de quem ainda não existe (casa por CPF)
          </label>
          <div className="ml-auto text-sm text-gray-500">
            {data.linhas.length} pessoas · líquido <b className="text-gray-900 tabular-nums">{formatBRL(totalLiq)}</b>
            {nSocios > 0 && <span className="text-gray-400"> · {nSocios} sócio{nSocios > 1 ? 's' : ''} fora do salário</span>}
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white"><tr className="border-b border-gray-100 text-xs text-gray-400">
              <th className="text-left px-6 py-2 font-medium">Nome</th>
              <th className="text-left px-3 py-2 font-medium">Cargo</th>
              <th className="text-right px-3 py-2 font-medium">Salário</th>
              <th className="text-right px-3 py-2 font-medium">INSS</th>
              <th className="text-right px-3 py-2 font-medium">Líquido</th>
              <th className="text-left px-6 py-2 font-medium" title="Como entra no Financeiro: salário gera a remuneração; sócio entra só nas guias">Financeiro</th>
            </tr></thead>
            <tbody>
              {data.linhas.map((l, i) => {
                const socio = (tratamentos[i] ?? 'salario') === 'socio'
                return (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="px-6 py-2 text-gray-900">{l.nome || '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{l.cargo || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{formatBRL(n(l.salario_base))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatBRL(n(l.inss))}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${socio ? 'text-gray-400 line-through decoration-gray-300' : 'text-gray-900'}`}>{formatBRL(n(l.liquido))}</td>
                    <td className="px-6 py-2">
                      <div className="w-44">
                        <Select value={tratamentos[i] ?? 'salario'} size="sm"
                          onChange={v => setTratamentos(p => ({ ...p, [i]: v as Tratamento }))}
                          options={[
                            { value: 'salario', label: 'Salário' },
                            { value: 'socio', label: 'Sócio (pró-labore)' },
                          ]} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button onClick={importar} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Importar competência
          </button>
        </div>
      </div>
    </div>
  )
}
