import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ConviteLoginButton } from './ConviteLoginButton'
import { AlertTriangle, Users } from 'lucide-react'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Proprietário',
  admin: 'Admin',
  manager: 'Gerente',
  member: 'Membro',
  viewer: 'Visualizador',
}

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-red-100 text-red-700',
  manager: 'bg-blue-100 text-blue-700',
  member: 'bg-indigo-100 text-indigo-700',
  viewer: 'bg-gray-100 text-gray-600',
}

export default async function ConvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  // Fetch invite link with org info
  const { data: invite } = await supabase
    .from('org_invite_links')
    .select('token, is_active, role, organizations(name, slug)')
    .eq('token', token)
    .single()

  // Invalid or inactive link
  if (!invite || !invite.is_active) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
          <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            Link inválido ou expirado
          </h1>
          <p className="text-sm text-gray-500">
            Este link de convite não é mais válido. Peça um novo link ao administrador da organização.
          </p>
        </div>
      </div>
    )
  }

  const org = invite.organizations as unknown as { name: string; slug: string } | null

  if (!org) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
          <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            Link inválido ou expirado
          </h1>
          <p className="text-sm text-gray-500">
            Este link de convite não é mais válido. Peça um novo link ao administrador da organização.
          </p>
        </div>
      </div>
    )
  }

  // User is logged in — accept the invite and redirect
  if (user) {
    const { data: slug, error } = await supabase.rpc('accept_invite_link', {
      p_user_id: user.id,
      p_token: token,
    })

    const destination = slug ?? org.slug
    redirect(`/${destination}/workspaces`)
  }

  // User is NOT logged in — show invite landing page
  const roleLabel = ROLE_LABELS[invite.role] ?? invite.role
  const roleColor = ROLE_COLORS[invite.role] ?? 'bg-indigo-100 text-indigo-700'

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-indigo-600 rounded-2xl shadow-lg mb-4">
            <Users className="w-7 h-7 text-white" />
          </div>
          <p className="text-sm font-medium text-indigo-600 tracking-wide uppercase">
            Agency Workflow
          </p>
        </div>

        {/* Invite card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Você foi convidado!
            </h1>
            <p className="text-gray-500 text-sm">
              Você foi convidado para entrar em
            </p>
            <p className="text-lg font-semibold text-gray-800 mt-1">
              {org.name}
            </p>
          </div>

          {/* Role badge */}
          <div className="flex items-center justify-center mb-8">
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-full border border-gray-100">
              <span className="text-xs text-gray-500">Você entrará como</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleColor}`}>
                {roleLabel}
              </span>
            </div>
          </div>

          {/* Login button */}
          <ConviteLoginButton token={token} />

          <p className="text-center text-xs text-gray-400 mt-4">
            Ao entrar, você concorda em fazer parte desta organização como {roleLabel.toLowerCase()}.
          </p>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Já tem uma conta? O login com Google vinculará automaticamente ao seu perfil existente.
        </p>
      </div>
    </div>
  )
}
