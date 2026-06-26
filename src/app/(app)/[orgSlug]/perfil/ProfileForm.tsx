'use client'

import { useState, useRef, useTransition } from 'react'
import { uploadFile } from '@/lib/storage/upload-client'
import { updateProfile } from '@/app/actions/profile'
import { alterarMinhaSenha } from '@/app/actions/auth'
import { useOrgSettings } from '@/components/providers/OrgSettingsProvider'
import { AvatarCropper } from '@/components/ui/AvatarCropper'
import { toast } from 'sonner'
import { Upload, Loader2, Check, RefreshCw } from 'lucide-react'

export interface ProfileUser {
  id: string
  email: string
  fullName: string | null
  avatarUrl: string | null
  googleName: string | null
  googleAvatar: string | null
  driveMacUser: string | null
  driveGoogleEmail: string | null
}

export function ProfileForm({ user }: { user: ProfileUser }) {
  const settings     = useOrgSettings()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [fullName,  setFullName]  = useState(user.fullName ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? '')
  const [driveMacUser,     setDriveMacUser]     = useState(user.driveMacUser ?? '')
  const [driveGoogleEmail, setDriveGoogleEmail] = useState(user.driveGoogleEmail ?? '')
  const [uploading, setUploading] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [isPending, startTransition] = useTransition()

  // Troca de senha (logado)
  const [pwAtual, setPwAtual] = useState('')
  const [pwNova, setPwNova] = useState('')
  const [pwConfirma, setPwConfirma] = useState('')
  const [pwPending, startPw] = useTransition()

  function handleChangePassword() {
    if (pwNova.length < 8) { toast.error('A nova senha precisa ter ao menos 8 caracteres.'); return }
    if (pwNova !== pwConfirma) { toast.error('As senhas não conferem.'); return }
    startPw(async () => {
      const r = await alterarMinhaSenha(pwAtual, pwNova)
      if (r?.error) toast.error(r.error)
      else { toast.success('Senha alterada!'); setPwAtual(''); setPwNova(''); setPwConfirma('') }
    })
  }

  const isFromGoogle = !!user.googleAvatar
  const accent = settings.accentColor

  // Selecionar a imagem abre o cropper (não envia direto).
  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setCropFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Resultado do cropper (WebP 512px já comprimido) → upload.
  async function handleCropped(result: File) {
    setCropFile(null)
    setUploading(true)
    try {
      const url = await uploadFile('avatars', `${user.id}/avatar.webp`, result)
      setAvatarUrl(`${url}?t=${Date.now()}`)
      toast.success('Foto atualizada!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha no upload')
    } finally {
      setUploading(false)
    }
  }

  function handleSave() {
    if (!fullName.trim()) { toast.error('Nome obrigatório'); return }
    startTransition(async () => {
      const result = await updateProfile(fullName, avatarUrl, driveMacUser, driveGoogleEmail)
      if (result?.error) toast.error(result.error)
      else toast.success('Perfil atualizado!')
    })
  }

  return (
    <div className="p-6 max-w-lg">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">Meu perfil</h1>
        <p className="text-gray-500 text-sm mt-0.5">{user.email}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">

        {/* Avatar */}
        <div className="px-6 py-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Foto</p>
          <div className="flex items-center gap-5">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-100 border-2 border-gray-200 shrink-0">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={fullName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-gray-400">
                  {(fullName || user.email).charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={pickFile}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 border border-transparent rounded-xl hover:bg-gray-50 transition font-medium text-gray-700 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? 'Enviando…' : 'Enviar foto'}
              </button>
              {isFromGoogle && (
                <button
                  type="button"
                  onClick={() => setAvatarUrl(user.googleAvatar ?? '')}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Restaurar foto do Google
                </button>
              )}
              <p className="text-[11px] text-gray-400">PNG, JPG ou WebP · máximo 1 MB</p>
            </div>
          </div>
        </div>

        {/* Name + Email */}
        <div className="px-6 py-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Dados pessoais</p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome completo</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Seu nome"
                  className="flex-1 px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent"
                  style={{ '--tw-ring-color': accent } as React.CSSProperties}
                />
                {isFromGoogle && fullName !== user.googleName && (
                  <button
                    type="button"
                    onClick={() => setFullName(user.googleName ?? '')}
                    title="Restaurar nome do Google"
                    className="px-3 py-2 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">E-mail</label>
              <input
                type="email"
                value={user.email}
                disabled
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-400 bg-gray-50 cursor-not-allowed"
              />
              <p className="text-[11px] text-gray-400 mt-1">Gerenciado pela sua conta Google.</p>
            </div>
          </div>
        </div>

        {/* Senha */}
        <div className="px-6 py-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Senha</p>
          <div className="space-y-3">
            <input
              type="password"
              value={pwAtual}
              onChange={e => setPwAtual(e.target.value)}
              placeholder="Senha atual"
              autoComplete="current-password"
              className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': accent } as React.CSSProperties}
            />
            <input
              type="password"
              value={pwNova}
              onChange={e => setPwNova(e.target.value)}
              placeholder="Nova senha (mín. 8)"
              autoComplete="new-password"
              className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': accent } as React.CSSProperties}
            />
            <input
              type="password"
              value={pwConfirma}
              onChange={e => setPwConfirma(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleChangePassword() }}
              placeholder="Confirmar nova senha"
              autoComplete="new-password"
              className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': accent } as React.CSSProperties}
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleChangePassword}
                disabled={pwPending || !pwAtual || pwNova.length < 8 || pwNova !== pwConfirma}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-100 border border-transparent rounded-xl hover:bg-gray-50 transition text-gray-700 disabled:opacity-50"
              >
                {pwPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Alterar senha
              </button>
            </div>
          </div>
        </div>

        {/* Caminho na máquina (Mac) */}
        <div className="px-6 py-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Caminho na máquina (Mac)</p>
          <p className="text-[12px] text-gray-400 mb-4 leading-relaxed">
            Só para quem usa Mac. Com esses dados o Flow monta o caminho local das pastas do Drive no seu Mac
            (no Windows não precisa). Em branco, mostramos o caminho do Windows.
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">E-mail da conta Google (Drive)</label>
              <input
                type="email"
                value={driveGoogleEmail}
                onChange={e => setDriveGoogleEmail(e.target.value)}
                placeholder="voce@empresa.com.br"
                className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': accent } as React.CSSProperties}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Usuário do Mac</label>
              <input
                type="text"
                value={driveMacUser}
                onChange={e => setDriveMacUser(e.target.value)}
                placeholder="ex.: rafaelgreiner"
                className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ '--tw-ring-color': accent } as React.CSSProperties}
              />
              <p className="text-[11px] text-gray-400 mt-1">O nome da sua pasta em /Users (no Finder, sua pasta pessoal).</p>
            </div>
          </div>
        </div>

        {/* Google badge */}
        {isFromGoogle && (
          <div className="px-6 py-4 bg-gray-50/60 rounded-b-xl">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span className="text-xs text-gray-500">
                Conta conectada via Google · dados importados no primeiro acesso
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end">
        <button
          onClick={handleSave}
          disabled={isPending || !fullName.trim()}
          className="flex items-center gap-2 px-5 py-2.5 text-[#fff] text-sm font-semibold rounded-xl transition disabled:opacity-50"
          style={{ backgroundColor: accent }}
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Salvar alterações
        </button>
      </div>

      {cropFile && (
        <AvatarCropper
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={handleCropped}
        />
      )}
    </div>
  )
}
