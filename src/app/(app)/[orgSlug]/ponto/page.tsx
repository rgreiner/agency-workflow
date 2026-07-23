import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { PontoClient, type PontoDia } from './PontoClient'
import { Clock } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function PontoPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) redirect('/login')

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) redirect('/')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: colab } = await (supabase as any)
    .from('rh_colaborador').select('id, nome')
    .eq('org_id', org.id).eq('membro_user_id', user.id).eq('arquivado', false).maybeSingle()

  if (!colab) {
    return (
      <div className="p-6 max-w-lg">
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-2"><Clock className="w-5 h-5 text-orange-600" /> Meu ponto</h1>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          Seu cadastro de colaborador ainda não está vinculado ao seu login. Peça ao RH para vincular sua ficha ao seu usuário.
        </div>
      </div>
    )
  }

  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dias } = await (supabase as any)
    .from('rh_ponto').select('data, entrada, intervalo_ini, intervalo_fim, saida, minutos, saldo_min, acima_10h, extra_status')
    .eq('colaborador_id', colab.id).order('data', { ascending: false }).limit(15)

  const lista = (dias ?? []) as PontoDia[]
  const diaHoje = lista.find(d => d.data === hoje) ?? null

  return <PontoClient orgSlug={orgSlug} colaboradorId={colab.id} nome={colab.nome} hoje={hoje} diaHoje={diaHoje} recentes={lista.filter(d => d.data !== hoje)} />
}
