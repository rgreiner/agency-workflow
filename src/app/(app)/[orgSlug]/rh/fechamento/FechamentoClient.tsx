'use client'

import { useState, useEffect, useCallback, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ClipboardList, Loader2, Download, Settings2, Check, AlertTriangle, Clock,
  Lock, Send, RotateCcw, ChevronDown, ChevronRight, X, Plus, FileText,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { carregarFechamento, salvarFechamentoConfig, type Fechamento, type FechamentoLinha } from '@/app/actions/rh-calendario'
import {
  fecharCiclo, reabrirFechamento, enviarFechamentoRh, salvarEmailsContabilidadeRh,
  type RunRh, type RunRhLinha,
} from '@/app/actions/rh-fechamento'

export interface FechConfig { dia_ini: number; dia_pagamento: number; paga_mes_seguinte: boolean }

/** minutos → H:MM (com sinal). O relatório da contabilidade usa esse formato. */
function hm(min: number): string {
  const s = min < 0 ? '-' : ''
  const a = Math.abs(min)
  return `${s}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`
}
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const cpfMask = (c: string | null) => c ?? '—'
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const labelComp = (c: string) => { const [y, m] = c.split('-'); return `${MESES[Number(m) - 1]}/${y}` }
const parseMoney = (s: string): number | null => {
  const n = Number(s.trim().replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** O rascunho do corpo do e-mail, no molde do que a casa manda de verdade
 *  ("Bom dia… segue abaixo o banco de horas…"): a TABELA entra sozinha depois
 *  do texto, então aqui ficam só a saudação e os benefícios — proporcionais e
 *  casos por pessoa (ex.: VT só de um) se ajustam editando o texto. */
function gerarCorpo(ini: string, fim: string, vr: number | null, vt: number | null): string {
  const p: string[] = [
    'Bom dia,', '',
    `Segue abaixo o fechamento do banco de horas do período ${dataBR(ini)} a ${dataBR(fim)}.`,
  ]
  if (vr || vt) p.push('')
  if (vr) p.push(`Foi creditado ${brl(vr)} do vale alimentação.`)
  if (vt) p.push(`Foi creditado ${brl(vt)} do vale-transporte.`)
  p.push('', 'Qualquer dúvida estou à disposição.')
  return p.join('\n')
}

function baixarCsvDe(linhas: { nome: string; cpf: string | null; cargo: string | null; ini?: string; fim?: string; hn_min: number; he50_min: number; he100_min: number; faltas_min: number; total_min: number; quitacao_min: number }[], nomeArq: string) {
  const head = ['Colaborador', 'Matrícula (CPF)', 'Cargo', 'Período', 'H.N.', 'H.E.50', 'H.E.100', 'Faltas', 'H. Totais', 'Quitação Banco']
  const rows = linhas.map(l => [
    l.nome, cpfMask(l.cpf), l.cargo ?? '', l.ini && l.fim ? `${dataBR(l.ini)} a ${dataBR(l.fim)}` : '',
    hm(l.hn_min), hm(l.he50_min), hm(l.he100_min), hm(l.faltas_min), hm(l.total_min), hm(l.quitacao_min),
  ])
  const csv = [head, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = nomeArq; a.click()
  URL.revokeObjectURL(url)
}

export function FechamentoClient({ orgSlug, config, hoje, runs, emailsContab }: {
  orgSlug: string; config: FechConfig | null; hoje: string
  runs: RunRh[]; emailsContab: string[]
}) {
  const router = useRouter()
  const [comp, setComp] = useState(hoje.slice(0, 7))
  const [fech, setFech] = useState<Fechamento | null>(null)
  const [loading, setLoading] = useState(true)
  const [cfgOpen, setCfgOpen] = useState(false)
  const [diaIni, setDiaIni] = useState(config?.dia_ini ?? 26)
  const [diaPg, setDiaPg] = useState(config?.dia_pagamento ?? 30)
  const [pagaProx, setPagaProx] = useState(config?.paga_mes_seguinte ?? false)
  const [pending, start] = useTransition()

  // Seleção do corte: quem entra e quem tem período próprio (desligado).
  const [incluir, setIncluir] = useState<Record<string, boolean>>({})
  const [estender, setEstender] = useState<Record<string, boolean>>({})
  const [confirmFechar, setConfirmFechar] = useState(false)

  // Modais de reabrir/enviar + histórico expandido.
  const [reabrirDe, setReabrirDe] = useState<RunRh | null>(null)
  const [motivoReabrir, setMotivoReabrir] = useState('')
  const [envioDe, setEnvioDe] = useState<RunRh | null>(null)
  const [vrTxt, setVrTxt] = useState('')
  const [vtTxt, setVtTxt] = useState('')
  const [corpo, setCorpo] = useState('')
  const [corpoTocado, setCorpoTocado] = useState(false)
  const [emails, setEmails] = useState<string[]>(emailsContab)
  const [emailNovo, setEmailNovo] = useState('')
  const [expandido, setExpandido] = useState<Record<string, boolean>>({})

  const runComp = useMemo(() => runs.find(r => String(r.competencia).slice(0, 7) === comp) ?? null, [runs, comp])
  const fechado = !!runComp && runComp.status !== 'reaberto'

  /** A pessoa já teve o último ciclo dela coberto por um fechamento anterior
   *  (fim ≥ demissão)? Aí ela não entra de novo no ciclo seguinte. */
  const cobertoAteDemissao = useCallback((colabId: string, demissao: string) =>
    runs.some(r => r.status !== 'reaberto' &&
      r.rh_fechamento_run_linha.some(l => l.colaborador_id === colabId && l.fim >= demissao)),
  [runs])

  const carregar = useCallback(async () => {
    setLoading(true)
    const r = await carregarFechamento(orgSlug, comp)
    if (r?.error) { toast.error(r.error); setFech(null) }
    else {
      const f = r?.fechamento ?? null
      setFech(f)
      // Pré-marca pela regra da ficha; desligado já coberto começa desmarcado.
      if (f) {
        setIncluir(Object.fromEntries(f.linhas.map(l => [l.colaborador_id,
          l.entra_fechamento !== false &&
          !(l.data_demissao && cobertoAteDemissao(l.colaborador_id, l.data_demissao))])))
        setEstender({})
      }
    }
    setLoading(false)
  }, [orgSlug, comp, cobertoAteDemissao])

  useEffect(() => { carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  function salvarCfg() {
    start(async () => {
      const r = await salvarFechamentoConfig(orgSlug, diaIni, diaPg, pagaProx)
      if (r?.error) toast.error(r.error)
      else { toast.success('Período de fechamento salvo.'); setCfgOpen(false); router.refresh(); carregar() }
    })
  }

  // ── Fechar o ciclo ──
  const selecionadas = (fech?.linhas ?? []).filter(l => incluir[l.colaborador_id])
  function fecharAgora() {
    setConfirmFechar(false)
    start(async () => {
      const pessoas = selecionadas.map(l => ({
        id: l.colaborador_id,
        ...(estender[l.colaborador_id] && l.data_demissao ? { fim: l.data_demissao } : {}),
      }))
      const r = await fecharCiclo(orgSlug, comp, pessoas)
      if (r?.error) { toast.error(r.error); return }
      toast.success(`Ciclo de ${labelComp(comp)} fechado com ${pessoas.length} pessoa(s).`)
      router.refresh()
    })
  }

  function reabrir() {
    if (!reabrirDe) return
    start(async () => {
      const r = await reabrirFechamento(orgSlug, reabrirDe.id, motivoReabrir)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Ciclo reaberto — refaça o fechamento quando terminar os ajustes.')
      setReabrirDe(null); setMotivoReabrir('')
      router.refresh()
    })
  }

  // ── Envio para a contabilidade ──
  function abrirEnvio(run: RunRh) {
    setEnvioDe(run)
    setVrTxt(run.vr_valor ? String(run.vr_valor).replace('.', ',') : '')
    setVtTxt(run.vt_valor ? String(run.vt_valor).replace('.', ',') : '')
    if (run.corpo) { setCorpo(run.corpo); setCorpoTocado(true) } else { setCorpoTocado(false) }
    setEmails(emailsContab)
    setEmailNovo('')
  }
  // VR/VT entram no texto — enquanto o corpo não foi editado à mão, o rascunho
  // é DERIVADO (regera a cada tecla nos valores); editar assume o controle.
  const corpoGerado = useMemo(() => {
    if (!envioDe) return ''
    return gerarCorpo(envioDe.ini, envioDe.fim, parseMoney(vrTxt), parseMoney(vtTxt))
  }, [envioDe, vrTxt, vtTxt])
  const corpoFinal = corpoTocado ? corpo : corpoGerado

  function addEmail() {
    const e = emailNovo.trim()
    if (!e) return
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { toast.error('E-mail inválido.'); return }
    if (!emails.includes(e)) setEmails([...emails, e])
    setEmailNovo('')
  }
  function enviar() {
    if (!envioDe) return
    const reenviar = envioDe.status === 'enviado'
    start(async () => {
      // Destinatários mudaram? Salva antes — o envio lê da config.
      if (emails.join(',') !== emailsContab.join(',')) {
        const rs = await salvarEmailsContabilidadeRh(orgSlug, emails)
        if (rs?.error) { toast.error(rs.error); return }
      }
      const r = await enviarFechamentoRh(orgSlug, envioDe.id, {
        vr: parseMoney(vrTxt), vt: parseMoney(vtTxt), corpo: corpoFinal, reenviar,
      })
      if (r?.error) { toast.error(r.error); return }
      toast.success(`${reenviar ? 'Reenviado' : 'Enviado'} para ${r?.destinatarios?.join(', ')}.`)
      setEnvioDe(null)
      router.refresh()
    })
  }

  const semMarcacao = (fech?.linhas ?? []).filter(l => l.dias_com_ponto === 0)
  const pendentes = (fech?.linhas ?? []).filter(l => l.pendente_min > 0)
  const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'

  /** Linha do desligado: oferta de esticar o ciclo até a demissão (34 dias em
   *  vez de vazar dias para um ciclo em que a pessoa não existe mais). */
  function ofertaEstender(l: FechamentoLinha): string | null {
    if (!fech || !l.data_demissao) return null
    return l.data_demissao > fech.fim ? l.data_demissao : null
  }

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><ClipboardList className="w-5 h-5 text-orange-600" /> Fechamento do ponto</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            O relatório que vai para a contabilidade.
            {fech && <> Período <b className="text-gray-700">{dataBR(fech.ini)} – {dataBR(fech.fim)}</b></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={comp} onChange={e => setComp(e.target.value)}
            className="px-3 py-2 text-sm bg-gray-100 border border-transparent rounded-xl text-gray-800" />
          <button onClick={() => setCfgOpen(true)} title="Período de fechamento"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
            <Settings2 className="w-4 h-4" /> Período
          </button>
        </div>
      </div>

      {/* ── Ciclo FECHADO: snapshot + envio ── */}
      {fechado && runComp && (
        <>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2 text-sm text-emerald-800">
              <Lock className="w-4 h-4" />
              <span>
                <b>Ciclo fechado</b> em {dataBR(String(runComp.fechado_em).slice(0, 10))}
                {runComp.versao > 1 && <> · v{runComp.versao}</>}
                {runComp.status === 'enviado' && runComp.enviado_em && (
                  <> · enviado em {dataBR(String(runComp.enviado_em).slice(0, 10))} para {runComp.destinatarios?.join(', ')}{(runComp.envios ?? 0) > 1 && ` (${runComp.envios}º envio)`}</>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <a href={`/api/rh/fechamento/pdf?org=${orgSlug}&run=${runComp.id}&tipo=resumo`}
                title="A tabela do banco de horas — o formato que a contabilidade recebe"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white ring-1 ring-emerald-200 text-emerald-800 hover:bg-emerald-100 transition-colors">
                <FileText className="w-3.5 h-3.5" /> Resumo (PDF)
              </a>
              <a href={`/api/rh/fechamento/pdf?org=${orgSlug}&run=${runComp.id}&tipo=espelho`}
                title="Espelho detalhado, uma página por pessoa"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white ring-1 ring-emerald-200 text-emerald-800 hover:bg-emerald-100 transition-colors">
                <FileText className="w-3.5 h-3.5" /> Espelho detalhado
              </a>
              <button onClick={() => baixarCsvDe(runComp.rh_fechamento_run_linha, `fechamento-ponto-${comp}.csv`)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white ring-1 ring-emerald-200 text-emerald-800 hover:bg-emerald-100 transition-colors">
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
              <button onClick={() => abrirEnvio(runComp)} disabled={pending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-[#fff] hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                <Send className="w-3.5 h-3.5" /> {runComp.status === 'enviado' ? 'Reenviar' : 'Enviar para a contabilidade'}
              </button>
              <button onClick={() => { setReabrirDe(runComp); setMotivoReabrir('') }} disabled={pending}
                title="Reabrir para ajustes"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-emerald-800 hover:bg-emerald-100 transition-colors">
                <RotateCcw className="w-3.5 h-3.5" /> Reabrir
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-xs text-gray-400">
                <th className="text-left px-4 py-3 font-medium">Colaborador</th>
                <th className="text-left px-3 py-3 font-medium">Matrícula (CPF)</th>
                <th className="text-right px-3 py-3 font-medium">H.N.</th>
                <th className="text-right px-3 py-3 font-medium">H.E.50</th>
                <th className="text-right px-3 py-3 font-medium">H.E.100</th>
                <th className="text-right px-3 py-3 font-medium">Faltas</th>
                <th className="text-right px-3 py-3 font-medium">H. Totais</th>
                <th className="text-right px-4 py-3 font-medium">Quitação Banco</th>
              </tr></thead>
              <tbody>
                {runComp.rh_fechamento_run_linha.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(l => (
                  <tr key={l.colaborador_id} className="border-b border-gray-50 last:border-0 hover:bg-orange-50/40 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/${orgSlug}/rh/espelho/${l.colaborador_id}?comp=${comp}`}
                        className="font-medium text-gray-900 hover:text-orange-600 transition-colors">{l.nome}</Link>
                      <div className="text-xs text-gray-400">
                        {l.cargo ?? '—'}
                        {(l.ini !== runComp.ini || l.fim !== runComp.fim) && (
                          <span className="text-sky-700"> · período próprio {ddmm(l.ini)}–{ddmm(l.fim)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-gray-500 tabular-nums">{cpfMask(l.cpf)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-700">{hm(l.hn_min)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-600">{hm(l.he50_min)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-600">{hm(l.he100_min)}</td>
                    <td className={`px-3 py-3 text-right tabular-nums ${l.faltas_min > 0 ? 'text-red-600' : 'text-gray-400'}`}>{hm(l.faltas_min)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-gray-900">{hm(l.total_min)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-medium ${l.quitacao_min < 0 ? 'text-red-600' : l.quitacao_min > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{hm(l.quitacao_min)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400 mt-3">
            Números congelados no fechamento — para corrigir, reabra o ciclo, ajuste e feche de novo.
            Clique no nome para ver o espelho dia a dia (marcações, justificativas e anexos).
          </p>
        </>
      )}

      {/* ── Ciclo ABERTO: relatório vivo + seleção de quem entra ── */}
      {!fechado && (<>
        {runComp?.status === 'reaberto' && (
          <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 mb-4 text-sm text-amber-800 flex items-start gap-2">
            <RotateCcw className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <b>Ciclo reaberto</b>{runComp.reaberto_motivo && <> — {runComp.reaberto_motivo}</>}.
              Ajuste o que precisar e feche de novo; o envio fica bloqueado até lá.
            </div>
          </div>
        )}
        {!!pendentes.length && (
          <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 mb-4 text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <b>{pendentes.length} pessoa(s) com hora extra pendente de aprovação</b> — o não aprovado <b>não entra</b> nas colunas H.E.
              <div className="text-xs mt-0.5">Aprove em RH → Ponto antes de fechar: {pendentes.map(p => `${p.nome.split(' ')[0]} (${hm(p.pendente_min)})`).join(' · ')}</div>
            </div>
          </div>
        )}
        {!!semMarcacao.length && (
          <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 px-4 py-3 mb-4 text-sm text-gray-600 flex items-start gap-2">
            <Clock className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <b>{semMarcacao.length} pessoa(s) sem nenhuma marcação no período</b> — aparecem como “sem marcação”, não como falta.
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Calculando…</div>
        ) : !fech?.linhas.length ? (
          <div className="text-center py-16 text-gray-400 text-sm">Nenhum colaborador no período.</div>
        ) : (
          <>
            <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 text-xs text-gray-400">
                  <th className="px-4 py-3 w-px"></th>
                  <th className="text-left px-2 py-3 font-medium">Colaborador</th>
                  <th className="text-left px-3 py-3 font-medium">Matrícula (CPF)</th>
                  <th className="text-right px-3 py-3 font-medium">H.N.</th>
                  <th className="text-right px-3 py-3 font-medium">H.E.50</th>
                  <th className="text-right px-3 py-3 font-medium">H.E.100</th>
                  <th className="text-right px-3 py-3 font-medium">Faltas</th>
                  <th className="text-right px-3 py-3 font-medium">H. Totais</th>
                  <th className="text-right px-4 py-3 font-medium">Quitação Banco</th>
                </tr></thead>
                <tbody>
                  {fech.linhas.map(l => {
                    const vazio = l.dias_com_ponto === 0
                    const marcado = !!incluir[l.colaborador_id]
                    const demissaoAlem = ofertaEstender(l)
                    const foraFicha = l.entra_fechamento === false
                    const jaCoberto = !!l.data_demissao && cobertoAteDemissao(l.colaborador_id, l.data_demissao)
                    return (
                      <tr key={l.colaborador_id} className={cn('border-b border-gray-50 last:border-0 transition-colors',
                        marcado ? 'hover:bg-orange-50/40' : 'opacity-50')}>
                        <td className="pl-4 pr-1 py-3">
                          <input type="checkbox" checked={marcado}
                            onChange={e => setIncluir(p => ({ ...p, [l.colaborador_id]: e.target.checked }))}
                            className="w-4 h-4 rounded border-gray-300 accent-orange-600 cursor-pointer" />
                        </td>
                        <td className="px-2 py-3">
                          <Link href={`/${orgSlug}/rh/espelho/${l.colaborador_id}?comp=${comp}`}
                            className="font-medium text-gray-900 hover:text-orange-600 transition-colors">{l.nome}</Link>
                          <div className="text-xs text-gray-400">
                            {l.cargo ?? '—'}
                            {foraFicha && <span className="text-gray-500"> · fora do fechamento (regra da ficha)</span>}
                            {jaCoberto && l.data_demissao && <span className="text-sky-700"> · último ciclo já fechado até {ddmm(l.data_demissao)}</span>}
                          </div>
                          {/* Desligamento cai depois do corte: o último ciclo da
                              pessoa estica até a demissão, em vez de sobrar para
                              um mês em que ela não existe mais. */}
                          {marcado && demissaoAlem && !jaCoberto && (
                            <label className="inline-flex items-center gap-1.5 mt-1 text-[11px] text-sky-800 bg-sky-50 rounded-lg px-2 py-1 cursor-pointer">
                              <input type="checkbox" checked={!!estender[l.colaborador_id]}
                                onChange={e => setEstender(p => ({ ...p, [l.colaborador_id]: e.target.checked }))}
                                className="w-3.5 h-3.5 rounded border-sky-300 accent-sky-600" />
                              estender este fechamento até a demissão ({ddmm(demissaoAlem)})
                            </label>
                          )}
                        </td>
                        <td className="px-3 py-3 text-gray-500 tabular-nums">{cpfMask(l.cpf)}</td>
                        {vazio ? (
                          <td colSpan={6} className="px-3 py-3 text-center text-xs text-gray-400 italic">sem marcação no período</td>
                        ) : (
                          <>
                            <td className="px-3 py-3 text-right tabular-nums text-gray-700">{hm(l.hn_min)}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-gray-600">
                              {hm(l.he50_min)}
                              {l.pendente_min > 0 && <span title={`${hm(l.pendente_min)} pendente de aprovação`} className="text-amber-600"> *</span>}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-gray-600">{hm(l.he100_min)}</td>
                            <td className={`px-3 py-3 text-right tabular-nums ${l.faltas_min > 0 ? 'text-red-600' : 'text-gray-400'}`}>{hm(l.faltas_min)}</td>
                            <td className="px-3 py-3 text-right tabular-nums font-medium text-gray-900">{hm(l.total_min)}</td>
                            <td className={`px-4 py-3 text-right tabular-nums font-medium ${l.quitacao_min < 0 ? 'text-red-600' : l.quitacao_min > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{hm(l.quitacao_min)}</td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4 gap-3 flex-wrap">
              <p className="text-[11px] text-gray-400 max-w-xl">
                H.N. = horas normais · H.E.50/100 = extra 50%/100% (só o aprovado) · Faltas = horas não cumpridas (inclui atraso parcial) ·
                H. Totais = H.N. + extras − faltas · Quitação = extras − faltas. Fechar congela os números e libera o envio à contabilidade.
              </p>
              <button onClick={() => setConfirmFechar(true)} disabled={pending || !selecionadas.length}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 active:scale-[0.97] disabled:opacity-50 transition-colors">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                Fechar ciclo ({selecionadas.length} pessoa{selecionadas.length === 1 ? '' : 's'})
              </button>
            </div>
          </>
        )}
      </>)}

      {/* ── Histórico dos ciclos fechados ── */}
      {runs.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Histórico de fechamentos</h2>
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
            {runs.map(r => {
              const rc = String(r.competencia).slice(0, 7)
              const aberto = !!expandido[r.id]
              const linhas = r.rh_fechamento_run_linha.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
              return (
                <div key={r.id}>
                  <button onClick={() => setExpandido(p => ({ ...p, [r.id]: !aberto }))}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors">
                    {aberto ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-900 capitalize">{labelComp(rc)}</span>
                      <span className="text-xs text-gray-400 ml-2 tabular-nums">{dataBR(r.ini)} – {dataBR(r.fim)} · {linhas.length} pessoa{linhas.length === 1 ? '' : 's'}{r.versao > 1 && ` · v${r.versao}`}</span>
                    </div>
                    {r.status === 'enviado' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5">
                        <Check className="w-3 h-3" /> enviado {r.enviado_em && ddmm(String(r.enviado_em).slice(0, 10))}
                      </span>
                    ) : r.status === 'reaberto' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">
                        <RotateCcw className="w-3 h-3" /> reaberto
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                        <Lock className="w-3 h-3" /> fechado
                      </span>
                    )}
                  </button>
                  {aberto && (
                    <div className="px-4 pb-3">
                      <table className="w-full text-xs">
                        <thead><tr className="text-gray-400">
                          <th className="text-left py-1.5 font-medium">Colaborador</th>
                          <th className="text-left px-2 py-1.5 font-medium">Período</th>
                          <th className="text-right px-2 py-1.5 font-medium">H.N.</th>
                          <th className="text-right px-2 py-1.5 font-medium">Extras</th>
                          <th className="text-right px-2 py-1.5 font-medium">Faltas</th>
                          <th className="text-right py-1.5 font-medium">Quitação</th>
                        </tr></thead>
                        <tbody>
                          {linhas.map(l => (
                            <tr key={l.colaborador_id} className="border-t border-gray-50">
                              <td className="py-1.5">
                                <Link href={`/${orgSlug}/rh/espelho/${l.colaborador_id}?comp=${rc}`}
                                  className="text-gray-800 hover:text-orange-600 transition-colors">{l.nome}</Link>
                              </td>
                              <td className="px-2 py-1.5 text-gray-500 tabular-nums">{ddmm(l.ini)}–{ddmm(l.fim)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{hm(l.hn_min)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{hm(l.he50_min + l.he100_min)}</td>
                              <td className={`px-2 py-1.5 text-right tabular-nums ${l.faltas_min > 0 ? 'text-red-600' : 'text-gray-400'}`}>{hm(l.faltas_min)}</td>
                              <td className={`py-1.5 text-right tabular-nums font-medium ${l.quitacao_min < 0 ? 'text-red-600' : l.quitacao_min > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{hm(l.quitacao_min)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="flex items-center gap-2 mt-2">
                        <a href={`/api/rh/fechamento/pdf?org=${orgSlug}&run=${r.id}&tipo=resumo`}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-orange-600 transition-colors">
                          <FileText className="w-3.5 h-3.5" /> Resumo (PDF)
                        </a>
                        <a href={`/api/rh/fechamento/pdf?org=${orgSlug}&run=${r.id}&tipo=espelho`}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-orange-600 transition-colors">
                          <FileText className="w-3.5 h-3.5" /> Espelho detalhado
                        </a>
                        <button onClick={() => baixarCsvDe(linhas, `fechamento-ponto-${rc}.csv`)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-orange-600 transition-colors">
                          <Download className="w-3.5 h-3.5" /> CSV
                        </button>
                        <span className="text-[11px] text-gray-300">· clique no nome para o espelho dia a dia (marcações, justificativas, anexos)</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Confirmar o fechamento ── */}
      {confirmFechar && fech && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="modal-card w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Fechar o ciclo de {labelComp(comp)}?</h2>
              <p className="text-xs text-gray-500 mt-0.5">Período {dataBR(fech.ini)} – {dataBR(fech.fim)} · {selecionadas.length} pessoa{selecionadas.length === 1 ? '' : 's'}</p>
            </div>
            <div className="px-6 py-4 space-y-2 text-sm text-gray-600">
              <p>Os números são <b>congelados como estão agora</b> e o envio para a contabilidade é liberado. Para corrigir depois, é preciso reabrir com motivo.</p>
              {pendentes.some(p => incluir[p.colaborador_id]) && (
                <p className="text-amber-700 bg-amber-50 rounded-lg px-3 py-2 text-xs">
                  Há hora extra <b>pendente de aprovação</b> entre as pessoas selecionadas — o que não foi aprovado não entra nas colunas H.E.
                </p>
              )}
              {Object.entries(estender).some(([id, v]) => v && incluir[id]) && (
                <p className="text-sky-800 bg-sky-50 rounded-lg px-3 py-2 text-xs">
                  Fechamento com período estendido até a demissão para: {fech.linhas.filter(l => estender[l.colaborador_id] && incluir[l.colaborador_id]).map(l => l.nome.split(' ')[0]).join(', ')}.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setConfirmFechar(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancelar</button>
              <button onClick={fecharAgora} disabled={pending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-colors">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />} Fechar ciclo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reabrir ── */}
      {reabrirDe && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="modal-card w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Reabrir o ciclo de {labelComp(String(reabrirDe.competencia).slice(0, 7))}</h2>
              <p className="text-xs text-gray-500 mt-0.5">O snapshot atual deixa de valer; ajuste e feche de novo. Se já foi enviado, o próximo envio sai como versão corrigida.</p>
            </div>
            <div className="px-6 py-4">
              <label className="block text-sm text-gray-600 mb-1.5">Motivo</label>
              <textarea value={motivoReabrir} onChange={e => setMotivoReabrir(e.target.value)} rows={2}
                className={inputCls} placeholder="Ex.: aprovação de extra que ficou de fora" />
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setReabrirDe(null)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancelar</button>
              <button onClick={reabrir} disabled={pending || !motivoReabrir.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-amber-700 disabled:opacity-50 transition-colors">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Reabrir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Enviar para a contabilidade ── */}
      {envioDe && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="modal-card w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Enviar para a contabilidade</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {labelComp(String(envioDe.competencia).slice(0, 7))} · {dataBR(envioDe.ini)} – {dataBR(envioDe.fim)} ·
                a tabela do banco de horas vai no corpo do e-mail e anexa em PDF + CSV.
              </p>
            </div>
            <div className="px-6 py-5 space-y-4">
              {envioDe.status === 'enviado' && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                  Este ciclo já foi enviado{envioDe.enviado_em && ` em ${dataBR(String(envioDe.enviado_em).slice(0, 10))}`} — o reenvio sai marcado como <b>versão corrigida</b>.
                </p>
              )}
              <div>
                <label className="block text-sm text-gray-600 mb-1.5">Para (RH da contabilidade)</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {emails.map(e => (
                    <span key={e} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded-lg px-2 py-1">
                      {e}
                      <button onClick={() => setEmails(emails.filter(x => x !== e))} className="text-gray-400 hover:text-red-600 transition-colors"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                  <div className="inline-flex items-center gap-1">
                    <input value={emailNovo} onChange={e => setEmailNovo(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEmail() } }}
                      placeholder="adicionar e-mail" className="px-2 py-1 text-xs bg-gray-100 border border-transparent rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-500 w-40" />
                    <button onClick={addEmail} className="p-1 text-gray-400 hover:text-orange-600 transition-colors"><Plus className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                {!emails.length && <p className="text-[11px] text-red-500 mt-1">Adicione ao menos um destinatário — fica salvo para os próximos meses.</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1.5">Vale alimentação do mês <span className="text-gray-400 font-normal">(R$, opcional)</span></label>
                  <input inputMode="decimal" value={vrTxt} onChange={e => setVrTxt(e.target.value)} className={inputCls} placeholder="782,00" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1.5">Vale transporte do mês <span className="text-gray-400 font-normal">(R$, opcional)</span></label>
                  <input inputMode="decimal" value={vtTxt} onChange={e => setVtTxt(e.target.value)} className={inputCls} placeholder="0,00" />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm text-gray-600">Corpo do e-mail</label>
                  {corpoTocado && (
                    <button onClick={() => { setCorpoTocado(false) }} className="text-[11px] text-gray-400 hover:text-orange-600 transition-colors">
                      voltar ao texto gerado
                    </button>
                  )}
                </div>
                <textarea value={corpoFinal} onChange={e => { setCorpo(e.target.value); setCorpoTocado(true) }} rows={8}
                  className={cn(inputCls, 'font-mono text-xs leading-relaxed')} />
                <p className="text-[11px] text-gray-400 mt-1">
                  A <b>tabela do banco de horas entra sozinha</b> logo abaixo deste texto. Edite à vontade —
                  proporcionais e casos por pessoa (ex.: VT só de um colaborador) se escrevem aqui.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setEnvioDe(null)} disabled={pending} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancelar</button>
              <button onClick={enviar} disabled={pending || !emails.length || !corpoFinal.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-emerald-700 active:scale-[0.97] disabled:opacity-50 transition-colors">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {envioDe.status === 'enviado' ? 'Reenviar agora' : 'Enviar agora'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Config do período ── */}
      {cfgOpen && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => { if (e.target === e.currentTarget) setCfgOpen(false) }}>
          <div className="modal-card w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Período de fechamento</h2>
              <p className="text-xs text-gray-500 mt-0.5">Cada empresa fecha diferente. A One a One usa 26 → 25.</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Fecha do dia</label>
                <input type="number" min={1} max={28} value={diaIni} onChange={e => setDiaIni(Number(e.target.value) || 1)}
                  className="w-24 px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                <p className="text-[11px] text-gray-400 mt-1.5">
                  {diaIni === 1 ? 'Mês cheio (dia 1 ao último dia do mês).' : `Do dia ${diaIni} do mês anterior ao dia ${diaIni - 1} da competência.`}
                  {' '}Máximo 28 (acima disso quebraria em fevereiro).
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Dia do pagamento</label>
                <input type="number" min={1} max={31} value={diaPg} onChange={e => setDiaPg(Number(e.target.value) || 1)}
                  className="w-24 px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={pagaProx} onChange={e => setPagaProx(e.target.checked)} className="rounded text-orange-600 focus:ring-orange-500" />
                Paga no mês seguinte à competência
              </label>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setCfgOpen(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancelar</button>
              <button onClick={salvarCfg} disabled={pending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-colors">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
