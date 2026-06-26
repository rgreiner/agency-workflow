'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { slugify } from '@/lib/utils'

const COMPANY_TYPES = [
  { value: 'agencia', label: 'Agência' },
  { value: 'empresa', label: 'Empresa' },
  { value: 'freelancer', label: 'Freelancer' },
  { value: 'outro', label: 'Outro' },
]

const COMPANY_SIZES = [
  { value: '1-5', label: '1 – 5 pessoas' },
  { value: '6-20', label: '6 – 20 pessoas' },
  { value: '21-50', label: '21 – 50 pessoas' },
  { value: '50+', label: 'Mais de 50' },
]

const SEGMENTS = [
  { value: 'marketing', label: 'Marketing' },
  { value: 'comunicacao', label: 'Comunicação' },
  { value: 'publicidade', label: 'Publicidade' },
  { value: 'tech', label: 'Tecnologia' },
  { value: 'outro', label: 'Outro' },
]

export default function OnboardingStep1() {
  const router = useRouter()
  const [form, setForm] = useState({
    name: '',
    company_type: '',
    company_size: '',
    segment: '',
  })

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleNext(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams({
      name: form.name,
      type: form.company_type,
      size: form.company_size,
      segment: form.segment,
      slug: slugify(form.name),
    })
    router.push(`/onboarding/step-2?${params.toString()}`)
  }

  const isValid = form.name.trim() && form.company_type && form.company_size && form.segment

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 w-full max-w-lg">

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-indigo-600 text-[#fff] text-xs font-semibold flex items-center justify-center">1</div>
            <span className="text-sm font-medium text-indigo-600">Sua empresa</span>
          </div>
          <div className="flex-1 h-px bg-gray-200 mx-2" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-400 text-xs font-semibold flex items-center justify-center">2</div>
            <span className="text-sm text-gray-400">Seu perfil</span>
          </div>
        </div>

        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Conta sobre sua empresa</h1>
        <p className="text-gray-500 text-sm mb-8">Essas informações nos ajudam a personalizar sua experiência.</p>

        <form onSubmit={handleNext} className="space-y-6">

          {/* Nome */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Nome da empresa <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Ex: Minha Agência"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              required
            />
            {form.name && (
              <p className="text-xs text-gray-400 mt-1">
                URL: <span className="text-gray-600">/{slugify(form.name)}</span>
              </p>
            )}
          </div>

          {/* Tipo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tipo de empresa <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {COMPANY_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => set('company_type', t.value)}
                  className={`px-4 py-3 rounded-xl border text-sm font-medium transition text-left ${
                    form.company_type === t.value
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tamanho */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Número de pessoas <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {COMPANY_SIZES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => set('company_size', s.value)}
                  className={`px-4 py-3 rounded-xl border text-sm font-medium transition text-left ${
                    form.company_size === s.value
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Segmento */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Segmento <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {SEGMENTS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => set('segment', s.value)}
                  className={`px-3 py-3 rounded-xl border text-sm font-medium transition text-center ${
                    form.segment === s.value
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={!isValid}
            className="w-full py-3 bg-indigo-600 text-[#fff] font-medium rounded-xl hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Próximo →
          </button>
        </form>
      </div>
    </div>
  )
}
