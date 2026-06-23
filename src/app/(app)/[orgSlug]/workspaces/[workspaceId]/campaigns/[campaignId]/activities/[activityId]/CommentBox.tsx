'use client'

import { useState, useRef, useTransition } from 'react'
import { addComment } from '@/app/actions/activity'
import { Send, AtSign, Users, UserCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Mentionable { id: string; name: string }

interface Props {
  activityId: string
  path: string
  members?: Mentionable[]
  /** Ids dos responsáveis da tarefa — alvo do @atribuidos. */
  assignedIds?: string[]
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const ALL_OPTION: Mentionable = { id: '__all__', name: 'todos' }
const ASSIGNED_OPTION: Mentionable = { id: '__assigned__', name: 'atribuidos' }

/** Contexto de @menção na posição do cursor (ou null). */
function mentionContext(text: string, cursor: number): { start: number; query: string } | null {
  let i = cursor - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === '@') {
      if (i === 0 || /\s/.test(text[i - 1])) {
        const query = text.slice(i + 1, cursor)
        return /\s/.test(query) ? null : { start: i, query }
      }
      return null
    }
    if (/\s/.test(ch)) return null
    i--
  }
  return null
}

export function CommentBox({ activityId, path, members = [], assignedIds = [] }: Props) {
  const [content, setContent] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [mentionStart, setMentionStart] = useState(-1) // -1 = autocomplete fechado
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const tracked = useRef<Mentionable[]>([])
  const taRef = useRef<HTMLTextAreaElement>(null)

  const q = norm(query)
  const memberOpts = members.filter(m => norm(m.name).includes(q)).slice(0, 6)
  const showAll = q === '' || 'todos'.startsWith(q) || 'all'.startsWith(q)
  const showAssigned = assignedIds.length > 0 && (q === '' || 'atribuidos'.startsWith(q) || 'responsaveis'.startsWith(q) || 'assigned'.startsWith(q))
  const options = [...(showAll ? [ALL_OPTION] : []), ...(showAssigned ? [ASSIGNED_OPTION] : []), ...memberOpts]
  const open = mentionStart >= 0 && options.length > 0
  const activeIdx = Math.min(active, options.length - 1)

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value
    setContent(text)
    const ctx = mentionContext(text, e.target.selectionStart ?? text.length)
    if (ctx) { setMentionStart(ctx.start); setQuery(ctx.query); setActive(0) }
    else { setMentionStart(-1); setQuery('') }
  }

  function selectOption(opt: Mentionable) {
    const ta = taRef.current
    if (!ta) return
    const cursor = ta.selectionStart ?? content.length
    const token = opt.id === ALL_OPTION.id ? '@todos ' : opt.id === ASSIGNED_OPTION.id ? '@atribuidos ' : `@${opt.name} `
    const before = content.slice(0, mentionStart)
    const after = content.slice(cursor)
    setContent(before + token + after)
    if (opt.id !== ALL_OPTION.id && opt.id !== ASSIGNED_OPTION.id && !tracked.current.some(t => t.id === opt.id)) {
      tracked.current.push(opt)
    }
    setMentionStart(-1); setQuery('')
    const pos = (before + token).length
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(pos, pos) })
  }

  function submit() {
    const text = content.trim()
    if (!text) return
    const mentionAll = /(^|\s)@(todos|all)\b/i.test(text)
    const mentionAssigned = /(^|\s)@atribuidos\b/i.test(text)
    const ids = Array.from(new Set([
      ...tracked.current.filter(m => text.includes('@' + m.name)).map(m => m.id),
      ...(mentionAssigned ? assignedIds : []),
    ]))
    startTransition(async () => {
      const result = await addComment(path, activityId, text, ids, mentionAll)
      if (result?.error) { setError(result.error); toast.error(result.error) }
      else { setContent(''); tracked.current = []; setMentionStart(-1); setError('') }
    })
  }

  function handleSubmit(e: React.FormEvent) { e.preventDefault(); submit() }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, options.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectOption(options[activeIdx]); return }
      if (e.key === 'Escape')    { e.preventDefault(); setMentionStart(-1); return }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit() }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="relative flex gap-2 items-end">
        {open && (
          <div className="pop-in absolute bottom-full mb-2 left-0 w-64 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5 z-50 max-h-60 overflow-y-auto">
            {options.map((opt, i) => (
              <button
                key={opt.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); selectOption(opt) }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                  i === activeIdx ? 'bg-indigo-50 text-indigo-900' : 'text-gray-700 hover:bg-gray-50'
                )}
              >
                {opt.id === ALL_OPTION.id ? (
                  <>
                    <Users className="w-3.5 h-3.5 text-pink-500 shrink-0" />
                    <span className="font-medium">@todos</span>
                    <span className="text-xs text-gray-400 ml-auto">notificar todos</span>
                  </>
                ) : opt.id === ASSIGNED_OPTION.id ? (
                  <>
                    <UserCheck className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span className="font-medium">@atribuidos</span>
                    <span className="text-xs text-gray-400 ml-auto">notificar responsáveis</span>
                  </>
                ) : (
                  <>
                    <AtSign className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span className="truncate">{opt.name}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={taRef}
          value={content}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          rows={2}
          aria-label="Comentário"
          placeholder="Adicione um comentário…  (@ menciona alguém · ⌘/Ctrl+Enter envia)"
          className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y min-h-[44px]"
        />
        <button
          type="submit"
          disabled={!content.trim() || isPending}
          aria-label="Enviar comentário"
          className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed self-stretch"
        >
          <Send aria-hidden className="w-4 h-4" />
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </form>
  )
}
