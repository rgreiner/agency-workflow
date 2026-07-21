import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PdfViewer } from '@/components/ui/PdfViewer'
import { docNumero } from '@/lib/doc-series'

// A visualização exibe o PRÓPRIO PDF (rota /api/docs/producao). Uma definição só,
// em lib/pdf/ProducaoDoc — o que se vê é exatamente o que se baixa.
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ orgSlug: string; producaoId: string }> }) {
  const { orgSlug, producaoId } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: p } = await (supabase as any).from('producao')
    .select('numero, serie, titulo').eq('id', producaoId).maybeSingle()
  if (!p) notFound()

  return (
    <PdfViewer
      src={`/api/docs/producao/${producaoId}`}
      fileName={`${docNumero(p.serie, p.numero)} | ${p.titulo ?? ''}`}
      backHref={`/${orgSlug}/producao/orcamento/${producaoId}`}
    />
  )
}
