'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { BarChart3, Users, TrendingUp, Clock, RotateCcw, CalendarCheck, ClipboardCheck, Info } from 'lucide-react'
import { Select } from '@/components/ui/Select'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const mesBR = (m: string) => { const [a, b] = m.split('-'); return `${b}/${a.slice(2)}` }

interface Dash {
  de: string; ate: string
  quadro: {
    ativos: number; tempo_casa_meses: number | null
    serie: { mes: string; n: number }[]
    tempo_casa_faixas: Record<string, number>
    entradas: { mes: string; n: number }[]
    saidas: { mes: string; n: number }[]
    desligamentos_periodo: number; turnover_pct: number | null
  }
  folha: {
    competencias: number; competencia: string | null; tem_evolucao: boolean
    serie: { mes: string; liquido: number; encargos: number; pessoas: number }[]
    por_pessoa: { nome: string; cargo: string | null; liquido: number; tratamento: string | null }[]
  }
  ponto: { mes: string; dias: number; horas: number; extras_aprovadas_h: number; extras_pendentes_h: number; importado: boolean }[]
  fluxo: {
    retrabalho: { de: string; para: string; n: number }[]
    prazo: { concluidas: number; no_prazo: number; atrasadas: number }
  }
  avaliacao: { ciclo_id: string; ciclo: string; media: number | null; respostas: number }[]
}

const FAIXA_LABEL: Record<string, string> = {
  ate_1_ano: 'até 1 ano', de_1_a_2: '1 a 2 anos', de_2_a_5: '2 a 5 anos', mais_de_5: 'mais de 5',
}

export function PainelClient({ orgSlug, meses, d }: { orgSlug: string; meses: number; d: Dash | null }) {
  const router = useRouter()
  if (!d) return <div className="p-6 text-sm text-gray-500">Sem dados.</div>

  const maxHead = Math.max(...d.quadro.serie.map(s => s.n), 1)
  const prazo = d.fluxo.prazo
  const pctPrazo = prazo.concluidas > 0 ? Math.round((prazo.no_prazo / prazo.concluidas) * 100) : null
  const folhaAtual = d.folha.serie[d.folha.serie.length - 1]

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
            <BarChart3 className="w-5 h-5 text-orange-600" /> Painel de RH
          </h1>
          <p className="text-gray-500 text-sm">Quadro, custo, carga e fluxo — o que o dado do Flow já sustenta.</p>
        </div>
        <div className="w-40">
          <Select value={String(meses)} onChange={v => router.push(`/${orgSlug}/rh/painel?meses=${v}`)} options={[
            { value: '6', label: 'Últimos 6 meses' },
            { value: '12', label: 'Últimos 12 meses' },
            { value: '24', label: 'Últimos 24 meses' },
          ]} />
        </div>
      </div>

      {/* ── Números do topo ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card icon={Users} label="Pessoas hoje" valor={String(d.quadro.ativos)}
          rodape={d.quadro.tempo_casa_meses ? `${(d.quadro.tempo_casa_meses / 12).toFixed(1)} anos de casa em média` : undefined} />
        <Card icon={TrendingUp} label="Custo da folha"
          valor={folhaAtual ? brl(folhaAtual.liquido + folhaAtual.encargos) : '—'}
          rodape={folhaAtual ? `líquido + encargos · ${mesBR(folhaAtual.mes)}` : 'importe a folha'} />
        <Card icon={CalendarCheck} label="Entregas no prazo"
          valor={pctPrazo != null ? `${pctPrazo}%` : '—'}
          rodape={prazo.concluidas > 0 ? `${prazo.no_prazo} de ${prazo.concluidas} concluídas` : undefined}
          alerta={pctPrazo != null && pctPrazo < 60} />
        <Card icon={RotateCcw} label="Voltas de etapa"
          valor={String(d.fluxo.retrabalho.reduce((s, r) => s + r.n, 0))}
          rodape="no período · retrabalho" />
      </div>

      {/* ── Quadro no tempo ── */}
      <Bloco titulo="Quadro de pessoas" icone={Users}>
        <div className="flex items-end gap-1 h-28 mb-3">
          {d.quadro.serie.map(s => (
            <div key={s.mes} className="flex-1 flex flex-col items-center gap-1 group">
              <div className="w-full bg-orange-500/80 group-hover:bg-orange-600 rounded-t transition-colors relative"
                style={{ height: `${(s.n / maxHead) * 100}%`, minHeight: s.n > 0 ? 4 : 0 }}>
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-gray-600 opacity-0 group-hover:opacity-100 transition tabular-nums">{s.n}</span>
              </div>
              <span className="text-[9px] text-gray-400 tabular-nums">{mesBR(s.mes)}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600 pt-3 border-t border-gray-100">
          {Object.entries(d.quadro.tempo_casa_faixas).map(([f, n]) => (
            <span key={f}>{FAIXA_LABEL[f] ?? f}: <b className="tabular-nums">{n}</b></span>
          ))}
        </div>
        {/* Turnover com amostra pequena engana mais do que ajuda: mostro a
            contagem junto do percentual, em vez de um número solto. */}
        <p className="text-[11px] text-gray-500 mt-2">
          {d.quadro.desligamentos_periodo === 0
            ? 'Nenhuma saída no período.'
            : <>{d.quadro.desligamentos_periodo} saída{d.quadro.desligamentos_periodo > 1 ? 's' : ''} no período
              {d.quadro.turnover_pct != null && ` (${d.quadro.turnover_pct}% do quadro)`}.
              {d.quadro.desligamentos_periodo < 3 && <span className="text-gray-400"> Amostra pequena — a taxa oscila muito com uma saída a mais ou a menos.</span>}</>}
        </p>
      </Bloco>

      {/* ── Folha ── */}
      <Bloco titulo="Custo de folha" icone={TrendingUp}>
        {!d.folha.tem_evolucao ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[12.5px] text-amber-900 mb-3">
            <b>Só {d.folha.competencias === 0 ? 'nenhuma' : 'uma'} competência importada.</b> A evolução salarial precisa
            de pelo menos duas para virar linha. Importe as anteriores em{' '}
            <Link href={`/${orgSlug}/rh/folha`} className="underline font-medium">RH → Folha</Link> — o histórico já
            existe em PDF, e cada competência nova entra aqui automaticamente.
          </div>
        ) : (
          <div className="flex items-end gap-1.5 h-24 mb-4">
            {d.folha.serie.map(s => {
              const max = Math.max(...d.folha.serie.map(x => x.liquido + x.encargos), 1)
              return (
                <div key={s.mes} className="flex-1 flex flex-col items-center gap-1 group">
                  <div className="w-full bg-emerald-500/80 rounded-t group-hover:bg-emerald-600 transition-colors relative"
                    style={{ height: `${((s.liquido + s.encargos) / max) * 100}%` }}>
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-gray-600 opacity-0 group-hover:opacity-100 transition whitespace-nowrap">{brl(s.liquido + s.encargos)}</span>
                  </div>
                  <span className="text-[9px] text-gray-400">{mesBR(s.mes)}</span>
                </div>
              )
            })}
          </div>
        )}
        {d.folha.por_pessoa.length > 0 && (
          <div className="space-y-1">
            {d.folha.por_pessoa.map((p, i) => {
              const max = d.folha.por_pessoa[0]?.liquido || 1
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-700 w-44 truncate shrink-0">{p.nome.split(' ').slice(0, 2).join(' ')}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                    <div className={`h-full rounded ${p.tratamento === 'socio' ? 'bg-sky-400' : 'bg-orange-400'}`}
                      style={{ width: `${(p.liquido / max) * 100}%` }} />
                  </div>
                  <span className="text-[11px] text-gray-600 tabular-nums w-20 text-right">{brl(p.liquido)}</span>
                </div>
              )
            })}
            <p className="text-[11px] text-gray-400 pt-1">
              Líquido da competência {d.folha.competencia ? mesBR(d.folha.competencia.slice(0, 7)) : ''}.
              Azul = pró-labore de sócio.
            </p>
          </div>
        )}
      </Bloco>

      {/* ── Ponto ── */}
      <Bloco titulo="Carga e horas extras" icone={Clock}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-400 border-b border-gray-100">
              <th className="text-left font-medium py-1.5">Mês</th>
              <th className="text-right font-medium">Horas</th>
              <th className="text-right font-medium">Extra aprovada</th>
              <th className="text-right font-medium">Extra pendente</th>
            </tr>
          </thead>
          <tbody>
            {d.ponto.map(p => (
              <tr key={p.mes} className="border-b border-gray-50 last:border-0">
                <td className="py-1.5 text-gray-700 tabular-nums">
                  {mesBR(p.mes)}
                  {/* Mês do Pontomais tem régua própria — some com o do Flow daria número errado. */}
                  {p.importado && <span className="ml-1.5 text-[10px] text-sky-700 bg-sky-50 border border-sky-200 rounded px-1">Pontomais</span>}
                </td>
                <td className="text-right text-gray-600 tabular-nums">{p.horas}h</td>
                <td className="text-right text-emerald-700 tabular-nums">{p.extras_aprovadas_h > 0 ? `${p.extras_aprovadas_h}h` : '—'}</td>
                <td className="text-right text-amber-600 tabular-nums">{p.extras_pendentes_h > 0 ? `${p.extras_pendentes_h}h` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.ponto.some(p => p.importado) && (
          <p className="text-[11px] text-gray-400 mt-2 flex items-start gap-1">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            Mês marcado como Pontomais foi apurado pela régua deles (8h fixas + excedente em extra) e
            não é comparável dia a dia com o cálculo do Flow.
          </p>
        )}
      </Bloco>

      {/* ── Fluxo ── */}
      <Bloco titulo="Onde o trabalho volta" icone={RotateCcw}>
        <p className="text-[11px] text-gray-500 mb-3">
          Retrabalho medido por <b>etapa</b>, não por pessoa: o histórico registra quem devolveu a tarefa
          (o revisor), não quem errou. A pergunta que o dado responde é onde o fluxo trava.
        </p>
        {d.fluxo.retrabalho.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhuma volta de etapa registrada no período.</p>
        ) : (
          <div className="space-y-1.5">
            {d.fluxo.retrabalho.slice(0, 8).map((r, i) => {
              const max = d.fluxo.retrabalho[0].n
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-600 w-52 shrink-0 truncate">{r.de} → {r.para}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                    <div className="h-full bg-red-400/80 rounded" style={{ width: `${(r.n / max) * 100}%` }} />
                  </div>
                  <span className="text-[11px] text-gray-600 tabular-nums w-8 text-right">{r.n}</span>
                </div>
              )
            })}
          </div>
        )}
      </Bloco>

      {/* ── Avaliação ── */}
      <Bloco titulo="Performance nos ciclos" icone={ClipboardCheck}>
        {d.avaliacao.length === 0 ? (
          <div className="rounded-xl bg-gray-50 px-4 py-3 text-[12.5px] text-gray-600">
            Nenhum ciclo encerrado ainda. Quando o primeiro fechar, a média de cada ciclo aparece aqui e
            passa a dar comparação ao longo do tempo. <Link href={`/${orgSlug}/rh/avaliacao`} className="underline font-medium">Abrir um ciclo</Link>.
          </div>
        ) : (
          <div className="space-y-2">
            {d.avaliacao.map(c => (
              <div key={c.ciclo_id} className="flex items-center gap-3">
                <span className="text-sm text-gray-700 flex-1 truncate">{c.ciclo}</span>
                <div className="w-40 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-orange-500 rounded-full" style={{ width: `${((c.media ?? 0) / 4) * 100}%` }} />
                </div>
                <span className="text-sm font-medium tabular-nums text-gray-900 w-16 text-right">
                  {c.media?.toFixed(2) ?? '—'}<span className="text-xs text-gray-400 font-normal">/4</span>
                </span>
              </div>
            ))}
            <p className="text-[11px] text-gray-400 pt-1">Média das respostas de terceiros — a autoavaliação fica fora para não puxar o número.</p>
          </div>
        )}
      </Bloco>
    </div>
  )
}

function Card({ icon: Icon, label, valor, rodape, alerta }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any; label: string; valor: string; rodape?: string; alerta?: boolean
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1.5">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${alerta ? 'text-amber-600' : 'text-gray-900'}`}>{valor}</div>
      {rodape && <div className="text-[11px] text-gray-400 mt-0.5">{rodape}</div>}
    </div>
  )
}

function Bloco({ titulo, icone: Icone, children }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  titulo: string; icone: any; children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 mb-4">
      <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
        <Icone className="w-4 h-4 text-gray-400" /> {titulo}
      </h2>
      {children}
    </section>
  )
}
