import Link from 'next/link'
import { docNumero, SERIE_LABELS } from '@/lib/doc-series'

export interface DocRef {
  /** id do documento de origem (producao.id ou midias.id) */
  id: string | null
  serie: string | null
  numero: number | null
  /** 'producao' | 'midia' — define a rota */
  origem: string | null
  /** fee | pedido | proposta | orcamento (só quando origem = 'producao') */
  producaoTipo?: string | null
}

/**
 * Rota do documento que originou a cobrança. Mídia cai sempre na rota
 * `simplificada`, que atende todos os tipos — as rotas por tipo (externas,
 * digitais, impressa…) não têm mapa 1:1 com `midias.tipo`.
 */
export function docHref(orgSlug: string, doc: DocRef): string | null {
  if (!doc.id) return null
  if (doc.origem === 'producao') return doc.producaoTipo ? `/${orgSlug}/producao/${doc.producaoTipo}/${doc.id}` : null
  if (doc.origem === 'midia') return `/${orgSlug}/midias/simplificada/${doc.id}`
  return null
}

/**
 * Chip "MX 1567" / "PP 1783" / "FEE 34" que liga o registro financeiro ao trabalho
 * que o gerou. Antes o código só existia dentro da descrição (herança de quando
 * Flow e financeiro eram sistemas separados); agora é vínculo de verdade e leva ao
 * documento. Abre em nova aba pra não perder a lista/filtro de onde a pessoa veio.
 */
export function DocChip({ orgSlug, doc, size = 'sm' }: { orgSlug: string; doc: DocRef; size?: 'sm' | 'md' }) {
  if (!doc.numero) return null
  const label = docNumero(doc.serie, doc.numero)
  const href = docHref(orgSlug, doc)
  const cls = size === 'md'
    ? 'text-xs font-semibold px-2 py-1 rounded-lg'
    : 'text-[10px] font-semibold px-1.5 py-0.5 rounded-md'
  const base = `inline-flex items-center gap-1 tabular-nums border transition-colors ${cls}`
  const title = doc.serie ? (SERIE_LABELS[doc.serie] ?? label) : label

  if (!href) {
    return <span className={`${base} text-gray-600 bg-gray-100 border-transparent`} title={title}>{label}</span>
  }
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title={`${title} — abrir o documento`}
      className={`${base} text-orange-700 bg-orange-50 border-orange-100 hover:bg-orange-100 hover:border-orange-200 active:scale-[0.97]`}
    >
      {label}
    </Link>
  )
}
