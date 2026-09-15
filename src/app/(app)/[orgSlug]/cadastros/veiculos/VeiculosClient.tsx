'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, X, Check, Loader2, Archive, ArchiveRestore, Pencil, Tv, FileText, ExternalLink, MapPinned, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { createVeiculo, updateVeiculo, setVeiculoArchived } from '@/app/actions/veiculo'
import { ContatoBlocks, type ContatoData } from '@/components/ui/ContatoBlocks'
import { PdfField } from '@/components/ui/PdfField'
import { ImportInventarioModal } from './ImportInventarioModal'

export interface Veiculo {
  id: string
  name: string
  type: string | null
  tax_id: string | null
  commission_pct: number | null
  notes: string | null
  archived: boolean
  enderecos?: ContatoData['enderecos']
  telefones?: ContatoData['telefones']
  emails?: ContatoData['emails']
  contas_bancarias?: ContatoData['contas_bancarias']
  midia_kit_url?: string | null
  midia_kit_name?: string | null
}

const TYPE_OPTIONS = [
  { value: 'impressa', label: 'Impressa' },
  { value: 'eletronica', label: 'Eletrônica' },
  { value: 'externa', label: 'Externa' },
  { value: 'digital', label: 'Digital' },
  { value: 'outros', label: 'Outros' },
]
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map(o => [o.value, o.label]))

/** Sem acento e sem caixa: quem busca "gazeta" tem que achar "Gazeta". */
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

/**
 * O que falta num veículo para ele servir ao dia a dia: tipo (organiza a lista),
 * CNPJ (a PI precisa) e algum contato (sem e-mail nem telefone não dá para enviar
 * a peça — é o que o passo 3 do Hub de Mídia vai usar).
 */
function lacunas(v: Veiculo): string[] {
  const out: string[] = []
  if (!(v.type ?? '').trim()) out.push('tipo')
  if (!(v.tax_id ?? '').trim()) out.push('CNPJ')
  const temContato = (v.emails ?? []).some(e => (e.email ?? '').trim())
    || (v.telefones ?? []).some(t => (t.numero ?? '').trim())
  if (!temContato) out.push('contato')
  return out
}

const inputCls =
  'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

export function VeiculosClient({ orgSlug, veiculos, archivedView }: {
  orgSlug: string; veiculos: Veiculo[]; archivedView: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<Veiculo | null>(null)
  const [creating, setCreating] = useState(false)
  const [importando, setImportando] = useState<Veiculo | null>(null)
  const [busca, setBusca] = useState('')
  const [tiposAtivos, setTiposAtivos] = useState<string[]>([])
  // Filtros de LACUNA: o cadastro só melhora se der para ver o que falta nele.
  const [semCnpj, setSemCnpj] = useState(false)
  const [semContato, setSemContato] = useState(false)

  // Tipos que existem, por frequência — o mais usado vira o primeiro chip.
  const tiposDaOrg = useMemo(() => {
    const cont = new Map<string, number>()
    for (const v of veiculos) cont.set(v.type ?? '', (cont.get(v.type ?? '') ?? 0) + 1)
    return [...cont.entries()].sort((a, b) => b[1] - a[1])
  }, [veiculos])

  const faltando = useMemo(() => ({
    cnpj: veiculos.filter(v => !(v.tax_id ?? '').trim()).length,
    contato: veiculos.filter(v => lacunas(v).includes('contato')).length,
  }), [veiculos])

  /**
   * Busca em tudo que identifica o veículo — nome, tipo, CNPJ, observação, e-mail,
   * telefone e cidade. São 164 cadastros: procurar pelo telefone que apareceu no
   * WhatsApp é mais frequente do que lembrar a grafia exata do nome. Filtro em
   * memória porque a página já carrega a lista inteira.
   */
  const lista = useMemo(() => {
    const q = norm(busca)
    return veiculos.filter(v => {
      if (semCnpj && (v.tax_id ?? '').trim()) return false
      if (semContato && !lacunas(v).includes('contato')) return false
      // Vários tipos = união: "impressa OU externa" é o recorte que se faz na prática.
      if (tiposAtivos.length && !tiposAtivos.includes(v.type ?? '')) return false
      if (!q) return true
      const campos = [
        v.name, v.type ? TYPE_LABEL[v.type] ?? v.type : '', v.tax_id, v.notes,
        ...(v.emails ?? []).map(e => e.email),
        ...(v.telefones ?? []).map(t => t.numero),
        ...(v.enderecos ?? []).map(e => `${e.cidade ?? ''} ${e.uf ?? ''}`),
      ]
      return campos.some(c => c && norm(String(c)).includes(q))
    })
  }, [veiculos, busca, tiposAtivos, semCnpj, semContato])

  const filtrando = !!busca || tiposAtivos.length > 0 || semCnpj || semContato
  const [isPending, startTransition] = useTransition()

  function archive(v: Veiculo) {
    startTransition(async () => {
      await setVeiculoArchived(orgSlug, v.id, !v.archived)
      router.refresh()
    })
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Veículos</h1>
          <p className="text-gray-500 text-sm mt-0.5">Jornais, emissoras, mídia externa e plataformas digitais</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
            <Link href={`/${orgSlug}/cadastros/veiculos`}
              className={cn('px-2.5 py-1 rounded-md transition', !archivedView ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>
              Ativos
            </Link>
            <Link href={`/${orgSlug}/cadastros/veiculos?view=arquivados`}
              className={cn('px-2.5 py-1 rounded-md transition', archivedView ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>
              Arquivados
            </Link>
          </div>
          {!archivedView && (
            <button onClick={() => setCreating(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition">
              <Plus className="w-4 h-4" /> Adicionar veículo
            </button>
          )}
        </div>
      </div>

      {veiculos.length > 0 && (
        <div className="mb-3 space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nome, tipo, CNPJ, e-mail, telefone, cidade ou observação"
              className="w-full pl-9 pr-9 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            {busca && (
              <button onClick={() => setBusca('')} aria-label="Limpar busca"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {tiposDaOrg.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Tv className="w-3.5 h-3.5 text-gray-300 shrink-0" />
              {tiposDaOrg.map(([t, n]) => {
                const ativo = tiposAtivos.includes(t)
                return (
                  <button key={t || 'sem-tipo'}
                    onClick={() => setTiposAtivos(a => ativo ? a.filter(x => x !== t) : [...a, t])}
                    className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors active:scale-[0.97]',
                      ativo ? 'bg-gray-900 text-[#fff] border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300')}>
                    {t ? TYPE_LABEL[t] ?? t : 'sem tipo'}
                    <span className={cn('text-[10px] font-semibold', ativo ? 'text-white/70' : 'text-gray-400')}>{n}</span>
                  </button>
                )
              })}
              {tiposAtivos.length > 0 && (
                <button onClick={() => setTiposAtivos([])} className="text-xs text-gray-400 hover:text-gray-600 transition-colors ml-1">limpar</button>
              )}
            </div>
          )}

          {/* O que falta preencher. Separado dos tipos: não é "que veículo é",
              é "este cadastro está pela metade". */}
          {(faltando.cnpj > 0 || faltando.contato > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="w-3.5 shrink-0" />
              <span className="text-[11px] text-gray-400 mr-1">falta preencher:</span>
              {faltando.contato > 0 && (
                <ChipLacuna label="sem contato" n={faltando.contato} ativo={semContato} onClick={() => setSemContato(v => !v)} />
              )}
              {faltando.cnpj > 0 && (
                <ChipLacuna label="sem CNPJ" n={faltando.cnpj} ativo={semCnpj} onClick={() => setSemCnpj(v => !v)} />
              )}
            </div>
          )}

          {filtrando && (
            <p className="text-xs text-gray-400">{lista.length} de {veiculos.length} veículo(s)</p>
          )}
        </div>
      )}

      {lista.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Veículo</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Tipo</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">CNPJ</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-400">Comissão</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Mídia kit</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lista.map(v => (
                <tr key={v.id} className="hover:bg-gray-50/50 transition">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{v.name}</p>
                    {v.notes && <p className="text-xs text-gray-400 truncate max-w-xs">{v.notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{v.type ? TYPE_LABEL[v.type] ?? v.type : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{v.tax_id || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-right">{(v.commission_pct ?? 0).toString().replace('.', ',')}%</td>
                  <td className="px-4 py-3 text-sm">
                    {v.midia_kit_url ? (
                      <a href={v.midia_kit_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 transition"
                        title={v.midia_kit_name ?? 'Abrir mídia kit'}>
                        <FileText className="w-3.5 h-3.5" /> Abrir <ExternalLink className="w-3 h-3 opacity-60" />
                      </a>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {v.type === 'externa' && !v.archived && (
                        <button onClick={() => setImportando(v)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition" title="Importar/atualizar inventário de pontos">
                          <MapPinned className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => setEditing(v)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition" title="Editar">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => archive(v)} disabled={isPending}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition disabled:opacity-50"
                        title={v.archived ? 'Desarquivar' : 'Arquivar'}>
                        {v.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-24 bg-white rounded-xl border border-gray-200">
          <Tv className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">
            {filtrando ? 'Nenhum veículo com esse filtro'
              : archivedView ? 'Nenhum veículo arquivado' : 'Nenhum veículo ainda'}
          </h3>
          <p className="text-gray-500 text-sm mt-1">
            {filtrando ? 'Limpe a busca ou os filtros para ver a lista inteira.'
              : archivedView ? 'Veículos arquivados aparecem aqui.' : 'Cadastre o primeiro veículo.'}
          </p>
        </div>
      )}

      {(creating || editing) && (
        <VeiculoModal
          orgSlug={orgSlug}
          veiculo={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}
      {importando && (
        <ImportInventarioModal
          orgSlug={orgSlug}
          veiculoId={importando.id}
          veiculoNome={importando.name}
          onClose={() => setImportando(null)}
        />
      )}
    </div>
  )
}

function VeiculoModal({ orgSlug, veiculo, onClose }: {
  orgSlug: string; veiculo: Veiculo | null; onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: veiculo?.name ?? '',
    type: veiculo?.type ?? '',
    tax_id: veiculo?.tax_id ?? '',
    commission_pct: veiculo?.commission_pct != null ? String(veiculo.commission_pct).replace('.', ',') : '20',
    notes: veiculo?.notes ?? '',
    midia_kit_url: veiculo?.midia_kit_url ?? '',
    midia_kit_name: veiculo?.midia_kit_name ?? '',
  })
  const [contato, setContato] = useState<ContatoData>({
    enderecos: veiculo?.enderecos ?? [], telefones: veiculo?.telefones ?? [], emails: veiculo?.emails ?? [], contas_bancarias: veiculo?.contas_bancarias ?? [],
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Nome obrigatório'); return }
    const fd = new FormData()
    fd.set('name', form.name)
    fd.set('type', form.type)
    fd.set('tax_id', form.tax_id)
    fd.set('commission_pct', form.commission_pct.replace(',', '.'))
    fd.set('notes', form.notes)
    fd.set('enderecos', JSON.stringify(contato.enderecos))
    fd.set('telefones', JSON.stringify(contato.telefones))
    fd.set('emails', JSON.stringify(contato.emails))
    fd.set('contas_bancarias', JSON.stringify(contato.contas_bancarias))
    fd.set('midia_kit_url', form.midia_kit_url)
    fd.set('midia_kit_name', form.midia_kit_name)
    startTransition(async () => {
      const res = veiculo
        ? await updateVeiculo(orgSlug, veiculo.id, fd)
        : await createVeiculo(orgSlug, fd)
      if (res?.error) { setError(res.error); return }
      onClose()
      router.refresh()
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="text-base font-semibold text-gray-900">{veiculo ? 'Editar veículo' : 'Novo veículo'}</h2>
          <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label className={labelCls}>Nome <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ex.: Meta, Google, Gazeta do Povo" className={inputCls} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tipo</label>
              <Select value={form.type} onChange={v => setForm(f => ({ ...f, type: v }))}
                options={TYPE_OPTIONS} placeholder="Selecionar" />
            </div>
            <div>
              <label className={labelCls}>Comissão padrão (%)</label>
              <input type="text" inputMode="decimal" value={form.commission_pct}
                onChange={e => setForm(f => ({ ...f, commission_pct: e.target.value }))} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>CNPJ</label>
            <input type="text" value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))}
              placeholder="00.000.000/0000-00" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Observações</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className={cn(inputCls, 'resize-none')} />
          </div>

          <div>
            <label className={labelCls}>Mídia kit (PDF)</label>
            <PdfField
              value={form.midia_kit_url || undefined}
              name={form.midia_kit_name || undefined}
              onChange={(url, name) => setForm(f => ({ ...f, midia_kit_url: url, midia_kit_name: name }))}
            />
            <p className="text-[11px] text-gray-400 mt-1">Último mídia kit do veículo — ajuda a avaliar propostas. Abre em nova aba.</p>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <ContatoBlocks value={contato} onChange={setContato} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
            <button type="submit" disabled={isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Chip de lacuna — mesmo desenho da tela de Fornecedores. */
function ChipLacuna({ label, n, ativo, onClick }: { label: string; n: number; ativo: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors active:scale-[0.97]',
        ativo ? 'bg-amber-500 text-[#fff] border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300')}>
      {label}
      <span className={cn('text-[10px] font-semibold', ativo ? 'text-white/70' : 'text-gray-400')}>{n}</span>
    </button>
  )
}
