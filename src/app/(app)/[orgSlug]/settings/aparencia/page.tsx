'use client'

import { useState, useTransition } from 'react'
import { useParams } from 'next/navigation'
import { STATUS_CONFIG } from '@/types'
import type { StatusOverride } from '@/types'
import { upsertOrgSettings } from '@/app/actions/org-settings'
import { useOrgSettings } from '@/components/providers/OrgSettingsProvider'
import { toast } from 'sonner'
import { Loader2, RotateCcw } from 'lucide-react'

const ACCENT_PRESETS = [
  '#6366f1', // indigo (default)
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#0ea5e9', // sky
  '#6b7280', // gray
  '#111827', // dark
]

export default function AparenciaPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const settings = useOrgSettings()
  const [isPending, startTransition] = useTransition()

  const [logoUrl,     setLogoUrl]     = useState(settings.logoUrl ?? '')
  const [accentColor, setAccentColor] = useState(settings.accentColor)
  const [overrides,   setOverrides]   = useState<StatusOverride[]>(settings.statusOverrides)

  const orgId = settings.orgId

  function getOverride(value: string): StatusOverride {
    return overrides.find(o => o.value === value) ?? { value }
  }

  function setOverride(value: string, patch: Partial<StatusOverride>) {
    setOverrides(prev => {
      const existing = prev.find(o => o.value === value)
      if (existing) {
        return prev.map(o => o.value === value ? { ...o, ...patch } : o)
      }
      return [...prev, { value, ...patch }]
    })
  }

  function resetStatus(value: string) {
    setOverrides(prev => prev.filter(o => o.value !== value))
  }

  function handleSave() {
    startTransition(async () => {
      const result = await upsertOrgSettings(
        orgId,
        logoUrl || null,
        accentColor,
        overrides.filter(o => o.label || o.bg || o.text),
      )
      if (result?.error) toast.error(result.error)
      else toast.success('Configurações salvas!')
    })
  }

  return (
    <div className="space-y-8 max-w-2xl">

      {/* ── Identidade ── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Identidade</h2>
        <p className="text-xs text-gray-500 mb-4">Logo e cor principal da sua organização.</p>

        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">

          {/* Logo */}
          <div className="px-5 py-4">
            <label className="block text-xs font-medium text-gray-700 mb-2">Logo (URL)</label>
            <div className="flex items-center gap-3">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo" className="w-10 h-10 rounded-lg object-contain bg-gray-50 border border-gray-200" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-xs border border-gray-200">
                  {orgSlug.charAt(0).toUpperCase()}
                </div>
              )}
              <input
                type="url"
                value={logoUrl}
                onChange={e => setLogoUrl(e.target.value)}
                placeholder="https://sua-empresa.com/logo.png"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Recomendado: PNG ou SVG com fundo transparente, mínimo 64×64px.</p>
          </div>

          {/* Accent color */}
          <div className="px-5 py-4">
            <label className="block text-xs font-medium text-gray-700 mb-2">Cor de destaque</label>
            <div className="flex items-center gap-3 flex-wrap">
              {ACCENT_PRESETS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAccentColor(c)}
                  className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: accentColor === c ? c : 'transparent',
                    outline: accentColor === c ? `2px solid ${c}` : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input
                  type="color"
                  value={accentColor}
                  onChange={e => setAccentColor(e.target.value)}
                  className="w-7 h-7 rounded cursor-pointer border border-gray-200"
                />
                Personalizado
              </label>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Usada em botões, abas ativas e destaques da interface.
            </p>
          </div>
        </div>
      </section>

      {/* ── Status ── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Status das atividades</h2>
        <p className="text-xs text-gray-500 mb-4">Personalize os nomes e cores de cada etapa do fluxo.</p>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_120px_120px_32px] gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            <span>Nome</span>
            <span>Cor de fundo</span>
            <span>Cor do texto</span>
            <span />
          </div>

          {STATUS_CONFIG.map(s => {
            const o = getOverride(s.value)
            const currentBg   = o.bg   ?? s.bg
            const currentText = o.text ?? s.text
            const isModified  = !!(o.label || o.bg || o.text)

            return (
              <div
                key={s.value}
                className="grid grid-cols-[1fr_120px_120px_32px] gap-3 items-center px-4 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/40 transition"
              >
                {/* Name */}
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0"
                    style={{ backgroundColor: currentBg, color: currentText }}
                  >
                    {o.label ?? s.label}
                  </span>
                  <input
                    type="text"
                    value={o.label ?? s.label}
                    onChange={e => setOverride(s.value, { label: e.target.value === s.label ? undefined : e.target.value })}
                    className="flex-1 text-xs border border-transparent hover:border-gray-200 focus:border-indigo-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-transparent min-w-0"
                  />
                </div>

                {/* BG color */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="color"
                    value={currentBg}
                    onChange={e => setOverride(s.value, { bg: e.target.value })}
                    className="w-6 h-6 rounded cursor-pointer border border-gray-200"
                  />
                  <span className="text-[11px] text-gray-500 font-mono">{currentBg}</span>
                </label>

                {/* Text color */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="color"
                    value={currentText}
                    onChange={e => setOverride(s.value, { text: e.target.value })}
                    className="w-6 h-6 rounded cursor-pointer border border-gray-200"
                  />
                  <span className="text-[11px] text-gray-500 font-mono">{currentText}</span>
                </label>

                {/* Reset */}
                <button
                  type="button"
                  onClick={() => resetStatus(s.value)}
                  disabled={!isModified}
                  title="Restaurar padrão"
                  className="p-1 rounded text-gray-300 hover:text-gray-500 disabled:opacity-0 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* Save button */}
      <div className="flex justify-end pb-8">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-50"
        >
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Salvar aparência
        </button>
      </div>
    </div>
  )
}
