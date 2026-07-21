import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PdfViewer } from '@/components/ui/PdfViewer'
import { docNumero } from '@/lib/doc-series'

// A visualização exibe o PRÓPRIO PDF (rota /api/docs/midia). Não existe mais uma
// versão HTML do documento: uma definição só, em lib/pdf/MidiaDoc.
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ orgSlug: string; midiaId: string }> }) {
  const { orgSlug, midiaId } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (supabase as any).from('midias')
    .select('numero, serie, titulo').eq('id', midiaId).maybeSingle()
  if (!m) notFound()

  return (
    <PdfViewer
      src={`/api/docs/midia/${midiaId}`}
      fileName={`${docNumero(m.serie, m.numero)} | ${m.titulo ?? ''}`}
      backHref={`/${orgSlug}/midias/eletronica`}
    />
  )
}
