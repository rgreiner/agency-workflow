'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  MessageSquareReply, Inbox, Paperclip, Check, Archive, ArchiveRestore,
  ExternalLink, Clock,
} from 'lucide-react'
import { setEntradaStatus, type EntradaCliente } from '@/app/actions/portal'

const FILTROS = [
  { key: 'novo', label: 'Novas' },
  { key: 'lido', label: 'Lidas' },
  { key: 'arquivado', label: 'Arquivadas' },
  { key: 'todos', label: 'Todas' },
] as const

export function SolicitacoesClient({
  orgSlug, filtro, initial,
}: {
  orgSlug: string
  filtro: 'novo' | 'lido' | 'arquivado' | 'todos'
  initial: EntradaCliente[]
}) {
  const router = useRouter()
  const [items, setItems] = useState(initial)
  const [isPending, startTransition] = useTransition()

  function atualizar(id: string, status: 'novo' | 'lido' | 'arquivado') {
    startTransition(async () => {
      const res = await setEntradaStatus(orgSlug, id, status)
      if (res.error) { toast.error(res.error); return }
      // Some da lista se o filtro atual não bate mais com o novo status.
      setItems((arr) => arr.filter((e) => filtro === 'todos' || e.id !== id).map(
        (e) => (e.id === id ? { ...e, status } : e)),
      )
      toast.success(status === 'arquivado' ? 'Arquivada.' : status === 'lido' ? 'Marcada como lida.' : 'Reaberta.')
      router.refresh()
    })
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Solicitações de clientes</h1>
        <p className="text-sm text-gray-500 mt-1">
          Respostas de pendências e novas demandas que os clientes enviaram pelo portal.
        </p>
      </header>

      <div className="flex items-center gap-1.5 mb-5">
        {FILTROS.map((f) => (
          <Link
            key={f.key}
            href={`/${orgSlug}/solicitacoes?status=${f.key}`}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filtro === f.key
                ? 'bg-gray-900 text-[#fff]'
                : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Inbox className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Nenhuma {filtro === 'novo' ? 'nova ' : ''}entrada por aqui.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((e) => (
            <EntradaCard
              key={e.id}
              orgSlug={orgSlug}
              e={e}
              busy={isPending}
              onStatus={atualizar}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function EntradaCard({
  orgSlug, e, busy, onStatus,
}: {
  orgSlug: string
  e: EntradaCliente
  busy: boolean
  onStatus: (id: string, status: 'novo' | 'lido' | 'arquivado') => void
}) {
  const isResposta = e.kind === 'resposta'
  const quando = new Date(e.createdAt).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })

  const taskUrl = e.activityId && e.campaignId
    ? `/${orgSlug}/workspaces/${e.workspaceId}/campaigns/${e.campaignId}/activities/${e.activityId}`
    : null

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-4 sm:p-5 ${
      e.status === 'novo' ? 'border-orange-200' : 'border-gray-200'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${
          isResposta ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'
        }`}>
          {isResposta ? <MessageSquareReply className="w-4 h-4" /> : <Inbox className="w-4 h-4" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{e.clienteNome}</span>
            <span className="text-xs text-gray-400">·</span>
            <span className="text-xs text-gray-500">{e.workspaceNome}</span>
            {e.status === 'novo' && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-700 bg-orange-100 rounded-full px-2 py-0.5">
                Nova
              </span>
            )}
            <span className="ml-auto flex items-center gap-1 text-xs text-gray-400">
              <Clock className="w-3 h-3" /> {quando}
            </span>
          </div>

          <p className="text-sm font-medium text-gray-800 mt-1.5">
            {isResposta
              ? <>Respondeu: <span className="text-gray-600 font-normal">{e.atividadeTitulo ?? 'pendência'}</span></>
              : (e.titulo ?? 'Nova solicitação')}
          </p>

          <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap leading-relaxed">{e.mensagem}</p>

          {e.anexos.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {e.anexos.map((a, i) => (
                <a
                  key={i}
                  href={`/api/portal/anexo/${e.id}/${i}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg px-2.5 py-1.5 transition-colors"
                >
                  <Paperclip className="w-3 h-3" /> <span className="max-w-[180px] truncate">{a.nome}</span>
                </a>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 mt-4">
            {taskUrl && (
              <Link
                href={taskUrl}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Ver tarefa
              </Link>
            )}
            {!isResposta && (
              <Link
                href={`/${orgSlug}/workspaces/${e.workspaceId}`}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Abrir cliente
              </Link>
            )}

            <div className="ml-auto flex items-center gap-1">
              {e.status !== 'lido' && e.status !== 'arquivado' && (
                <button
                  onClick={() => onStatus(e.id, 'lido')}
                  disabled={busy}
                  title="Marcar como lida"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition-colors disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                </button>
              )}
              {e.status !== 'arquivado' ? (
                <button
                  onClick={() => onStatus(e.id, 'arquivado')}
                  disabled={busy}
                  title="Arquivar"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  <Archive className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => onStatus(e.id, 'novo')}
                  disabled={busy}
                  title="Reabrir"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  <ArchiveRestore className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
