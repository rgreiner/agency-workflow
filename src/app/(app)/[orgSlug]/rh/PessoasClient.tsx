'use client'

import { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { UserCog, Plus, Loader2, Archive, Paperclip, Trash2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { salvarColaborador, impactoExcluirColaborador, excluirColaborador, reativarColaborador,
  type ImpactoExcluirColab } from '@/app/actions/rh'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { nomeLegivel } from '@/lib/nomes'
import { DocumentosModal } from './DocumentosModal'

export interface ColaboradorRow {
  id: string
  nome: string
  cargo: string | null
  tipo_vinculo: string | null
  status: string
  data_admissao: string | null
  /** Entrada na casa (mig. 290): quem virou CLT tem admissão nova, mas o tempo
   *  de casa continua contando do estágio. Vazio = igual à admissão. */
  data_entrada_casa?: string | null
  data_demissao: string | null
  arquivado: boolean
  /** Aviso prévio em curso (migs. 262/263) — vira o chip "em aviso". */
  aviso_previo_ini?: string | null
  aviso_previo_fim?: string | null
  aviso_previo_modo?: string | null
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
/** Rótulo da coluna: experiência (1º/2º período), tempo de casa efetivado, ou duração se desligado.
 *  Duas réguas diferentes de propósito: a EXPERIÊNCIA conta do contrato atual
 *  (a admissão CLT), o TEMPO DE CASA conta de quando a pessoa entrou. Para quem
 *  foi efetivada, são datas distintas. */
function periodo(c: ColaboradorRow, hoje: string): { txt: string; sub?: string; urgente?: boolean } | null {
  if (!c.data_admissao) return null
  const naCasa = c.data_entrada_casa ?? c.data_admissao
  if (c.status === 'desligado') return { txt: `durou ${tempoDeCasa(naCasa, c.data_demissao || hoje)}` }
  const days = diffDays(c.data_admissao, hoje)
  const temExperiencia = c.tipo_vinculo !== 'estagio' && c.tipo_vinculo !== 'pj' && c.tipo_vinculo !== 'socio'
  if (temExperiencia && days >= 0 && days <= 90) {
    const primeiro = days <= 45
    const limite = primeiro ? 45 : 90
    const faltam = limite - days
    // Âmbar só na reta final — é quando existe decisão a tomar (prorrogar aos
    // 45 dias, efetivar aos 90). Aceso em todo mundo, o aviso não avisava nada.
    return {
      urgente: faltam <= 10,
      txt: `Experiência ${primeiro ? '1º' : '2º'}${faltam <= 10 ? ` · faltam ${faltam} d` : ''}`,
      sub: `${days}/${limite} d · ${primeiro ? 'vence' : 'efetiva'} ${dd(addDays(c.data_admissao, limite))}`,
    }
  }
  return { txt: tempoDeCasa(naCasa, hoje), sub: `aniversário ${dd(naCasa)}` }
}
/**
 * Marca só o que FOGE do normal. "Ativo" em toda linha não informava nada e
 * ainda disputava a atenção com o nome; o olho procura a exceção.
 * "Em aviso" é estado derivado do bloco da ficha, não um status novo — a
 * pessoa segue ativa até o último dia.
 */
function marcador(c: ColaboradorRow, hoje: string): { label: string; cls: string; title?: string } | null {
  const fim = c.aviso_previo_fim || c.data_demissao
  if (c.aviso_previo_modo && c.aviso_previo_ini && fim && hoje >= c.aviso_previo_ini && hoje <= fim && c.status !== 'desligado') {
    return {
      label: `Em aviso até ${dd(fim)}`, cls: 'bg-amber-50 text-amber-800',
      title: c.aviso_previo_modo === 'reducao_2h'
        ? 'Aviso prévio — jornada reduzida em 2h/dia'
        : 'Aviso prévio — dispensa dos últimos 7 dias',
    }
  }
  if (c.status === 'desligado') {
    return { label: c.data_demissao ? `Desligado em ${dd(c.data_demissao)}` : 'Desligado', cls: 'bg-gray-100 text-gray-500' }
  }
  if (c.status === 'afastado') return { label: 'Afastado', cls: 'bg-amber-50 text-amber-800' }
  return null
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
      setExcluir({ id: c.id, nome: nomeLegivel(c.nome), imp })
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
      toast.success(`${nomeLegivel(c.nome).split(' ')[0]} reativado(a) — o histórico continua na ficha. O acesso é liberado em Membros.`)
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
                {/* Cargo entrou embaixo do nome e "Situação" virou marca só de
                    exceção: com 7 colunas o nome quebrava em duas linhas. */}
                <th className="text-left px-4 py-2.5 font-medium">Pessoa</th>
                <th className="text-left px-4 py-2.5 font-medium">Vínculo</th>
                <th className="text-left px-4 py-2.5 font-medium">Admissão</th>
                <th className="text-left px-4 py-2.5 font-medium">Tempo de casa</th>
                <th className="px-4 py-2.5 font-medium w-px"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map(c => {
                const p = periodo(c, hoje)
                const marca = marcador(c, hoje)
                return (
                  <tr key={c.id} className="group border-b border-gray-50 last:border-0 hover:bg-orange-50/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <Link href={`/${orgSlug}/rh/${c.id}`} className="block">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          {/* O cadastro vem da folha em CAIXA ALTA; aqui ele é
                              lido, não conferido. O valor gravado não muda. */}
                          <span className="font-medium text-gray-900 group-hover:text-orange-600 transition-colors">
                            {nomeLegivel(c.nome)}
                          </span>
                          {c.arquivado && <Archive className="w-3.5 h-3.5 text-gray-300" aria-label="Arquivado" />}
                          {marca && (
                            <span title={marca.title}
                              className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${marca.cls}`}>
                              {marca.label}
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-gray-500 mt-0.5">{c.cargo || 'Sem cargo'}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{c.tipo_vinculo ? (VINCULO[c.tipo_vinculo] ?? c.tipo_vinculo) : '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500 tabular-nums">
                      {fmt(c.data_admissao)}
                      {/* Efetivada: a admissão é a do contrato de hoje, mas ela
                          já estava aqui antes — a coluna diria menos sem isso. */}
                      {c.data_entrada_casa && c.data_admissao && c.data_entrada_casa < c.data_admissao && (
                        <div className="text-[11px] text-gray-400">na casa desde {fmt(c.data_entrada_casa)}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {!p ? <span className="text-gray-300">—</span> : (
                        <div className="leading-tight">
                          {p.urgente
                            ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800">{p.txt}</span>
                            : <span className="text-gray-700">{p.txt}</span>}
                          {p.sub && <div className="text-[11px] text-gray-400 mt-0.5">{p.sub}</div>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        {/* Quem voltou: a ficha antiga volta a valer, com o
                            histórico. Nunca cadastrar de novo (mig. 273). */}
                        {(c.status === 'desligado' || c.arquivado) && (
                          <button onClick={() => reativar(c)} disabled={isPending} title="Reativar — a pessoa voltou para a casa"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-50">
                            <RotateCcw className="w-3.5 h-3.5" /> Reativar
                          </button>
                        )}
                        <button onClick={() => setDocsFor({ id: c.id, nome: nomeLegivel(c.nome) })} title="Documentos"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition-colors">
                          <Paperclip className="w-3.5 h-3.5" /> Documentos
                        </button>
                        {/* Excluir é raro e sem volta: aparece ao passar na linha
                            (no toque, onde não há hover, fica sempre visível). */}
                        <button onClick={() => pedirExclusao(c)} disabled={isPending} title="Excluir ficha (só sem histórico)"
                          aria-label={`Excluir a ficha de ${nomeLegivel(c.nome)}`}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50
                                     sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100">
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
