'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { slugify } from '@/lib/utils'

export default function OnboardingPage() {
  const [orgName, setOrgName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  async function createOrg(e: React.FormEvent) {
    e.preventDefault()
    if (!orgName.trim()) return

    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const slug = slugify(orgName)

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({ name: orgName.trim(), slug, plan: 'free', max_members: 5 })
      .select()
      .single()

    if (orgError) {
      setError(orgError.message.includes('unique') ? 'Esse nome já está em uso.' : orgError.message)
      setLoading(false)
      return
    }

    await supabase.from('organization_members').insert({
      org_id: org.id,
      user_id: user.id,
      role: 'owner',
    })

    router.push(`/${org.slug}/dashboard`)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 w-full max-w-md">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Crie sua organização</h1>
          <p className="text-gray-500 mt-1 text-sm">Nome da sua agência ou empresa</p>
        </div>

        <form onSubmit={createOrg} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nome da organização
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Ex: Minha Agência"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              required
            />
            {orgName && (
              <p className="text-xs text-gray-400 mt-1">
                URL: <span className="text-gray-600">/{slugify(orgName)}</span>
              </p>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading || !orgName.trim()}
            className="w-full py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Criando...' : 'Criar organização'}
          </button>
        </form>
      </div>
    </div>
  )
}
