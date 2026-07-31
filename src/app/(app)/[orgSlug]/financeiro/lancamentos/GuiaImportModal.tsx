'use client'

/**
 * Importar guia (Darf/FGTS/DAS/GPS/parcelamento): sobe o PDF, a IA extrai
 * valor/vencimento/competência, o servidor busca o lançamento provisionado em
 * aberto correspondente — aplicar ATUALIZA o existente (previsto → realizado)
 * com a guia anexada; sem correspondente, cria um lançamento novo.
 */
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Landmark, Loader2, Plus, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/midia'
import { Select } from '@/components/ui/Select'
import { uploadFile } from '@/lib/storage/upload-client'
import { categoriaNomes } from '@/lib/finance-categorias'
import {
  buscarCandidatosGuia, aplicarGuiaLancamento, createLancamento,
  type GuiaCandidato, type FinanceCategoriaGrupo, type FinanceCentro, type Anexo,
} from '@/app/actions/financeiro'

interface GuiaExtraida {
  tipo: string
  orgao: string | null
  numero: string | null
  competencia: string | null
  valor: number | null
  vencimento: string | null
  descricao: string | null
  palavras_chave: string[]
}

const TIPO_LABEL: Record<string, string> = {
  darf: 'Darf / DCTFweb', fgts: 'FGTS', das: 'DAS (Simples)', gps: 'GPS',
  parcelamento: 'Parcelamento', outro: 'Guia',
}
/** Palpite de categoria pro modo "criar" (mesma família de padrões do servidor). */
const TIPO_CATEGORIA: Record<string, RegExp> = {
  darf: /darf|dctf|inss|irrf/i, fgts: /fgts/i, das: /\bdas\b|simples/i,
  gps: /\bgps\b|inss|previd/i, parcelamento: /passivo|parcelamento/i,
}

const money = 'w-36 px-3 py-2 text-sm text-right bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'
const dateI = 'px-3 py-2 text-sm bg-gray-100 border border-transparent rounded-xl text-gray-800'
const brl = (v: number) => formatBRL(v).replace('R$', '').trim()
const parseBR = (s: string) => Number(s.trim().replace(/\./g, '').replace(',', '.')) || 0
const ddmm = (iso: string | null) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—'

export function GuiaImportModal({ orgSlug, file, categorias, centros, onClose }: {
  orgSlug: string; file: File
  categorias: FinanceCategoriaGrupo[]; centros: FinanceCentro[]
  onClose: () => void
}) {
  const router = useRouter()
  const [fase, setFase] = useState<'lendo' | 'pronto' | 'erro'>('lendo')
  const [erro, setErro] = useState('')
  const [guia, setGuia] = useState<GuiaExtraida | null>(null)
  const [url, setUrl] = useState('')
  const [candidatos, setCandidatos] = useState<GuiaCandidato[]>([])
  // Alvo escolhido: id do lançamento ou 'novo'.
  const [alvo, setAlvo] = useState<string>('novo')
  const [valor, setValor] = useState('')
  const [venc, setVenc] = useState('')
  const [comp, setComp] = useState('')
  const [categoria, setCategoria] = useState('')
  const [centro, setCentro] = useState('')
  const [saving, start] = useTransition()
  const [down, setDown] = useState(false)
  const rodou = useRef(false)

  useEffect(() => {
    if (rodou.current) return
    rodou.current = true
    ;(async () => {
      try {
        const fd = new FormData()
        fd.append('orgSlug', orgSlug); fd.append('file', file)
        const [u, res] = await Promise.all([
          uploadFile('lancamentos', `${crypto.randomUUID()}.pdf`, file),
          fetch('/api/financeiro/guia/extract', { method: 'POST', body: fd }),
        ])
        const j = await res.json()
        if (!res.ok) { setErro(j.error || 'Falha na extração'); setFase('erro'); return }
        const g = j as GuiaExtraida
        setUrl(u); setGuia(g)
        setValor(g.valor != null ? brl(g.valor) : '')
        setVenc(g.vencimento ?? '')
        setComp(g.competencia ?? '')
        const r = await buscarCandidatosGuia(orgSlug, g)
        const cs = ('candidatos' in r ? r.candidatos : []) ?? []
        setCandidatos(cs)
        setAlvo(cs[0]?.id ?? 'novo')
        // Palpites do modo criar: herda do melhor candidato; sem candidato, casa
        // a categoria da org com o padrão do tipo.
        const nomes = categoriaNomes(categorias, 'saida')
        const rx = TIPO_CATEGORIA[g.tipo]
        setCategoria(cs[0]?.categoria ?? (rx ? nomes.find(n => rx.test(n)) ?? '' : ''))
        setCentro(cs[0]?.centro_custo ?? '')
        setFase('pronto')
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Falha na leitura da guia')
        setFase('erro')
      }
    })()
  }, [orgSlug, file, categorias])

  function aplicar() {
    if (!guia) return
    const v = parseBR(valor)
    if (v <= 0) { toast.error('Informe o valor da guia.'); return }
    if (!venc) { toast.error('Informe o vencimento.'); return }
    const anexo: Anexo = {
      url, nome: file.name, tipo: 'Guia',
      numero: guia.numero ?? undefined, emitente: 'fornecedor',
    }
    start(async () => {
      if (alvo !== 'novo') {
        const r = await aplicarGuiaLancamento(orgSlug, {
          lancamentoId: alvo, valor: v, vencimento: venc, competencia: comp || null, anexo,
        })
        if (r?.error) { toast.error(r.error); return }
        toast.success('Guia aplicada — lançamento atualizado com o valor real.')
      } else {
        if (!centro) { toast.error('Informe o centro de custo.'); return }
        const r = await createLancamento(orgSlug, {
          tipo: 'saida',
          contato_tipo: 'outro',
          contato_nome: guia.orgao ?? TIPO_LABEL[guia.tipo] ?? 'Guia',
          descricao: guia.descricao ?? file.name,
          valor: String(v),
          vencimento: venc,
          competencia: comp ? `${comp}-01` : venc,
          categoria: categoria || null,
          centro_custo: centro,
          forma_pagamento: 'transferencia',
          anexos: [anexo],
        })
        if (r?.error) { toast.error(r.error); return }
        toast.success('Guia lançada como novo lançamento a pagar.')
      }
      onClose(); router.refresh()
    })
  }

  const centroOptions = [{ value: '', label: '—' }, ...centros.filter(c => !c.arquivado).map(c => ({ value: c.nome, label: c.nome }))]
  const categoriaOptions = [{ value: '', label: '—' }, ...categoriaNomes(categorias, 'saida').map(n => ({ value: n, label: n }))]

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onMouseDown={() => setDown(true)}
      onClick={e => { if (down && e.target === e.currentTarget) onClose(); setDown(false) }}>
      <div className="modal-card w-full max-w-lg max-h-[90vh] overflow-hidden bg-white rounded-2xl shadow-xl border border-gray-200 flex flex-col" onMouseDown={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Landmark className="w-4 h-4 text-orange-600" /> Importar guia</h2>
          <p className="text-xs text-gray-500 mt-0.5 truncate" title={file.name}><FileText className="w-3 h-3 inline mr-1 -mt-0.5" />{file.name}</p>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {fase === 'lendo' && (
            <p className="text-sm text-gray-400 py-10 text-center flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Lendo a guia…
            </p>
          )}
          {fase === 'erro' && <p className="text-sm text-red-600 py-8 text-center">{erro}</p>}
          {fase === 'pronto' && guia && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-orange-100 text-orange-700">{TIPO_LABEL[guia.tipo] ?? 'Guia'}</span>
                <span className="text-sm text-gray-700 truncate">{guia.descricao ?? guia.orgao ?? ''}</span>
              </div>

              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <input inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} placeholder="valor" className={money} />
                <input type="date" value={venc} onChange={e => setVenc(e.target.value)} className={dateI} title="Vencimento" />
                <input type="month" value={comp} onChange={e => setComp(e.target.value)} className={dateI} title="Competência" />
              </div>

              <h3 className="text-xs font-semibold text-gray-600 mb-1.5">Aplicar em</h3>
              <div className="rounded-xl border border-gray-200 divide-y divide-gray-50 mb-3">
                {candidatos.map(c => (
                  <label key={c.id} className={cn('flex items-start gap-2.5 px-3.5 py-2.5 cursor-pointer transition-colors', alvo === c.id ? 'bg-orange-50/60' : 'hover:bg-gray-50')}>
                    <input type="radio" name="alvo" checked={alvo === c.id} onChange={() => setAlvo(c.id)} className="mt-1 text-orange-600 focus:ring-orange-500" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-gray-900 truncate">{c.descricao || c.categoria || c.contato_nome}</span>
                      <span className="block text-xs text-gray-500 tabular-nums">
                        {formatBRL(c.valor)} · vence {ddmm(c.vencimento)}{c.categoria ? ` · ${c.categoria}` : ''}
                        {parseBR(valor) > 0 && Math.abs(c.valor - parseBR(valor)) > 0.005 && (
                          <span className="text-sky-700"> → atualiza para {formatBRL(parseBR(valor))}</span>
                        )}
                      </span>
                    </span>
                  </label>
                ))}
                <label className={cn('flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer transition-colors', alvo === 'novo' ? 'bg-orange-50/60' : 'hover:bg-gray-50')}>
                  <input type="radio" name="alvo" checked={alvo === 'novo'} onChange={() => setAlvo('novo')} className="text-orange-600 focus:ring-orange-500" />
                  <span className="text-sm text-gray-700 inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Criar lançamento novo</span>
                </label>
              </div>
              {candidatos.length === 0 && (
                <p className="text-[11px] text-amber-600 mb-3">Nenhum lançamento em aberto combina com esta guia no mês do vencimento.</p>
              )}

              {alvo === 'novo' && (
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Categoria</label>
                    <Select value={categoria} onChange={setCategoria} options={categoriaOptions} size="sm" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Centro de custo</label>
                    <Select value={centro} onChange={setCentro} options={centroOptions} size="sm" />
                  </div>
                </div>
              )}

              <p className="text-[11px] text-gray-400">
                {alvo !== 'novo'
                  ? 'A guia atualiza o lançamento em aberto (valor real, vencimento) e fica anexada a ele.'
                  : 'A guia entra como novo lançamento a pagar, já com o PDF anexado.'}
              </p>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancelar</button>
          <button onClick={aplicar} disabled={saving || fase !== 'pronto'}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-colors active:scale-[0.97]">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Landmark className="w-4 h-4" />} Aplicar
          </button>
        </div>
      </div>
    </div>
  )
}
