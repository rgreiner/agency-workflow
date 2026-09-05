'use client'

import { useState, useTransition, useRef } from 'react'
import { useParams } from 'next/navigation'
import type { StatusOverride } from '@/types'
import { StatusManager } from './StatusManager'
import { upsertOrgSettings } from '@/app/actions/org-settings'
import { useOrgSettings } from '@/components/providers/OrgSettingsProvider'
import { uploadFile } from '@/lib/storage/upload-client'
import { toast } from 'sonner'
import { Loader2, Upload, X } from 'lucide-react'

const ACCENT_PRESETS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#ff6a00', // laranja da identidade do Flow (brand/README.md)
  '#f97316', // orange (default)
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
  const [uploading,   setUploading]   = useState(false)
  const [accentColor, setAccentColor] = useState(settings.accentColor)
  const [overrides]                   = useState<StatusOverride[]>(settings.statusOverrides)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const orgId    = settings.orgId

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'png'
    const path = `${orgId}/logo.${ext}`
    setUploading(true)
    try {
      const url = await uploadFile('org-logos', path, file)
      setLogoUrl(`${url}?t=${Date.now()}`)
      toast.success('Logo enviado!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha no upload')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleSave() {
    startTransition(async () => {
      // Nome/cor de status agora vivem em `org_status` (StatusManager); aqui ficam
      // logo e cor de destaque. Os overrides antigos seguem sendo repassados
      // intactos para não apagar o histórico de quem ainda não migrou.
      const result = await upsertOrgSettings(orgId, logoUrl || null, accentColor, overrides)
      if (result?.error) toast.error(result.error)
      else toast.success('Configurações salvas!')
    })
  }

  return (
    // 3xl e não 2xl: a grade de status é 52+150+190+36 fixos, e a 672px sobrava menos
    // de 170px para o nome do status.
    <div className="space-y-8 max-w-3xl">

      {/* ── Identidade ── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Identidade</h2>
        <p className="text-xs text-gray-500 mb-4">Logo e cor principal da sua organização.</p>

        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">

          {/* Logo */}
          <div className="px-5 py-4">
            <label className="block text-xs font-medium text-gray-700 mb-3">Logo da organização</label>
            <div className="flex items-center gap-4">

              {/* Preview */}
              <div className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 shrink-0 overflow-hidden">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
                ) : (
                  <span className="text-2xl font-bold text-gray-300">{orgSlug.charAt(0).toUpperCase()}</span>
                )}
              </div>

              <div className="flex-1 space-y-2">
                {/* File upload button */}
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".png,.svg,.jpg,.jpeg,.webp,image/png,image/svg+xml,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 border border-transparent rounded-xl hover:bg-gray-50 transition disabled:opacity-50 font-medium text-gray-700"
                  >
                    {uploading
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Upload className="w-4 h-4" />
                    }
                    {uploading ? 'Enviando…' : 'Enviar arquivo'}
                  </button>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={() => setLogoUrl('')}
                      className="p-2 text-gray-400 hover:text-red-500 transition rounded-lg hover:bg-red-50"
                      title="Remover logo"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-gray-400">PNG, SVG, JPG ou WebP · máximo 512 KB · fundo transparente recomendado</p>
              </div>
            </div>
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

      {/* ── Status: cadastro da org (adicionar/editar/reordenar/excluir) ── */}
      <StatusManager orgSlug={orgSlug} orgId={orgId} />

      {/* Save button */}
      <div className="flex justify-end pb-8">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-[#fff] text-sm font-semibold rounded-xl hover:bg-orange-700 transition disabled:opacity-50"
        >
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Salvar aparência
        </button>
      </div>
    </div>
  )
}
