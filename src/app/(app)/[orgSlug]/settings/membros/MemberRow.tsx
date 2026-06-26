'use client'

import { useState, useTransition } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { updateMember, removeMember } from '@/app/actions/settings'
import { ResetPasswordButton } from './ResetPasswordButton'
import { Trash2, Check, Loader2, AlertTriangle, X } from 'lucide-react'
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
  positions: { id: string; name: string; color: string }[]
  isAdmin: boolean
  isMe: boolean
  isOwner: boolean
  roleLabels: Record<string, string>
}

const ROLES = ['owner', 'admin', 'manager', 'member', 'viewer']

export function MemberRow({
  memberId, orgSlug, orgId, profile, position, role, canFinance, canVendas,
  positions, isAdmin, isMe, isOwner, roleLabels,
}: Props) {
  const [selectedPosition, setSelectedPosition] = useState(position?.id ?? '')
  const [selectedRole, setSelectedRole] = useState(role)
  const [selectedFinance, setSelectedFinance] = useState(canFinance)
  const [selectedVendas, setSelectedVendas] = useState(canVendas)
  const [isDirty, setIsDirty] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [confirmRemove, setConfirmRemove] = useState(false)

  function recomputeDirty(pos: string, r: string, fin: boolean, ven: boolean) {
    setIsDirty(pos !== (position?.id ?? '') || r !== role || fin !== canFinance || ven !== canVendas)
  }

  function handlePositionChange(val: string) {
    setSelectedPosition(val)
    recomputeDirty(val, selectedRole, selectedFinance, selectedVendas)
  }

  function handleRoleChange(val: string) {
    setSelectedRole(val)
    recomputeDirty(selectedPosition, val, selectedFinance, selectedVendas)
  }

  function handleFinanceChange(val: boolean) {
    setSelectedFinance(val)
    recomputeDirty(selectedPosition, selectedRole, val, selectedVendas)
  }

  function handleVendasChange(val: boolean) {
    setSelectedVendas(val)
    recomputeDirty(selectedPosition, selectedRole, selectedFinance, val)
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateMember(
        orgSlug, orgId, memberId, selectedPosition || null,
        selectedRole as import('@/types').MemberRole, selectedFinance, selectedVendas,
      )
      if (result?.error) {
        toast.error(result.error)
      } else {
        setIsDirty(false)
        toast.success('Alterações salvas!')
      }
    })
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await removeMember(orgSlug, orgId, memberId)
      if (result?.error) toast.error(result.error)
      else toast.success('Membro removido.')
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
          <Avatar name={profile?.full_name ?? profile?.email ?? '?'} avatarUrl={profile?.avatar_url} size="md" />
          <div>
            <p className="text-sm font-medium text-gray-900">
              {profile?.full_name ?? '—'}
              {isMe && <span className="ml-1.5 text-xs text-gray-400">(você)</span>}
            </p>
            <p className="text-xs text-gray-400">{profile?.email}</p>
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
            {canEdit && !confirmRemove && profile && (
              <ResetPasswordButton orgId={orgId} userId={profile.id} name={profile.full_name ?? profile.email} />
            )}
            {canEdit && !confirmRemove && (
              <button
                onClick={() => setConfirmRemove(true)}
                disabled={isPending}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-50"
                title="Remover membro"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            {canEdit && confirmRemove && (
              <div className="flex items-center gap-1 bg-red-50 border border-red-100 rounded-lg px-2 py-1">
                <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />
                <span className="text-xs text-red-700 font-medium whitespace-nowrap">Remover?</span>
                <button
                  onClick={handleRemove}
                  disabled={isPending}
                  className="ml-1 text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Sim'}
                </button>
                <button aria-label="Fechar"
                  onClick={() => setConfirmRemove(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </td>
      )}
    </tr>
  )
}
