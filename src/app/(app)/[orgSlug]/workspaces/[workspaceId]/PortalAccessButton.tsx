'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Globe, X, Send, UserX, UserCheck } from 'lucide-react'
import { criarAcessoPortal, setAcessoPortalAtivo, enviarConvitePortal } from '@/app/actions/portal'

export interface PortalUserRow {
  id: string
  nome: string
  email: string
  ativo: boolean
  last_login_at: string | null
}

interface Props {
  orgSlug: string
  workspaceId: string
  contatos: PortalUserRow[]
}

/**
 * "Portal do cliente" na tela do cliente: gerencia quem (do cliente) acessa o
 * painel de acompanhamento — cadastrar contato, enviar o link de acesso,
 * ativar/desativar. Só owner/admin consegue efetivar (a action barra o resto).
 */
export function PortalAccessButton({ orgSlug, workspaceId, contatos }: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleAdd(fd: FormData) {
    startTransition(async () => {
      const res = await criarAcessoPortal(orgSlug, workspaceId, fd)
      if (res.error) { toast.error(res.error); return }
      toast.success('Acesso criado. Envie o convite pra pessoa entrar.')
      router.refresh()
    })
  }

  function handleAtivo(id: string, ativo: boolean) {
    startTransition(async () => {
      const res = await setAcessoPortalAtivo(orgSlug, workspaceId, id, ativo)
      if (res.error) { toast.error(res.error); return }
      toast.success(ativo ? 'Acesso reativado.' : 'Acesso desativado.')
      router.refresh()
    })
  }

  function handleConvite(id: string) {
    startTransition(async () => {
      const res = await enviarConvitePortal(workspaceId, id)
      if (res.error) { toast.error(res.error); return }
      toast.success('Convite enviado por e-mail.')
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
        title="Portal do cliente"
      >
        <Globe className="w-4 h-4" />
      </button>

      {open && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="modal-card w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-200 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h2 className="text-base font-semibold text-gray-900">Portal do cliente</h2>
              <button aria-label="Fechar" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto space-y-5">
              <p className="text-sm text-gray-500 leading-relaxed">
                Quem estiver aqui acessa o <span className="font-medium text-gray-700">painel de
                acompanhamento</span> deste cliente (entra por link enviado ao e-mail, sem senha).
                A pessoa vê só o resumo dos trabalhos <em>deste</em> cliente — nada interno.
              </p>

              {contatos.length > 0 && (
                <ul className="space-y-2">
                  {contatos.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium truncate ${c.ativo ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                          {c.nome}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {c.email}
                          {c.last_login_at
                            ? ` · último acesso ${new Date(c.last_login_at).toLocaleDateString('pt-BR')}`
                            : ' · nunca entrou'}
                        </p>
                      </div>
                      {c.ativo && (
                        <button
                          onClick={() => handleConvite(c.id)}
                          disabled={isPending}
                          title="Enviar link de acesso por e-mail"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition-colors disabled:opacity-50"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleAtivo(c.id, !c.ativo)}
                        disabled={isPending}
                        title={c.ativo ? 'Desativar acesso' : 'Reativar acesso'}
                        className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                          c.ativo
                            ? 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                            : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                        }`}
                      >
                        {c.ativo ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <form action={handleAdd} className="space-y-3 pt-1 border-t border-gray-100">
                <p className="text-sm font-medium text-gray-700 pt-3">Novo contato</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    name="nome" required placeholder="Nome"
                    className="w-full px-3.5 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <input
                    name="email" type="email" required placeholder="E-mail"
                    className="w-full px-3.5 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isPending}
                  className="w-full px-4 py-2.5 rounded-xl text-[#fff] text-sm font-medium bg-orange-600 hover:bg-orange-700 transition disabled:opacity-50"
                >
                  Criar acesso
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
