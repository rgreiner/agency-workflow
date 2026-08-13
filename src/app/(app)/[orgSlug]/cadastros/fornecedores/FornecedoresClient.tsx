'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, X, Check, Loader2, Archive, ArchiveRestore, Pencil, Truck, Search, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { createFornecedor, updateFornecedor, setFornecedorArchived } from '@/app/actions/fornecedor'
import { ContatoBlocks, type ContatoData } from '@/components/ui/ContatoBlocks'
import { buscarCnpj } from '@/app/actions/lookup'
import { TagInput } from '@/components/ui/TagInput'

export interface Fornecedor {
  id: string; name: string; tipo: string | null; tax_id: string | null; notes: string | null; archived: boolean
  /** Serviços/especialidades (migration 235) — complementa o `tipo` único. */
  tags?: string[] | null
  enderecos?: ContatoData['enderecos']; telefones?: ContatoData['telefones']; emails?: ContatoData['emails']; contas_bancarias?: ContatoData['contas_bancarias']
}

/** Sem acento e sem caixa: quem busca "grafica" tem que achar "Gráfica". */
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

export function FornecedoresClient({ orgSlug, fornecedores, archivedView }: {
  orgSlug: string; fornecedores: Fornecedor[]; archivedView: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<Fornecedor | null>(null)
  const [creating, setCreating] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [busca, setBusca] = useState('')
  const [tagsAtivas, setTagsAtivas] = useState<string[]>([])
  // Filtros de LACUNA: o cadastro só melhora se der pra ver o que falta nele.
  const [semTipo, setSemTipo] = useState(false)
  const [semTag, setSemTag] = useState(false)

  // Tags que existem na org, por frequência — as mais usadas viram os primeiros chips.
  const tagsDaOrg = useMemo(() => {
    const cont = new Map<string, number>()
    for (const f of fornecedores) for (const t of f.tags ?? []) cont.set(t, (cont.get(t) ?? 0) + 1)
    return [...cont.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
  }, [fornecedores])

  const faltando = useMemo(() => ({
    tipo: fornecedores.filter(f => !(f.tipo ?? '').trim()).length,
    tag: fornecedores.filter(f => !(f.tags?.length)).length,
  }), [fornecedores])

  const tiposDaOrg = useMemo(
    () => [...new Set(fornecedores.map(f => (f.tipo ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [fornecedores],
  )

  /**
   * Busca em TUDO que identifica o fornecedor — nome, tipo, tag, CNPJ, observação,
   * e-mail, telefone e cidade. São 394 cadastros: procurar por "camiseta" ou pelo
   * telefone que apareceu no WhatsApp é mais frequente do que lembrar o nome exato.
   * Filtro em memória porque a página já carrega a lista inteira.
   */
  const lista = useMemo(() => {
    const q = norm(busca)
    return fornecedores.filter(f => {
      if (semTipo && (f.tipo ?? '').trim()) return false
      if (semTag && (f.tags?.length ?? 0) > 0) return false
      // Várias tags = interseção: quem faz gráfica E brinde.
      if (tagsAtivas.length && !tagsAtivas.every(t => (f.tags ?? []).some(x => norm(x) === norm(t)))) return false
      if (!q) return true
      const campos = [
        f.name, f.tipo, f.tax_id, f.notes, ...(f.tags ?? []),
        ...(f.emails ?? []).map(e => e.email),
        ...(f.telefones ?? []).map(t => t.numero),
        ...(f.enderecos ?? []).map(e => `${e.cidade ?? ''} ${e.uf ?? ''}`),
      ]
      return campos.some(c => c && norm(String(c)).includes(q))
    })
  }, [fornecedores, busca, tagsAtivas, semTipo, semTag])

  function archive(f: Fornecedor) {
    startTransition(async () => { await setFornecedorArchived(orgSlug, f.id, !f.archived); router.refresh() })
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Fornecedores</h1>
          <p className="text-gray-500 text-sm mt-0.5">Gráficas, brindes, produtoras e demais fornecedores</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
            <Link href={`/${orgSlug}/cadastros/fornecedores`} className={cn('px-2.5 py-1 rounded-md transition', !archivedView ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>Ativos</Link>
            <Link href={`/${orgSlug}/cadastros/fornecedores?view=arquivados`} className={cn('px-2.5 py-1 rounded-md transition', archivedView ? 'bg-gray-900 text-[#fff]' : 'text-gray-500 hover:text-gray-700')}>Arquivados</Link>
          </div>
          {!archivedView && (
            <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition">
              <Plus className="w-4 h-4" /> Adicionar fornecedor
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, tipo, tag, CNPJ, e-mail, telefone, cidade ou observação"
            className="w-full pl-9 pr-9 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {busca && (
            <button onClick={() => setBusca('')} aria-label="Limpar busca"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {tagsDaOrg.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Tag className="w-3.5 h-3.5 text-gray-300 shrink-0" />
            {tagsDaOrg.map(([t, n]) => {
              const ativa = tagsAtivas.includes(t)
              return (
                <button key={t}
                  onClick={() => setTagsAtivas(a => ativa ? a.filter(x => x !== t) : [...a, t])}
                  className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors active:scale-[0.97]',
                    ativa ? 'bg-gray-900 text-[#fff] border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300')}>
                  {t}
                  <span className={cn('text-[10px] font-semibold', ativa ? 'text-white/70' : 'text-gray-400')}>{n}</span>
                </button>
              )
            })}
            {tagsAtivas.length > 0 && (
              <button onClick={() => setTagsAtivas([])} className="text-xs text-gray-400 hover:text-gray-600 transition-colors ml-1">limpar</button>
            )}
          </div>
        )}

        {/* O que falta preencher. Separado das tags por uma barra: não é "que serviço
            faz", é "este cadastro está pela metade". */}
        {(faltando.tipo > 0 || faltando.tag > 0) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="w-3.5 shrink-0" />
            <span className="text-[11px] text-gray-400 mr-1">falta preencher:</span>
            {faltando.tipo > 0 && (
              <ChipLacuna label="sem tipo" n={faltando.tipo} ativo={semTipo} onClick={() => setSemTipo(v => !v)} />
            )}
            {faltando.tag > 0 && (
              <ChipLacuna label="sem tag" n={faltando.tag} ativo={semTag} onClick={() => setSemTag(v => !v)} />
            )}
          </div>
        )}

        {(busca || tagsAtivas.length > 0 || semTipo || semTag) && (
          <p className="text-xs text-gray-400">
            {lista.length} de {fornecedores.length} fornecedor(es)
            {tagsAtivas.length > 1 && ' · quem tem todas as tags marcadas'}
            {semTipo && semTag && ' · sem tipo e sem tag'}
          </p>
        )}
      </div>

      {lista.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-xs font-medium text-gray-400">
                <th className="text-left px-4 py-3">Fornecedor</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-left px-4 py-3">CNPJ</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lista.map(f => (
                <tr key={f.id} className="hover:bg-gray-50/50 transition">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{f.name}</p>
                    {(f.tags?.length ?? 0) > 0 && (
                      <div className="flex items-center gap-1 flex-wrap mt-0.5">
                        {f.tags!.map(t => (
                          <button key={t} onClick={() => setTagsAtivas(a => a.includes(t) ? a : [...a, t])}
                            title={`Filtrar por ${t}`}
                            className="px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-700 text-[10px] font-medium hover:bg-orange-100 transition-colors">
                            {t}
                          </button>
                        ))}
                      </div>
                    )}
                    {f.notes && <p className="text-xs text-gray-400 truncate max-w-xs">{f.notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{f.tipo || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{f.tax_id || '—'}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setEditing(f)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => archive(f)} disabled={isPending} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition disabled:opacity-50" title={f.archived ? 'Desarquivar' : 'Arquivar'}>
                        {f.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
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
          <Truck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium">
            {busca || tagsAtivas.length
              ? 'Nada encontrado'
              : archivedView ? 'Nenhum fornecedor arquivado' : 'Nenhum fornecedor ainda'}
          </h3>
          <p className="text-gray-500 text-sm mt-1">
            {busca || tagsAtivas.length
              ? 'Ajuste a busca ou tire alguma tag do filtro.'
              : archivedView ? 'Fornecedores arquivados aparecem aqui.' : 'Cadastre o primeiro fornecedor.'}
          </p>
        </div>
      )}

      {(creating || editing) && (
        <FornecedorModal orgSlug={orgSlug} fornecedor={editing}
          tagsSugeridas={tagsDaOrg.map(([t]) => t)} tiposSugeridos={tiposDaOrg}
          onClose={() => { setCreating(false); setEditing(null) }} />
      )}
    </div>
  )
}

function ChipLacuna({ label, n, ativo, onClick }: { label: string; n: number; ativo: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      title={`Mostrar só os ${n} fornecedor(es) ${label}`}
      className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-dashed transition-colors active:scale-[0.97]',
        ativo ? 'bg-amber-500 text-[#fff] border-amber-500' : 'bg-white text-amber-700 border-amber-300 hover:bg-amber-50')}>
      {label}
      <span className={cn('text-[10px] font-semibold', ativo ? 'text-white/80' : 'text-amber-500')}>{n}</span>
    </button>
  )
}

function FornecedorModal({ orgSlug, fornecedor, tagsSugeridas, tiposSugeridos, onClose }: {
  orgSlug: string; fornecedor: Fornecedor | null
  tagsSugeridas: string[]; tiposSugeridos: string[]; onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: fornecedor?.name ?? '', tipo: fornecedor?.tipo ?? '', tax_id: fornecedor?.tax_id ?? '', notes: fornecedor?.notes ?? '',
  })
  const [tags, setTags] = useState<string[]>(fornecedor?.tags ?? [])
  const [contato, setContato] = useState<ContatoData>({
    enderecos: fornecedor?.enderecos ?? [], telefones: fornecedor?.telefones ?? [], emails: fornecedor?.emails ?? [], contas_bancarias: fornecedor?.contas_bancarias ?? [],
  })
  const [cnpjBusy, setCnpjBusy] = useState(false)

  async function fetchCnpj() {
    if (cnpjBusy) return
    setCnpjBusy(true)
    const r = await buscarCnpj(form.tax_id)
    setCnpjBusy(false)
    if (r.error || !r.data) { toast.error(r.error ?? 'CNPJ não encontrado'); return }
    const d = r.data
    setForm(f => ({ ...f, name: f.name.trim() ? f.name : (d.nome_fantasia || d.razao_social) }))
    setContato(c => {
      const end = { tipo: 'Comercial', logradouro: d.logradouro, numero: d.numero, complemento: d.complemento, bairro: d.bairro, cidade: d.cidade, uf: d.uf, cep: d.cep }
      const enderecos = c.enderecos.length ? c.enderecos.map((e, i) => i === 0 ? { ...e, ...end } : e) : [end]
      const telefones = d.telefone && !c.telefones.some(t => t.numero.trim()) ? [{ tipo: 'Comercial', numero: d.telefone }, ...c.telefones] : c.telefones
      const emails = d.email && !c.emails.some(e => e.email.trim()) ? [{ tipo: 'Financeiro', email: d.email }, ...c.emails] : c.emails
      return { ...c, enderecos, telefones, emails }
    })
    toast.success('Dados do CNPJ preenchidos.')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Nome obrigatório'); return }
    const fd = new FormData()
    fd.set('name', form.name); fd.set('tipo', form.tipo); fd.set('tax_id', form.tax_id); fd.set('notes', form.notes)
    fd.set('enderecos', JSON.stringify(contato.enderecos)); fd.set('telefones', JSON.stringify(contato.telefones))
    fd.set('emails', JSON.stringify(contato.emails)); fd.set('contas_bancarias', JSON.stringify(contato.contas_bancarias))
    fd.set('tags', JSON.stringify(tags))
    startTransition(async () => {
      const res = fornecedor ? await updateFornecedor(orgSlug, fornecedor.id, fd) : await createFornecedor(orgSlug, fd)
      if (res?.error) { setError(res.error); return }
      onClose(); router.refresh()
    })
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="modal-card w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{fornecedor ? 'Editar fornecedor' : 'Novo fornecedor'}</h2>
          <button aria-label="Fechar" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div><label className={labelCls}>Nome <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tipo</label>
              {/* datalist: sugere os tipos já usados sem impedir um novo */}
              <input list="fornecedor-tipos" value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))} placeholder="Gráfica, brindes…" className={inputCls} />
              <datalist id="fornecedor-tipos">{tiposSugeridos.map(t => <option key={t} value={t} />)}</datalist>
            </div>
            <div><label className={labelCls}>CNPJ</label>
              <div className="flex gap-2">
                <input value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))} placeholder="00.000.000/0000-00" className={inputCls} />
                <button type="button" onClick={fetchCnpj} disabled={cnpjBusy} title="Buscar dados públicos do CNPJ"
                  className="inline-flex items-center gap-1.5 px-3 rounded-xl bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200 transition disabled:opacity-50 shrink-0">
                  {cnpjBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <div>
            <label className={labelCls}>Tags <span className="text-gray-400 font-normal">— tudo que este fornecedor faz</span></label>
            <TagInput value={tags} onChange={setTags} sugestoes={tagsSugeridas} placeholder="camiseta, adesivo, banner…" />
          </div>
          <div><label className={labelCls}>Observações</label><textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={cn(inputCls, 'resize-none')} /></div>
          <div className="border-t border-gray-100 pt-4"><ContatoBlocks value={contato} onChange={setContato} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
            <button type="submit" disabled={isPending} className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
