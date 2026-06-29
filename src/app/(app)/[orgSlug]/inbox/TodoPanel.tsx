'use client'

/**
 * To-do pessoal da Caixa de entrada — anotações livres (texto + prazo + check),
 * só a própria pessoa vê. Fica na sidebar direita, abaixo de "Minhas tarefas".
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, CheckSquare, Square, Loader2, NotebookPen, CalendarDays } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { createTodo, toggleTodo, deleteTodo } from '@/app/actions/todos'

export interface Todo { id: string; texto: string; done: boolean; due_date: string | null }

const todayStr = () => new Date().toISOString().slice(0, 10)

export function TodoPanel({ orgSlug, todos }: { orgSlug: string; todos: Todo[] }) {
  const router = useRouter()
  const [texto, setTexto] = useState('')
  const [due, setDue] = useState('')
  const [pending, start] = useTransition()

  const pendentes = todos.filter(t => !t.done).length

  function add() {
    const t = texto.trim()
    if (!t) return
    start(async () => {
      await createTodo(orgSlug, t, due || null)
      setTexto(''); setDue('')
      router.refresh()
    })
  }
  function toggle(t: Todo) { start(async () => { await toggleTodo(orgSlug, t.id, !t.done); router.refresh() }) }
  function remove(id: string) { start(async () => { await deleteTodo(orgSlug, id); router.refresh() }) }

  return (
    <div className="p-4 border-t border-gray-200">
      <div className="flex items-center gap-2 mb-3 px-1">
        <NotebookPen className="w-4 h-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-800">Minhas anotações</h2>
        <span className="text-xs text-gray-400 ml-auto">{pendentes}</span>
      </div>

      {/* Adicionar — tudo numa linha: texto · prazo (ícone) · enviar */}
      <div className="mb-3 flex items-center gap-1.5">
        <input
          value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="Nova anotação…"
          className="flex-1 min-w-0 px-2.5 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
        />
        <label
          title={due ? `Prazo: ${formatDate(due)}` : 'Definir prazo (opcional)'}
          className={cn('relative shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border cursor-pointer transition',
            due ? 'border-orange-300 text-orange-600 bg-orange-50' : 'border-gray-200 text-gray-400 hover:text-gray-600')}
        >
          <CalendarDays className="w-4 h-4" />
          <input
            type="date"
            value={due}
            onChange={e => setDue(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        <button
          onClick={add}
          disabled={pending || !texto.trim()}
          title="Adicionar"
          className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition disabled:opacity-50"
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        </button>
      </div>

      {/* Lista */}
      {todos.length === 0 ? (
        <p className="text-sm text-gray-400 px-1 py-6 text-center">Sem anotações. Use pra organizar suas demandas.</p>
      ) : (
        <div className="space-y-0.5">
          {todos.map(t => {
            const overdue = !t.done && !!t.due_date && t.due_date < todayStr()
            return (
              <div key={t.id} className="flex items-start gap-2 px-1 py-1.5 rounded-lg hover:bg-white transition-colors group">
                <button onClick={() => toggle(t)} className="mt-0.5 shrink-0 text-gray-400 hover:text-orange-600 transition" title={t.done ? 'Reabrir' : 'Concluir'}>
                  {t.done ? <CheckSquare className="w-4 h-4 text-orange-600" /> : <Square className="w-4 h-4" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm break-words', t.done ? 'line-through text-gray-400' : 'text-gray-700')}>{t.texto}</p>
                  {t.due_date && (
                    <span className={cn('text-[11px]', overdue ? 'text-red-500 font-medium' : 'text-gray-400')}>{formatDate(t.due_date)}</span>
                  )}
                </div>
                <button onClick={() => remove(t.id)} className="shrink-0 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition" title="Excluir">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
