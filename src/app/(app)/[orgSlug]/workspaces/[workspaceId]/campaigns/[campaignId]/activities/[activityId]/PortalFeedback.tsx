import { BadgeCheck, PenLine, MessageSquareReply, Paperclip } from 'lucide-react'

export interface PortalFeedbackItem {
  id: string
  kind: 'aprovacao' | 'ajuste' | 'resposta'
  mensagem: string
  pecas: { nome: string; comentario: string }[]
  anexos: { chave: string; nome: string }[]
  createdAt: string
  clienteNome: string
}

const CFG = {
  aprovacao: { Icon: BadgeCheck, verbo: 'aprovou o trabalho', card: 'border-green-200 bg-green-50', chip: 'text-green-700', icon: 'text-green-600' },
  ajuste:    { Icon: PenLine, verbo: 'pediu ajustes', card: 'border-orange-200 bg-orange-50', chip: 'text-orange-700', icon: 'text-orange-600' },
  resposta:  { Icon: MessageSquareReply, verbo: 'respondeu a pendência', card: 'border-gray-200 bg-gray-50', chip: 'text-gray-700', icon: 'text-gray-500' },
} as const

/**
 * Sinalização do feedback que o cliente deu pelo PORTAL, na tela interna da
 * tarefa. Mostra a decisão mais recente em destaque (aprovou / pediu ajustes /
 * respondeu) com a mensagem, os comentários por peça e os anexos. Não muda o
 * status — quem move a pauta é o atendimento.
 */
export function PortalFeedback({ orgSlug, items }: { orgSlug: string; items: PortalFeedbackItem[] }) {
  if (!items.length) return null

  return (
    <div className="shrink-0 border-b border-gray-200 bg-white p-2 space-y-2">
      {items.map((f) => {
        const c = CFG[f.kind] ?? CFG.resposta
        const quando = new Date(f.createdAt).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })
        return (
          <div key={f.id} className={`rounded-xl border p-3 ${c.card}`}>
            <div className="flex items-center gap-2">
              <c.Icon className={`w-4 h-4 shrink-0 ${c.icon}`} />
              <span className="text-sm text-gray-800">
                <span className="font-semibold">{f.clienteNome}</span>{' '}
                <span className={c.chip}>{c.verbo}</span>
              </span>
              <span className="ml-auto text-[11px] text-gray-500 shrink-0">{quando}</span>
            </div>

            {f.mensagem && (
              <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap leading-relaxed">{f.mensagem}</p>
            )}

            {f.pecas.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {f.pecas.map((p, i) => (
                  <li key={i} className="text-sm bg-white/70 border border-gray-100 rounded-lg px-2.5 py-1.5">
                    <span className="font-medium text-gray-800">{p.nome}</span>
                    <span className="text-gray-600"> — {p.comentario}</span>
                  </li>
                ))}
              </ul>
            )}

            {f.anexos.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {f.anexos.map((a, i) => (
                  <a
                    key={i}
                    href={`/api/portal/anexo/${f.id}/${i}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    <Paperclip className="w-3 h-3" /> <span className="max-w-[160px] truncate">{a.nome}</span>
                  </a>
                ))}
              </div>
            )}

            <a
              href={`/${orgSlug}/solicitacoes`}
              className="inline-block mt-2 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
            >
              Ver em Solicitações →
            </a>
          </div>
        )
      })}
    </div>
  )
}
