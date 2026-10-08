'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Paperclip, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { downscaleImage } from '@/lib/image-resize'
import {
  SECOES_FICHA, CAMPOS_CONJUGE, CAMPOS_FILHO, faltando, progresso,
  type CampoFicha, type FichaAdmissao,
} from '@/lib/admissao-ficha'
import type { DocEnviado, DocPedido } from '@/lib/admissao-server'

const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-base sm:text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const COLS: Record<number, string> = { 2: 'col-span-2', 3: 'col-span-3', 4: 'col-span-4', 6: 'col-span-6' }

function Campo({ c, valor, onChange }: { c: CampoFicha; valor: string; onChange: (v: string) => void }) {
  const comum = { id: c.k, value: valor ?? '', className: inputCls }
  return (
    <div className={`${COLS[c.col ?? 3]} col-span-6 sm:${COLS[c.col ?? 3]}`}>
      <label className={labelCls} htmlFor={c.k}>
        {c.label}{c.obrigatorio && <span className="text-orange-600"> *</span>}
      </label>
      {c.tipo === 'select' ? (
        // <select> nativo de propósito: no celular do candidato ele abre a roda
        // do sistema, que é mais fácil do que um menu desenhado.
        <select {...comum} onChange={e => onChange(e.target.value)}>
          <option value="">—</option>
          {(c.opcoes ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input {...comum}
          type={c.tipo === 'data' ? 'date' : c.tipo === 'email' ? 'email' : c.tipo === 'tel' ? 'tel' : 'text'}
          inputMode={c.tipo === 'cpf' || c.tipo === 'cep' || c.tipo === 'numero' ? 'numeric' : undefined}
          placeholder={c.dica}
          onChange={e => onChange(e.target.value)} />
      )}
    </div>
  )
}

/**
 * A ficha de admissão preenchida pelo CANDIDATO (decisão do Rafael): são dados
 * que só ele tem. Salva rascunho quando ele quiser e, no "enviar", confere o
 * que é obrigatório e avisa o RH.
 */
export function FichaForm({ token, inicial, enviadaEm, docsPedidos, docsEnviados }: {
  token: string
  inicial: FichaAdmissao | null
  enviadaEm: string | null
  docsPedidos: DocPedido[]
  docsEnviados: DocEnviado[]
}) {
  const router = useRouter()
  const [f, setF] = useState<FichaAdmissao>(inicial ?? {})
  const [salvando, start] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [faltam, setFaltam] = useState<string[]>([])
  const [docs, setDocs] = useState<DocEnviado[]>(docsEnviados)
  // Enviou e percebeu um erro (ou o RH pediu um dado novo): dá para reabrir e
  // mandar de novo pelo mesmo link — antes só restava falar com a agência.
  const [corrigindo, setCorrigindo] = useState(false)
  const [subindo, setSubindo] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const tipoRef = useRef<string>('outro')

  const prog = useMemo(() => progresso(f), [f])
  const setSec = (sec: keyof FichaAdmissao, k: string, v: string) =>
    setF(p => ({ ...p, [sec]: { ...((p[sec] ?? {}) as Record<string, string>), [k]: v } }))

  async function gravar(final: boolean) {
    setErro(null)
    if (final) {
      const falta = faltando(f)
      const semDoc = docsPedidos.filter(d => d.obrigatorio && !docs.some(x => x.tipo === d.tipo))
      if (falta.length || semDoc.length) {
        setFaltam([...falta, ...semDoc.map(d => `Anexo: ${d.label}`)])
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
    }
    setFaltam([])
    const r = await fetch(`/api/proposta/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'ficha', ficha: f, final }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErro(j.error ?? 'Não foi possível salvar.'); return }
    if (final) setCorrigindo(false)
    router.refresh()
  }

  async function anexar(file: File) {
    setErro(null)
    setSubindo(tipoRef.current)
    try {
      // Foto do celular é pesada: encolhe antes de subir (regra da casa).
      const arq = file.type.startsWith('image/') ? await downscaleImage(file) : file
      const fd = new FormData()
      fd.append('arquivo', arq)
      fd.append('tipo', tipoRef.current)
      const r = await fetch(`/api/proposta/${token}/arquivo`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.error ?? 'Não consegui anexar.'); return }
      setDocs(d => [...d, { id: j.id, tipo: j.tipo, nome: j.nome }])
    } finally {
      setSubindo(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function removerDoc(id: string) {
    const r = await fetch(`/api/proposta/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'apagar-doc', docId: id }),
    })
    if (r.ok) setDocs(d => d.filter(x => x.id !== id))
  }

  if (enviadaEm && !corrigindo) {
    const faltaAgora = faltando(f)
    return (
      <div className="bg-white rounded-2xl border border-emerald-200 p-6">
        <div className="flex items-start gap-3">
          <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Ficha enviada</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Recebemos seus dados e seus {docs.length} anexo(s).
            </p>
            {faltaAgora.length > 0 && (
              <p className="text-sm text-amber-800 bg-amber-50 ring-1 ring-amber-200 rounded-xl px-3 py-2 mt-3">
                Falta <b>{faltaAgora.length === 1 ? faltaAgora[0] : `${faltaAgora.length} informações`}</b> —
                é só abrir e completar.
              </p>
            )}
            <button onClick={() => setCorrigindo(true)}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-[0.97] transition-colors">
              <Pencil className="w-3.5 h-3.5" /> {faltaAgora.length ? 'Completar a ficha' : 'Corrigir alguma coisa'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-900">
          {corrigindo ? 'Corrigir a ficha' : 'Ficha de admissão'}
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {corrigindo
            ? 'Ajuste o que precisar e envie de novo — a agência é avisada.'
            : 'São os dados do seu registro em carteira. Pode salvar e voltar depois — o link continua valendo.'}
        </p>
        <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-orange-500 rounded-full transition-all"
            style={{ width: `${Math.round((prog.feitos / prog.total) * 100)}%` }} />
        </div>
        <p className="text-[11px] text-gray-400 mt-1 tabular-nums">{prog.feitos} de {prog.total} campos</p>
      </div>

      {faltam.length > 0 && (
        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-sm text-amber-900">
          <b>Falta preencher:</b>
          <ul className="mt-1 list-disc list-inside text-[13px] text-amber-800">
            {faltam.slice(0, 8).map(x => <li key={x}>{x}</li>)}
            {faltam.length > 8 && <li>e mais {faltam.length - 8}…</li>}
          </ul>
        </div>
      )}
      {erro && <p className="rounded-xl bg-red-50 ring-1 ring-red-200 px-4 py-3 text-sm text-red-800">{erro}</p>}

      {SECOES_FICHA.map(s => (
        <section key={s.id} className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900">{s.titulo}</h3>
          {s.descricao && <p className="text-xs text-gray-500 mt-0.5 mb-3">{s.descricao}</p>}
          <div className="grid grid-cols-6 gap-3 mt-3">
            {s.campos.map(c => (
              <Campo key={c.k} c={c}
                valor={((f[s.id as keyof FichaAdmissao] ?? {}) as Record<string, string>)[c.k] ?? ''}
                onChange={v => setSec(s.id as keyof FichaAdmissao, c.k, v)} />
            ))}
          </div>
        </section>
      ))}

      <section className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900">Dependentes</h3>
        <p className="text-xs text-gray-500 mt-0.5 mb-3">Só se tiver. Entram no imposto de renda e no salário-família.</p>
        <div className="grid grid-cols-6 gap-3">
          {CAMPOS_CONJUGE.map(c => (
            <Campo key={c.k} c={c} valor={(f.conjuge ?? {})[c.k] ?? ''}
              onChange={v => setSec('conjuge', c.k, v)} />
          ))}
        </div>
        {(f.filhos ?? []).map((filho, i) => (
          <div key={i} className="grid grid-cols-6 gap-3 mt-3 pt-3 border-t border-gray-100">
            {CAMPOS_FILHO.map(c => (
              <Campo key={c.k} c={{ ...c, label: `${c.label} do filho ${i + 1}` }} valor={filho[c.k] ?? ''}
                onChange={v => setF(p => {
                  const filhos = [...(p.filhos ?? [])]
                  filhos[i] = { ...filhos[i], [c.k]: v }
                  return { ...p, filhos }
                })} />
            ))}
            <div className="col-span-6">
              <button onClick={() => setF(p => ({ ...p, filhos: (p.filhos ?? []).filter((_, x) => x !== i) }))}
                className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> remover filho {i + 1}
              </button>
            </div>
          </div>
        ))}
        <button onClick={() => setF(p => ({ ...p, filhos: [...(p.filhos ?? []), {}] }))}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Adicionar filho
        </button>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900">Documentos</h3>
        <p className="text-xs text-gray-500 mt-0.5 mb-3">Foto ou PDF, até 15MB cada. Dá para fotografar com o celular.</p>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={e => { const file = e.target.files?.[0]; if (file) anexar(file) }} />
        <ul className="space-y-2">
          {docsPedidos.map(d => {
            const enviados = docs.filter(x => x.tipo === d.tipo)
            return (
              <li key={d.tipo} className="flex flex-wrap items-center gap-2 py-1">
                <span className="text-sm text-gray-700 flex-1 min-w-0">
                  {d.label}{d.obrigatorio && <span className="text-orange-600"> *</span>}
                  {enviados.map(x => (
                    <span key={x.id} className="inline-flex items-center gap-1 ml-2 text-[11px] text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">
                      <Paperclip className="w-3 h-3" /> {x.nome}
                      <button onClick={() => removerDoc(x.id)} className="text-emerald-700/60 hover:text-red-500 transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </span>
                <button onClick={() => { tipoRef.current = d.tipo; inputRef.current?.click() }} disabled={!!subindo}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-[0.97] transition-colors disabled:opacity-50">
                  {subindo === d.tipo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {enviados.length ? 'Trocar' : 'Anexar'}
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-5">
        <label className={labelCls} htmlFor="obs">Alguma observação para o RH?</label>
        <textarea id="obs" rows={2} value={f.observacao ?? ''} className={inputCls}
          onChange={e => setF(p => ({ ...p, observacao: e.target.value }))} />
      </section>

      <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-gray-50/95 backdrop-blur border-t border-gray-200 flex flex-wrap items-center justify-end gap-2">
        <button onClick={() => start(() => { gravar(false) })} disabled={salvando}
          className="px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 active:scale-[0.97] transition-colors disabled:opacity-50">
          Salvar e continuar depois
        </button>
        <button onClick={() => start(() => { gravar(true) })} disabled={salvando}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-[#fff] text-sm font-semibold rounded-xl hover:bg-orange-700 active:scale-[0.97] transition-colors disabled:opacity-50">
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Enviar ficha
        </button>
      </div>
    </div>
  )
}
