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
  // Por RPC, e não direto da tabela: `rh_ponto.saldo_min` é o número gravado
  // quando o ponto foi batido — não sabe de feriado, emenda nem abono do RH.
  // Lendo dali, esta tela mostrava -0h39 num dia que o espelho já dava -0h09.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dias } = await (supabase as any)
    .rpc('rh_ponto_recentes', { p_colaborador: colab.id, p_limite: 15 })

  const lista = ((dias ?? []) as PontoDia[])
  const diaHoje = lista.find(d => d.data === hoje) ?? null

  return <PontoClient orgSlug={orgSlug} colaboradorId={colab.id} nome={colab.nome} hoje={hoje} diaHoje={diaHoje} recentes={lista.filter(d => d.data !== hoje)} />
}
