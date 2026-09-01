'use client'

import { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { UserCog, Plus, Loader2, Archive, Paperclip, Trash2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { salvarColaborador, impactoExcluirColaborador, excluirColaborador, reativarColaborador,
  type ImpactoExcluirColab } from '@/app/actions/rh'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DocumentosModal } from './DocumentosModal'

export interface ColaboradorRow {
  id: string
  nome: string
  cargo: string | null
  tipo_vinculo: string | null
  status: string
  data_admissao: string | null
  data_demissao: string | null
  arquivado: boolean
  /** Aviso prévio em curso (migs. 262/263) — vira o chip "em aviso". */
  aviso_previo_ini?: string | null
  aviso_previo_fim?: string | null
  aviso_previo_modo?: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  ativo:     { label: 'Ativo',     cls: 'bg-emerald-50 text-emerald-700' },
  afastado:  { label: 'Afastado',  cls: 'bg-amber-50 text-amber-700' },
  desligado: { label: 'Desligado', cls: 'bg-gray-100 text-gray-500' },
}
const VINCULO: Record<string, string> = { clt: 'CLT', socio: 'Sócio(a)', pj: 'PJ', estagio: 'Estágio', outro: 'Outro' }

// ── Tempo de casa / contrato de experiência (45d + 45d → efetivação em 90d) ──
const dd = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}` }
function diffDays(aISO: string, bISO: string): number {
  return Math.floor((Date.parse(`${bISO}T00:00:00Z`) - Date.parse(`${aISO}T00:00:00Z`)) / 86400000)
}
function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
}
function tempoDeCasa(admISO: string, refISO: string): string {
  const [ay, am, ad] = admISO.split('-').map(Number)
  const [ry, rm, rd] = refISO.split('-').map(Number)
  let meses = (ry - ay) * 12 + (rm - am) - (rd < ad ? 1 : 0)
  if (meses < 0) meses = 0
  const y = Math.floor(meses / 12), m = meses % 12
  if (y === 0) return `${m} ${m === 1 ? 'mês' : 'meses'}`
  if (m === 0) return `${y} ${y === 1 ? 'ano' : 'anos'}`
  return `${y}a ${m}m`
}
/** Rótulo da coluna: experiência (1º/2º período), tempo de casa efetivado, ou duração se desligado. */
function periodo(c: ColaboradorRow, hoje: string): { txt: string; sub?: string; exp?: boolean } | null {
  if (!c.data_admissao) return null
  if (c.status === 'desligado') return { txt: `durou ${tempoDeCasa(c.data_admissao, c.data_demissao || hoje)}` }
  const days = diffDays(c.data_admissao, hoje)
  const temExperiencia = c.tipo_vinculo !== 'estagio' && c.tipo_vinculo !== 'pj' && c.tipo_vinculo !== 'socio'
  if (temExperiencia && days >= 0 && days <= 90) {
    if (days <= 45) return { exp: true, txt: 'Experiência 1º', sub: `${days}/45 d · vence ${dd(addDays(c.data_admissao, 45))}` }
    return { exp: true, txt: 'Experiência 2º', sub: `${days}/90 d · efetiva ${dd(addDays(c.data_admissao, 90))}` }
  }
  return { txt: tempoDeCasa(c.data_admissao, hoje), sub: `aniversário ${dd(c.data_admissao)}` }
}
const inputCls = 'w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'

export function PessoasClient({ orgSlug, colaboradores, hoje }: { orgSlug: string; colaboradores: ColaboradorRow[]; hoje: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [aba, setAba] = useState<'ativos' | 'todos' | 'arquivados'>('ativos')
  const [novo, setNovo] = useState(false)
  const [docsFor, setDocsFor] = useState<{ id: string; nome: string } | null>(null)
  // Excluir ficha só existe para cadastro SEM histórico (o duplicado de hoje);
  // com histórico a RPC recusa e a régua da casa continua sendo arquivar.
  const [excluir, setExcluir] = useState<{ id: string; nome: string; imp: ImpactoExcluirColab } | null>(null)

  function pedirExclusao(c: ColaboradorRow) {
    startTransition(async () => {
      const imp = await impactoExcluirColaborador(orgSlug, c.id)
      if (!imp.pode) { toast.error(imp.motivo ?? 'Não é possível excluir esta ficha.'); return }
      setExcluir({ id: c.id, nome: c.nome, imp })
    })
  }
  function confirmarExclusao() {
    if (!excluir) return
    const { id, nome } = excluir
    setExcluir(null)
    startTransition(async () => {
      const r = await excluirColaborador(orgSlug, id)
      if (r?.error) { toast.error(r.error); return }
      toast.success(`Ficha de ${nome} excluída.`)
      router.refresh()
    })
  }
  function reativar(c: ColaboradorRow) {
    startTransition(async () => {
      const r = await reativarColaborador(orgSlug, c.id)
      if (r?.error) { toast.error(r.error); return }
      toast.success(`${c.nome.split(' ')[0]} reativado(a) — o histórico continua na ficha. O acesso é liberado em Membros.`)
      router.refresh()
    })
  }

  const lista = useMemo(() => colaboradores.filter(c =>
    aba === 'arquivados' ? c.arquivado : aba === 'ativos' ? (!c.arquivado && c.status !== 'desligado') : !c.arquivado
  ), [colaboradores, aba])

  const contagem = useMemo(() => ({
    ativos: colaboradores.filter(c => !c.arquivado && c.status !== 'desligado').length,
    todos: colaboradores.filter(c => !c.arquivado).length,
    arquivados: colaboradores.filter(c => c.arquivado).length,
  }), [colaboradores])

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><UserCog className="w-5 h-5 text-orange-600" /> Pessoas</h1>
          <p className="text-gray-500 text-sm mt-0.5">Colaboradores, ativos e ex — ficha e documentos.</p>
        </div>
        <button onClick={() => setNovo(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition">
          <Plus className="w-4 h-4" /> Nova pessoa
        </button>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {([['ativos', 'Ativos'], ['todos', 'Todos'], ['arquivados', 'Arquivados']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition ${aba === k ? 'border-orange-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label} <span className="text-gray-400">{contagem[k]}</span>
          </button>
        ))}
      </div>

      {lista.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          {aba === 'arquivados' ? 'Nenhum colaborador arquivado.' : 'Nenhum colaborador ainda. Clique em “Nova pessoa”.'}
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400">
                <th className="text-left px-4 py-3 font-medium">Nome</th>
                <th className="text-left px-4 py-3 font-medium">Cargo</th>
                <th className="text-left px-4 py-3 font-medium">Vínculo</th>
                <th className="text-left px-4 py-3 font-medium">Admissão</th>
                <th className="text-left px-4 py-3 font-medium">Tempo de casa</th>
                <th className="text-left px-4 py-3 font-medium">Situação</th>
                <th className="px-4 py-3 font-medium w-px"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map(c => {
                const st = STATUS[c.status] ?? STATUS.ativo
                return (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0 hover:bg-orange-50/40 transition">
                    <td className="px-4 py-3">
                      <Link href={`/${orgSlug}/rh/${c.id}`} className="font-medium text-gray-900 hover:text-orange-600 transition flex items-center gap-2">
                        {c.nome}
                        {c.arquivado && <Archive className="w-3.5 h-3.5 text-gray-300" />}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.cargo || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{c.tipo_vinculo ? (VINCULO[c.tipo_vinculo] ?? c.tipo_vinculo) : '—'}</td>
                    <td className="px-4 py-3 text-gray-500 tabular-nums">{fmt(c.data_admissao)}</td>
                    <td className="px-4 py-3">{(() => {
                      const p = periodo(c, hoje)
                      if (!p) return <span className="text-gray-300">—</span>
                      return (
                        <div className="leading-tight">
                          {p.exp
                            ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">{p.txt}</span>
                            : <span className="text-gray-700">{p.txt}</span>}
                          {p.sub && <div className="text-[11px] text-gray-400 mt-0.5">{p.sub}</div>}
                        </div>
                      )
                    })()}</td>
                    <td className="px-4 py-3">
                      {/* "Em aviso" é estado DERIVADO do bloco da ficha, não um
                          status novo — a pessoa segue ativa até o último dia. */}
                      {(() => {
                        const fim = c.aviso_previo_fim || c.data_demissao
                        const emAviso = c.aviso_previo_modo && c.aviso_previo_ini && fim
                          && hoje >= c.aviso_previo_ini && hoje <= fim && c.status !== 'desligado'
                        return emAviso
                          ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700" title={c.aviso_previo_modo === 'reducao_2h' ? 'Aviso prévio — jornada reduzida em 2h/dia' : 'Aviso prévio — dispensa dos últimos 7 dias'}>Em aviso até {dd(fim!)}</span>
                          : <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {/* Quem voltou: a ficha antiga volta a valer, com o
                            histórico. Nunca cadastrar de novo (mig. 273). */}
                        {(c.status === 'desligado' || c.arquivado) && (
                          <button onClick={() => reativar(c)} disabled={isPending} title="Reativar — a pessoa voltou para a casa"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 transition disabled:opacity-50">
                            <RotateCcw className="w-3.5 h-3.5" /> Reativar
                          </button>
                        )}
                        <button onClick={() => setDocsFor({ id: c.id, nome: c.nome })} title="Documentos"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-500 hover:text-orange-600 hover:bg-orange-50 transition">
                          <Paperclip className="w-3.5 h-3.5" /> Documentos
                        </button>
                        <button onClick={() => pedirExclusao(c)} disabled={isPending} title="Excluir ficha (só sem histórico)"
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {novo && <NovaPessoaModal orgSlug={orgSlug} onClose={() => setNovo(false)} />}
      <ConfirmDialog
        open={!!excluir} loading={isPending}
        title="Excluir ficha"
        description={excluir
          ? `A ficha de ${excluir.nome} será apagada de vez. Ela não tem nenhum registro de ponto, folha, `
            + 'férias ou avaliação — por isso pode sair. Não dá para desfazer.'
          : ''}
        confirmLabel="Excluir ficha"
        onConfirm={confirmarExclusao} onCancel={() => setExcluir(null)}
      />
      {docsFor && <DocumentosModal orgSlug={orgSlug} colaboradorId={docsFor.id} nome={docsFor.nome} onClose={() => setDocsFor(null)} />}
    </div>
  )
}

function NovaPessoaModal({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  const router = useRouter()
  const [nome, setNome] = useState('')
  const [cargo, setCargo] = useState('')
  const [admissao, setAdmissao] = useState('')
  const [saving, start] = useTransition()
  const [down, setDown] = useState(false)

  function salvar() {
    if (!nome.trim()) { toast.error('Informe o nome.'); return }
    start(async () => {
      const r = await salvarColaborador(orgSlug, null, { nome, cargo: cargo || null, data_admissao: admissao || null })
      if (r?.error) toast.error(r.error)
      else if (r?.id) { toast.success('Colaborador criado.'); router.push(`/${orgSlug}/rh/${r.id}`) }
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onMouseDown={() => setDown(true)}
      onClick={e => { if (down && e.target === e.currentTarget) onClose(); setDown(false) }}>
      <div className="modal-card w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200" onMouseDown={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100"><h2 className="text-base font-semibold text-gray-900">Nova pessoa</h2></div>
        <div className="px-6 py-5 space-y-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Nome *</label>
            <input autoFocus value={nome} onChange={e => setNome(e.target.value)} className={inputCls} placeholder="Nome completo" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Cargo</label>
            <input value={cargo} onChange={e => setCargo(e.target.value)} className={inputCls} placeholder="ex.: Designer" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Admissão</label>
            <input type="date" value={admissao} onChange={e => setAdmissao(e.target.value)} className={inputCls} /></div>
          <p className="text-[12px] text-gray-400">Você completa CPF, salário, documentos e demais dados na ficha.</p>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
          <button onClick={salvar} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Criar
          </button>
        </div>
      </div>
    </div>
  )
}

function fmt(d: string | null): string {
  if (!d) return '—'
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}
