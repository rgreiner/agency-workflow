'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Plus, Trash2, RotateCcw, AlertTriangle, ArrowUpRight, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  DRE_GRUPOS, DRE_MAPA_PADRAO, subsDaOrg, mapaDaOrg, compararCodigo, dentroDe,
  type DreConfig, type DreSub,
} from '@/lib/dre-template'
import { salvarDreEstrutura } from '@/app/actions/dre'

export interface CategoriaDre {
  nome: string
  /** Direção do grupo no cadastro; null = só existe no padrão da DRE. */
  tipo: 'entrada' | 'saida' | 'ambos' | null
}

/** Sentinela do Select: o componente trata '' como "nada escolhido". */
const FORA = '__fora'

const inputCls = 'px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500'

export function DreEstruturaClient({ orgSlug, categorias, config: inicial }: {
  orgSlug: string
  categorias: CategoriaDre[]
  config: DreConfig | null
}) {
  const [config, setConfig] = useState<DreConfig>(inicial ?? {})
  const [pending, start] = useTransition()
  const [novoEm, setNovoEm] = useState<string | null>(null)   // código do pai do subgrupo sendo criado
  const [novoNome, setNovoNome] = useState('')
  const [editando, setEditando] = useState<{ code: string; label: string } | null>(null)
  const [excluir, setExcluir] = useState<DreSub | null>(null)

  const subs = useMemo(() => subsDaOrg(config), [config])
  const mapa = useMemo(() => mapaDaOrg(config), [config])
  const tipoDe = useMemo(() => new Map(categorias.map(c => [c.nome, c.tipo])), [categorias])

  const opcoes = useMemo(() => [
    ...subs.map(s => ({ value: s.code, label: `${s.code} · ${s.label}` })),
    { value: FORA, label: 'Sem linha (fora da DRE)' },
  ], [subs])

  const semLinha = categorias.filter(c => !mapa.has(c.nome)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  const daSub = (code: string) => categorias.filter(c => mapa.get(c.nome) === code)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  /** Grava e só confirma na tela se o servidor aceitou — senão volta ao estado anterior. */
  function salvar(prox: DreConfig, ok?: string) {
    const antes = config
    setConfig(prox)
    start(async () => {
      const res = await salvarDreEstrutura(orgSlug, prox)
      if (res.error) { setConfig(antes); toast.error(res.error) }
      else if (ok) toast.success(ok)
    })
  }

  /** Move a categoria. Guarda só a diferença: voltar ao padrão apaga a entrada. */
  function mover(cat: string, destino: string) {
    const sub = destino === FORA ? '' : destino
    const m = { ...(config.mapa ?? {}) }
    if ((DRE_MAPA_PADRAO[cat] ?? '') === sub) delete m[cat]
    else m[cat] = sub
    salvar({ ...config, mapa: m })
  }

  function criarSub(pai: string) {
    const label = novoNome.trim()
    if (!label) return
    const grupo = pai.slice(0, 2)
    const nivel = pai.split('.').length + 1
    const filhos = subs.filter(s => s.code.startsWith(`${pai}.`) && s.code.split('.').length === nivel)
    const n = filhos.reduce((mx, s) => Math.max(mx, Number(s.code.split('.').pop())), 0) + 1
    const code = `${pai}.${n}`
    salvar({ ...config, subs: [...(config.subs ?? []), { code, label, grupo }] }, `${code} ${label} criado`)
    setNovoEm(null); setNovoNome('')
  }

  function renomear() {
    if (!editando) return
    const label = editando.label.trim()
    if (!label) return
    salvar({ ...config, subs: (config.subs ?? []).map(s => s.code === editando.code ? { ...s, label } : s) })
    setEditando(null)
  }

  function confirmarExclusao() {
    if (!excluir) return
    // Some junto o que se abre dentro dele; as categorias voltam ao padrão.
    const fora = (s: string) => dentroDe(s, excluir.code)
    const m = Object.fromEntries(Object.entries(config.mapa ?? {}).filter(([, s]) => !fora(s)))
    salvar({ subs: (config.subs ?? []).filter(s => !fora(s.code)), mapa: m }, `${excluir.code} ${excluir.label} excluído`)
    setExcluir(null)
  }

  const nasExcluidas = excluir ? categorias.filter(c => { const s = mapa.get(c.nome); return !!s && dentroDe(s, excluir.code) }).length : 0

  // Funções de render, não componentes: componente declarado aqui dentro seria
  // um tipo novo a cada render e remontaria o campo a cada tecla.
  function linhaCategoria(c: CategoriaDre) {
    const atual = mapa.get(c.nome) ?? FORA
    const alterada = (config.mapa ?? {})[c.nome] !== undefined
    const tipo = tipoDe.get(c.nome)
    return (
      <li key={c.nome} className="flex items-center gap-3 py-1.5 pl-3 pr-1 rounded-lg hover:bg-gray-50 transition-colors">
        <span className="flex-1 min-w-0 truncate text-sm text-gray-800">
          {c.nome}
          {tipo && tipo !== 'ambos' && (
            <span className="ml-2 text-[11px] text-gray-400">{tipo === 'entrada' ? 'receita' : 'despesa'}</span>
          )}
        </span>
        {alterada && (
          <button type="button" onClick={() => mover(c.nome, DRE_MAPA_PADRAO[c.nome] ?? FORA)} disabled={pending}
            title="Voltar para a linha padrão"
            className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-orange-600 transition-colors active:scale-[0.97]">
            <RotateCcw className="w-3 h-3" /> padrão
          </button>
        )}
        <div className="w-64 shrink-0">
          <Select size="sm" align="right" value={atual} options={opcoes} onChange={v => mover(c.nome, v)} />
        </div>
      </li>
    )
  }

  function novoSub(pai: string) {
    if (novoEm !== pai) return null
    return (
      <form onSubmit={e => { e.preventDefault(); criarSub(pai) }} className="flex items-center gap-2 mt-2 ml-3">
        <input autoFocus value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Nome do subgrupo"
          className={cn(inputCls, 'flex-1 max-w-xs')} onKeyDown={e => { if (e.key === 'Escape') setNovoEm(null) }} />
        <button type="submit" disabled={!novoNome.trim() || pending}
          className="px-3 py-2 rounded-xl text-sm font-medium bg-orange-500 text-[#fff] hover:bg-orange-600 disabled:opacity-50 transition-colors active:scale-[0.97]">
          Criar
        </button>
        <button type="button" onClick={() => setNovoEm(null)} className="px-2 py-2 text-sm text-gray-500 hover:text-gray-800 transition-colors">Cancelar</button>
      </form>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Estrutura da DRE</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Em qual linha da DRE cada categoria entra. Categoria sem linha aparece em
            &ldquo;Fora da estrutura contábil&rdquo; no fim da DRE. Categoria nova se cadastra em
            {' '}<Link href={`/${orgSlug}/financeiro/categorias`} className="text-orange-600 hover:text-orange-700">Categorias</Link> e se encaixa aqui.
          </p>
        </div>
        <Link href={`/${orgSlug}/views/gestao?aba=financeiro`}
          className="shrink-0 inline-flex items-center gap-1 text-sm font-medium text-orange-600 hover:text-orange-700">
          Ver a DRE <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </header>

      {semLinha.length > 0 && (
        <section className="rounded-2xl bg-amber-50/70 border border-amber-100 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle className="w-4 h-4" /> Sem linha na DRE · {semLinha.length}
          </h2>
          <p className="text-xs text-amber-700/80 mt-0.5 mb-2">
            Escolha a linha de cada uma. Estorno e numerário em trânsito costumam pedir correção no lançamento, não uma linha.
          </p>
          <ul>{semLinha.map(linhaCategoria)}</ul>
        </section>
      )}

      {DRE_GRUPOS.map(g => {
        const subsDoGrupo = subs.filter(s => s.grupo === g.code)
        return (
          <section key={g.code} className="rounded-2xl bg-white border border-gray-100 shadow-[0_1px_12px_-6px_rgba(0,0,0,0.08)] p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 className="text-sm font-semibold text-gray-900">
                <span className="text-gray-400 tabular-nums mr-1.5">{g.code}</span>{g.label}
              </h2>
              <button type="button" onClick={() => { setNovoEm(g.code); setNovoNome('') }}
                className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-orange-600 transition-colors active:scale-[0.97]">
                <Plus className="w-3.5 h-3.5" /> Subgrupo
              </button>
            </div>
            {novoSub(g.code)}

            <div className="space-y-3 mt-2">
              {subsDoGrupo.sort((a, b) => compararCodigo(a.code, b.code)).map(s => {
                const cats = daSub(s.code)
                const aninhado = s.code.split('.').length > 2
                const editandoEste = editando?.code === s.code
                return (
                  <div key={s.code} className={cn(aninhado && 'ml-6 pl-3 border-l border-gray-100')}>
                    <div className="group/sub flex items-center gap-2 min-h-8">
                      <span className="text-xs text-gray-400 tabular-nums w-12 shrink-0">{s.code}</span>
                      {editandoEste ? (
                        <form onSubmit={e => { e.preventDefault(); renomear() }} className="flex items-center gap-1 flex-1">
                          <input autoFocus value={editando.label} onChange={e => setEditando({ code: s.code, label: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Escape') setEditando(null) }}
                            className={cn(inputCls, 'py-1 flex-1 max-w-xs')} />
                          <button type="submit" aria-label="Salvar nome" className="p-1.5 text-gray-500 hover:text-orange-600 transition-colors"><Check className="w-4 h-4" /></button>
                          <button type="button" aria-label="Cancelar" onClick={() => setEditando(null)} className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors"><X className="w-4 h-4" /></button>
                        </form>
                      ) : (
                        <span className={cn('text-[13px] font-medium text-gray-600', s.custom && 'cursor-text hover:text-gray-900')}
                          onClick={s.custom ? () => setEditando({ code: s.code, label: s.label }) : undefined}
                          title={s.custom ? 'Clique para renomear' : undefined}>
                          {s.label}
                        </span>
                      )}
                      {s.custom && !editandoEste && (
                        <span className="text-[10px] uppercase tracking-wide text-orange-600/80 bg-orange-50 rounded px-1.5 py-0.5">da casa</span>
                      )}
                      <span className="flex-1" />
                      {!aninhado && (
                        <button type="button" onClick={() => { setNovoEm(s.code); setNovoNome('') }}
                          title={`Abrir um subgrupo dentro de ${s.code}`}
                          className="opacity-0 group-hover/sub:opacity-100 focus:opacity-100 inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-orange-600 transition-[color,opacity]">
                          <Plus className="w-3 h-3" /> dentro
                        </button>
                      )}
                      {s.custom && (
                        <button type="button" onClick={() => setExcluir(s)} aria-label={`Excluir ${s.label}`}
                          className="p-1 text-gray-300 hover:text-red-500 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {novoSub(s.code)}
                    {cats.length > 0
                      ? <ul className="mt-0.5">{cats.map(linhaCategoria)}</ul>
                      : <p className="text-xs text-gray-300 pl-3 py-1">Nenhuma categoria</p>}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      <ConfirmDialog
        open={!!excluir}
        title={excluir ? `Excluir ${excluir.code} ${excluir.label}?` : ''}
        description={nasExcluidas > 0
          ? `${nasExcluidas} categoria${nasExcluidas > 1 ? 's voltam' : ' volta'} para a linha padrão, ou fica${nasExcluidas > 1 ? 'm' : ''} sem linha se não tiver padrão.`
          : 'Nenhuma categoria está nele.'}
        loading={pending}
        onConfirm={confirmarExclusao}
        onCancel={() => setExcluir(null)}
      />
    </div>
  )
}
