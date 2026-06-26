'use client'

import { useState, useTransition } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createOrganizationWithProfile } from '@/app/actions/org'

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return digits.replace(/^(\d{0,2})/, '($1')
  if (digits.length <= 6) return digits.replace(/^(\d{2})(\d{0,4})/, '($1) $2')
  if (digits.length <= 10) return digits.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3')
  return digits.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3')
}

export default function OnboardingStep2() {
  const params = useSearchParams()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    full_name: '',
    role_title: '',
    phone: '',
  })

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    const formData = new FormData()
    formData.set('name', params.get('name') ?? '')
    formData.set('slug', params.get('slug') ?? '')
    formData.set('company_type', params.get('type') ?? '')
    formData.set('company_size', params.get('size') ?? '')
    formData.set('segment', params.get('segment') ?? '')
    formData.set('full_name', form.full_name)
    formData.set('role_title', form.role_title)
    formData.set('phone', form.phone)

    startTransition(async () => {
      const result = await createOrganizationWithProfile(formData)
      if (result?.error) setError(result.error)
    })
  }

  const isValid = form.full_name.trim() && form.role_title.trim()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 w-full max-w-lg">

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-orange-100 text-orange-600 text-xs font-semibold flex items-center justify-center">✓</div>
            <span className="text-sm text-gray-400">Sua empresa</span>
          </div>
          <div className="flex-1 h-px bg-orange-200 mx-2" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-orange-600 text-[#fff] text-xs font-semibold flex items-center justify-center">2</div>
            <span className="text-sm font-medium text-orange-600">Seu perfil</span>
          </div>
        </div>

        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Agora sobre você</h1>
        <p className="text-gray-500 text-sm mb-8">Como sua equipe vai te identificar na plataforma.</p>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Nome completo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nome completo <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.full_name}
              onChange={(e) => set('full_name', e.target.value)}
              placeholder="Ex: Rafael Greiner"
              className="w-full px-4 py-3 bg-gray-100 border border-transparent rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              required
            />
          </div>

          {/* Cargo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Cargo / função <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.role_title}
              onChange={(e) => set('role_title', e.target.value)}
              placeholder="Ex: Diretor de Arte, Atendimento, CEO..."
              className="w-full px-4 py-3 bg-gray-100 border border-transparent rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              required
            />
          </div>

          {/* Telefone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Telefone / WhatsApp
              <span className="text-gray-400 font-normal ml-1">(opcional)</span>
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => set('phone', maskPhone(e.target.value))}
              placeholder="(00) 00000-0000"
              className="w-full px-4 py-3 bg-gray-100 border border-transparent rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition"
            >
              ← Voltar
            </button>
            <button
              type="submit"
              disabled={!isValid || isPending}
              className="flex-1 py-3 bg-orange-600 text-[#fff] font-medium rounded-xl hover:bg-orange-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPending ? 'Criando conta...' : 'Criar conta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
