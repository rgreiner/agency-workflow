import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { hojeBRT } from '@/lib/hoje'
import { MeuEspelhoClient } from './MeuEspelhoClient'

export const dynamic = 'force-dynamic'

export default async function MeuEspelhoPage({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ comp?: string }>
}) {
  const { orgSlug } = await params
  const { comp } = await searchParams
  const user = await getUsuario()
  if (!user) redirect('/login')

  const supabase = await createClient()
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) redirect('/')

  // A ficha vinculada ao login (RLS self permite ler a própria).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: colab } = await (supabase as any)
    .from('rh_colaborador').select('id, nome')
    .eq('org_id', org.id).eq('membro_user_id', user.id).maybeSingle()

  if (!colab) {
    return (
      <div className="p-6 max-w-xl">
        <p className="text-sm text-gray-500">Sua ficha ainda não está vinculada ao login — fale com o RH.</p>
      </div>
    )
  }

  const competencia = comp && /^\d{4}-\d{2}$/.test(comp) ? comp : hojeBRT().slice(0, 7)
  return <MeuEspelhoClient orgSlug={orgSlug} colaboradorId={colab.id} compInicial={competencia} />
}
