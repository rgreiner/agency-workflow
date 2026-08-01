'use client'

import { useRef, useState, useTransition } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { AvatarCropper } from '@/components/ui/AvatarCropper'
import { uploadFile } from '@/lib/storage/upload-client'
import { updateMember, arquivarMembro, setMemberAvatar, carregarCargaMembro, type MembroCarga } from '@/app/actions/settings'
import { ResetPasswordButton } from './ResetPasswordButton'
import { Select } from '@/components/ui/Select'
import { Archive, ArchiveRestore, Check, Loader2, Camera } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Props {
  memberId: string
  orgSlug: string
  orgId: string
  profile: { id: string; full_name: string | null; email: string; avatar_url: string | null } | null
  position: { id: string; name: string; color: string } | null
  role: string
  canFinance: boolean
  canVendas: boolean
  canRh: boolean
  positions: { id: string; name: string; color: string }[]
  isAdmin: boolean
  isMe: boolean
  isOwner: boolean
  roleLabels: Record<string, string>
  /** Para quem as atividades desta pessoa podem ser transferidas ao arquivar. */
  outrosMembros: { userId: string; nome: string }[]
  /** Já saiu: sem acesso, fora do operacional, vínculo mantido pelo histórico. */
  arquivado?: boolean
  arquivadoEm?: string | null
}

const ROLES = ['owner', 'admin', 'manager', 'member', 'viewer']

export function MemberRow({
  memberId, orgSlug, orgId, profile, position, role, canFinance, canVendas, canRh,
  positions, isAdmin, isMe, isOwner, roleLabels, outrosMembros, arquivado = false, arquivadoEm,
}: Props) {
  const [selectedPosition, setSelectedPosition] = useState(position?.id ?? '')
  const [selectedRole, setSelectedRole] = useState(role)
  const [selectedFinance, setSelectedFinance] = useState(canFinance)
  const [selectedVendas, setSelectedVendas] = useState(canVendas)
  const [selectedRh, setSelectedRh] = useState(canRh)
  const [isDirty, setIsDirty] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [confirmRemove, setConfirmRemove] = useState(false)
  // Carga da pessoa (carregada ao abrir o aviso) + para quem transferir.
  const [carga, setCarga] = useState<MembroCarga | null>(null)
  const [destino, setDestino] = useState('')

  // Troca de avatar pelo admin (upload + cropper, mesmo fluxo do Meu Perfil).
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  async function handleAvatarCropped(result: File) {
    if (!profile) return
    setAvatarCropFile(null)
    setAvatarUploading(true)
    try {
      const url = await uploadFile('avatars', `${profile.id}/avatar.webp`, result)
      const r = await setMemberAvatar(orgSlug, orgId, profile.id, `${url}?t=${Date.now()}`)
      if (r?.error) toast.error(r.error)
      else toast.success('Avatar atualizado!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha no upload')
    } finally {
      setAvatarUploading(false)
    }
  }

  function recomputeDirty(pos: string, r: string, fin: boolean, ven: boolean, rh: boolean) {
    setIsDirty(pos !== (position?.id ?? '') || r !== role || fin !== canFinance || ven !== canVendas || rh !== canRh)
  }

  function handlePositionChange(val: string) {
    setSelectedPosition(val)
    recomputeDirty(val, selectedRole, selectedFinance, selectedVendas, selectedRh)
  }

  function handleRoleChange(val: string) {
    setSelectedRole(val)
    recomputeDirty(selectedPosition, val, selectedFinance, selectedVendas, selectedRh)
  }

  function handleFinanceChange(val: boolean) {
    setSelectedFinance(val)
    recomputeDirty(selectedPosition, selectedRole, val, selectedVendas, selectedRh)
  }

  function handleVendasChange(val: boolean) {
    setSelectedVendas(val)
    recomputeDirty(selectedPosition, selectedRole, selectedFinance, val, selectedRh)
  }

  function handleRhChange(val: boolean) {
    setSelectedRh(val)
    recomputeDirty(selectedPosition, selectedRole, selectedFinance, selectedVendas, val)
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateMember(
        orgSlug, orgId, memberId, selectedPosition || null,
        selectedRole as import('@/types').MemberRole, selectedFinance, selectedVendas, selectedRh,
      )
      if (result?.error) {
        toast.error(result.error)
      } else {
        setIsDirty(false)
        toast.success('Alterações salvas!')
      }
    })
  }

  /** Abre o aviso já com a carga da pessoa (o admin decide o destino sabendo o tamanho). */
  function pedirRemocao() {
    setConfirmRemove(true); setCarga(null); setDestino('')
    startTransition(async () => {
      const r = await carregarCargaMembro(orgId, memberId)
      if (r?.error) toast.error(r.error)
      else setCarga(r.carga ?? null)
    })
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await arquivarMembro(orgSlug, orgId, memberId, { transferirPara: destino || null })
      if (result?.error) { toast.error(result.error); return }
      // `soltas` = o que saiu da pessoa (é o número que o admin acompanha);
      // `transferidas` é menor quando o destino já era responsável junto.
      const r = result.resultado
      const nomeDestino = outrosMembros.find(o => o.userId === destino)?.nome
      toast.success(!r?.soltas ? 'Membro arquivado.'
        : destino ? `Membro arquivado — ${r.soltas} atividade(s) passaram para ${nomeDestino}.`
          : `Membro arquivado — ${r.soltas} atividade(s) ficaram sem responsável.`)
      setConfirmRemove(false)
    })
  }

  function desarquivar() {
    startTransition(async () => {
      const r = await arquivarMembro(orgSlug, orgId, memberId, { arquivar: false })
      if (r?.error) toast.error(r.error)
      else toast.success('Membro reativado — o acesso volta imediatamente.')
    })
  }

  const canEdit = isAdmin && !isOwner
  // Owner/admin têm Financeiro e Vendas implícitos (acesso total).
  const financeImplicit = isOwner || selectedRole === 'admin'
  const vendasImplicit = isOwner || selectedRole === 'admin'

  return (
    <tr className="hover:bg-gray-50/50 transition">
      {/* Pessoa */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {isAdmin && profile ? (
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              title={`Trocar a foto de ${profile.full_name ?? profile.email}`}
              className="relative group rounded-full shrink-0 disabled:opacity-60"
            >
              <Avatar name={profile.full_name ?? profile.email} avatarUrl={profile.avatar_url} size="md" />
              <span className="absolute inset-0 rounded-full bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                {avatarUploading
                  ? <Loader2 className="w-3.5 h-3.5 text-[#fff] animate-spin" />
                  : <Camera className="w-3.5 h-3.5 text-[#fff]" />}
              </span>
            </button>
          ) : (
            <Avatar name={profile?.full_name ?? profile?.email ?? '?'} avatarUrl={profile?.avatar_url} size="md" />
          )}
          {isAdmin && profile && (
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) setAvatarCropFile(f); e.target.value = '' }}
            />
          )}
          {avatarCropFile && (
            <AvatarCropper
              file={avatarCropFile}
              onCancel={() => setAvatarCropFile(null)}
              onConfirm={handleAvatarCropped}
            />
          )}
          <div>
            <p className="text-sm font-medium text-gray-900">
              {profile?.full_name ?? '—'}
              {isMe && <span className="ml-1.5 text-xs text-gray-400">(você)</span>}
            </p>
            <p className="text-xs text-gray-400">
              {profile?.email}
              {arquivado && arquivadoEm && <span className="ml-1.5">· saiu em {arquivadoEm.slice(0, 10).split('-').reverse().join('/')}</span>}
            </p>
          </div>
        </div>
      </td>

      {/* Cargo */}
      <td className="px-4 py-3">
        {canEdit ? (
          <select
            value={selectedPosition}
            onChange={(e) => handlePositionChange(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
          >
            <option value="">Sem cargo</option>
            {positions.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        ) : isOwner ? (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-orange-50 text-orange-600">
            Acesso total
          </span>
        ) : position ? (
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium text-[#fff]"
            style={{ backgroundColor: position.color }}
          >
            {position.name}
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>

      {/* Papel */}
      <td className="px-4 py-3">
        {canEdit ? (
          <select
            value={selectedRole}
            onChange={(e) => handleRoleChange(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
          >
            {ROLES.filter(r => r !== 'owner').map(r => (
              <option key={r} value={r}>{roleLabels[r]}</option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-gray-600">{roleLabels[role] ?? role}</span>
        )}
      </td>

      {/* Financeiro */}
      <td className="px-4 py-3">
        {financeImplicit ? (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400" title="Admins têm acesso ao Financeiro">
            <Check className="w-3.5 h-3.5" /> Sempre
          </span>
        ) : canEdit ? (
          <button
            type="button"
            role="switch"
            aria-checked={selectedFinance}
            onClick={() => handleFinanceChange(!selectedFinance)}
            className={cn(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
              selectedFinance ? 'bg-orange-600' : 'bg-gray-300'
            )}
            title="Ver/operar Financeiro e Faturamento"
          >
            <span className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-[#fff] transition-transform',
              selectedFinance ? 'translate-x-4' : 'translate-x-0.5'
            )} />
          </button>
        ) : canFinance ? (
          <span className="inline-flex items-center gap-1 text-xs text-orange-600">
            <Check className="w-3.5 h-3.5" /> Sim
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>

      {/* Vendas (Mídias / Produção / Cadastros) */}
      <td className="px-4 py-3">
        {vendasImplicit ? (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400" title="Admins têm acesso ao Operacional">
            <Check className="w-3.5 h-3.5" /> Sempre
          </span>
        ) : canEdit ? (
          <button
            type="button"
            role="switch"
            aria-checked={selectedVendas}
            onClick={() => handleVendasChange(!selectedVendas)}
            className={cn(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
              selectedVendas ? 'bg-orange-600' : 'bg-gray-300'
            )}
            title="Ver Mídias / Produção / Cadastros"
          >
            <span className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-[#fff] transition-transform',
              selectedVendas ? 'translate-x-4' : 'translate-x-0.5'
            )} />
          </button>
        ) : canVendas ? (
          <span className="inline-flex items-center gap-1 text-xs text-orange-600">
            <Check className="w-3.5 h-3.5" /> Sim
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>

      {/* RH (dado sensível — só quem tem o toggle explícito, além de owner/admin) */}
      <td className="px-4 py-3">
        {vendasImplicit ? (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400" title="Admins têm acesso ao RH">
            <Check className="w-3.5 h-3.5" /> Sempre
          </span>
        ) : canEdit ? (
          <button
            type="button"
            role="switch"
            aria-checked={selectedRh}
            onClick={() => handleRhChange(!selectedRh)}
            className={cn(
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
              selectedRh ? 'bg-orange-600' : 'bg-gray-300'
            )}
            title="Ver/operar RH (ficha, documentos, folha)"
          >
            <span className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-[#fff] transition-transform',
              selectedRh ? 'translate-x-4' : 'translate-x-0.5'
            )} />
          </button>
        ) : canRh ? (
          <span className="inline-flex items-center gap-1 text-xs text-orange-600">
            <Check className="w-3.5 h-3.5" /> Sim
          </span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>

      {/* Ações */}
      {isAdmin && (
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            {isDirty && canEdit && (
              <button
                onClick={handleSave}
                disabled={isPending}
                className="p-1.5 rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition disabled:opacity-50"
                title="Salvar"
              >
                {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </button>
            )}
            {canEdit && profile && (
              <ResetPasswordButton orgId={orgId} userId={profile.id} name={profile.full_name ?? profile.email} />
            )}
            {canEdit && (arquivado ? (
              <button
                onClick={desarquivar}
                disabled={isPending}
                className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition disabled:opacity-50"
                title="Reativar — devolve o acesso"
              >
                <ArchiveRestore className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={pedirRemocao}
                disabled={isPending}
                className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition disabled:opacity-50"
                title="Arquivar — tira o acesso e mantém o histórico"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
            ))}
            {canEdit && confirmRemove && (
              <div
                className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
                onClick={() => setConfirmRemove(false)}
              >
                <div
                  className="modal-card w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-200 p-5"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Archive className="w-5 h-5 text-amber-500 shrink-0" />
                    <h3 className="text-base font-semibold text-gray-900">Arquivar membro</h3>
                  </div>
                  <p className="text-sm text-gray-600">
                    Arquivar <strong className="text-gray-900">{profile?.full_name ?? profile?.email ?? 'este membro'}</strong>? A pessoa perde o acesso imediatamente e sai dos filtros e seletores — mas continua ligada ao histórico e às métricas do que entregou. Dá para reativar depois.
                  </p>

                  {/* Sem isto a atividade continuava atribuída a quem saiu: não
                      aparecia em "Sem responsável" nem nos filtros por pessoa. */}
                  {carga === null ? (
                    <p className="mt-3 text-xs text-gray-400 inline-flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" /> Verificando atividades…
                    </p>
                  ) : carga.ativas === 0 ? (
                    <p className="mt-3 text-xs text-gray-500">Sem atividades ativas atribuídas.</p>
                  ) : (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs text-amber-800">
                        Está com <strong>{carga.ativas}</strong> atividade(s) ativa(s)
                        {carga.atrasadas > 0 && <> · <strong>{carga.atrasadas}</strong> atrasada(s)</>}
                        {carga.so_dela > 0 && <> · <strong>{carga.so_dela}</strong> só com ela</>}.
                      </p>
                      <div className="mt-2">
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">Passar as atividades para</label>
                        <Select value={destino} onChange={setDestino} size="sm"
                          options={[{ value: '', label: 'Ninguém — deixar sem responsável' },
                            ...outrosMembros.map(o => ({ value: o.userId, label: o.nome }))]} />
                        <p className="text-[11px] text-gray-500 mt-1">
                          {destino
                            ? 'As ativas passam para essa pessoa; as concluídas e arquivadas ficam como estão.'
                            : 'Elas ficam sem responsável — aparecem no card “Sem responsável” e no filtro da Lista.'}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 mt-5">
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(false)}
                      className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 transition"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleRemove}
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-amber-600 text-[#fff] rounded-xl hover:bg-amber-700 disabled:opacity-50 transition"
                    >
                      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />} Arquivar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </td>
      )}
    </tr>
  )
}
