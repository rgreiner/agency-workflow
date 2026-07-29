import type { MemberRole } from '@/types'

// Hierarquia de cargo (maior = mais poder). Espelha role_rank() no banco.
export const ROLE_RANK: Record<MemberRole, number> = {
  owner: 4, admin: 3, manager: 2, member: 1, viewer: 0,
}

export function roleRank(r: MemberRole | null | undefined): number {
  return r ? ROLE_RANK[r] : -1
}

/**
 * Níveis de acesso de um quadro (coluna `min_role`), do mais aberto ao mais
 * restrito. Vê e edita quem tem cargo naquele nível ou acima.
 */
export const BOARD_LEVELS: { value: MemberRole; label: string }[] = [
  { value: 'viewer',  label: 'Todos (inclui Visualizadores)' },
  { value: 'member',  label: 'Equipe (Funcionário ou acima)' },
  { value: 'manager', label: 'Gerência (Gerente, Admin, Dono)' },
  { value: 'admin',   label: 'Administração (Admin e Dono)' },
  { value: 'owner',   label: 'Somente Dono' },
]

// Rótulo curto para chips/badges na lista.
export const BOARD_LEVEL_SHORT: Record<MemberRole, string> = {
  viewer: 'Todos', member: 'Equipe', manager: 'Gerência', admin: 'Administração', owner: 'Dono',
}
