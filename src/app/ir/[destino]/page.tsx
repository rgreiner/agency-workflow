import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'

/**
 * Redirecionador dos atalhos do PWA (manifest.shortcuts). O manifest é estático
 * e não sabe a org do usuário — aqui a gente resolve o slug (mesma regra da
 * HomePage: vínculo arquivado não conta) e manda pro destino certo.
 */
const DESTINOS: Record<string, string> = {
  ponto: 'ponto',
  pauta: 'inbox',
}

export default async function IrPage({ params }: { params: Promise<{ destino: string }> }) {
  const { destino } = await params
  const path = DESTINOS[destino]
  if (!path) redirect('/')

  const user = await getUsuario()
  if (!user) redirect('/login')

  const supabase = await createClient()
  const { data: membership } = await supabase
    .from('organization_members')
    .select('organizations(slug)')
    .eq('user_id', user.id)
    .eq('arquivado', false)
    .limit(1)
    .maybeSingle()

  if (membership?.organizations) {
    const org = membership.organizations as { slug: string }
    redirect(`/${org.slug}/${path}`)
  }

  redirect('/')
}
