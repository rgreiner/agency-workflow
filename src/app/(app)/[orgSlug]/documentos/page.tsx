import { createClient } from '@/lib/supabase/server'
import { DocumentosClient, type DocHistLinha } from './DocumentosClient'

// Busca da própria API (PostgREST) — o builder não alcança o IP público do VPS.
export const dynamic = 'force-dynamic'

export default async function DocumentosPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw } = await (supabase as any)
    .from('doc_historico')
    .select('serie, numero, documento, emissao, vencimento, contato, descricao, cliente, valor')
    .eq('org_id', org.id)
    .order('numero', { ascending: false })
    .limit(5000)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linhas: DocHistLinha[] = (raw ?? []).map((r: any) => ({
    serie: r.serie as string,
    numero: r.numero as number,
    documento: r.documento as string,
    emissao: (r.emissao as string) ?? null,
    vencimento: (r.vencimento as string) ?? null,
    contato: (r.contato as string) ?? null,
    descricao: (r.descricao as string) ?? null,
    cliente: (r.cliente as string) ?? null,
    valor: Number(r.valor ?? 0),
  }))

  return <DocumentosClient linhas={linhas} />
}
