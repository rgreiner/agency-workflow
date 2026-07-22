'use server'

import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

// To-do pessoal (sidebar da Caixa de entrada). RLS garante que só o dono mexe.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

export async function createTodo(orgSlug: string, texto: string, dueDate: string | null) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  if (!texto.trim()) return { error: 'Texto obrigatório' }

  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' }

  const { error } = await (supabase as SB).from('todos').insert({
    org_id: org.id, user_id: user.id, texto: texto.trim(), due_date: dueDate || null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/inbox`)
}

export async function toggleTodo(orgSlug: string, id: string, done: boolean) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const { error } = await (supabase as SB).from('todos').update({ done }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/inbox`)
}

export async function deleteTodo(orgSlug: string, id: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  const { error } = await (supabase as SB).from('todos').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/inbox`)
}
