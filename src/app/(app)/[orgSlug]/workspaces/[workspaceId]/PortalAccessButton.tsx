'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Globe, X, Send, UserX, UserCheck, Eye, Link2, RefreshCw } from 'lucide-react'
import {
  criarAcessoPortal, setAcessoPortalAtivo, enviarConvitePortal,
  gerarLinkCadastro, revogarLinkCadastro, verComoCliente,
} from '@/app/actions/portal'
import { CopyButton } from '@/components/ui/CopyButton'
import { WhatsAppIcon } from '@/components/ui/WhatsAppIcon'

export interface PortalUserRow {
  id: string
  nome: string
  email: string
  ativo: boolean
  last_login_at: string | null
}

export interface LinkCadastro { url: string; expiraEm: string; usos: number }

interface Props {
  orgSlug: string
  workspaceId: string
  clienteNome: string
  contatos: PortalUserRow[]
  /** Link de cadastro ativo (mig. 342) — null quando não há ou quem vê não gere o portal. */
  linkCadastro: LinkCadastro | null
}

/**
 * "Portal do cliente" na tela do cliente: link de cadastro (o cliente cria o
 * próprio acesso), ver o painel como o cliente vê, e a lista de quem acessa —
 * reenviar link, ativar/desativar, cadastrar à mão.
 */
export function PortalAccessButton({ orgSlug, workspaceId, clienteNome, contatos, linkCadastro }: Props) {
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

  function handleGerarLink() {
    startTransition(async () => {
      const res = await gerarLinkCadastro(orgSlug, workspaceId)
      if (res.error || !res.url) { toast.error(res.error ?? 'Não foi possível gerar o link.'); return }
      navigator.clipboard?.writeText(res.url).catch(() => {})
      toast.success('Link gerado e copiado. Mande para o cliente.')
      router.refresh()
    })
  }

  function handleRevogar() {
    startTransition(async () => {
      const res = await revogarLinkCadastro(orgSlug, workspaceId)
      if (res.error) { toast.error(res.error); return }
      toast.success('Link desativado. Quem já tem acesso continua entrando.')
      router.refresh()
    })
  }

  function handleVerComoCliente() {
    startTransition(async () => {
      const res = await verComoCliente(orgSlug, workspaceId)
      if (res?.error) toast.error(res.error)
    })
  }

  const textoWhats = linkCadastro
    ? `Olá! Criamos um painel para você acompanhar os trabalhos da ${clienteNome} com a gente: aprovações, orçamentos, datas de entrega e atas das reuniões. Crie seu acesso por aqui: ${linkCadastro.url}`
    : ''

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
                O cliente acompanha o que está em andamento, aprova trabalhos e orçamentos e vê
                as datas de entrega e as atas. Ele vê só <em>este</em> cliente, nada interno.
              </p>

              <button
                type="button"
                onClick={handleVerComoCliente}
                disabled={isPending}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors active:scale-[0.97] disabled:opacity-50"
              >
                <Eye className="w-4 h-4" /> Ver como o cliente vê
              </button>

              {/* Link de cadastro: o cliente cria o próprio acesso */}
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3.5 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-orange-600" />
                  <p className="text-sm font-medium text-gray-900">Link de cadastro</p>
                </div>
                {linkCadastro ? (
                  <>
                    <div className="flex items-center gap-1.5 rounded-lg bg-white border border-gray-200 px-2.5 py-1.5">
                      <span className="flex-1 min-w-0 truncate text-xs text-gray-600 font-mono">{linkCadastro.url}</span>
                      <CopyButton text={linkCadastro.url} label="Copiar link" />
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(textoWhats)}`}
                        target="_blank" rel="noopener"
                        title="Enviar pelo WhatsApp"
                        className="p-1 rounded text-gray-400 hover:text-green-600 hover:bg-gray-100 transition-colors shrink-0"
                      >
                        <WhatsAppIcon className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    <p className="text-xs text-gray-500">
                      Vale até {new Date(linkCadastro.expiraEm).toLocaleDateString('pt-BR')}
                      {' · '}{linkCadastro.usos === 0 ? 'ninguém usou ainda' : `${linkCadastro.usos} cadastro${linkCadastro.usos > 1 ? 's' : ''}`}.
                      Quem abrir preenche nome, e-mail e senha e entra direto.
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleGerarLink} disabled={isPending}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg px-2 py-1 transition-colors disabled:opacity-50">
                        <RefreshCw className="w-3.5 h-3.5" /> Gerar novo
                      </button>
                      <button type="button" onClick={handleRevogar} disabled={isPending}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg px-2 py-1 transition-colors disabled:opacity-50">
                        <X className="w-3.5 h-3.5" /> Desativar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      Gere um link e mande ao cliente. Quem abrir preenche nome, e-mail e senha e já
                      entra no painel. Vale 30 dias e serve para mais de uma pessoa do cliente.
                    </p>
                    <button type="button" onClick={handleGerarLink} disabled={isPending}
                      className="w-full px-4 py-2.5 rounded-xl text-[#fff] text-sm font-medium bg-orange-600 hover:bg-orange-700 transition-colors active:scale-[0.97] disabled:opacity-50">
                      Gerar link de cadastro
                    </button>
                  </>
                )}
              </div>

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
                          className="p-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-500/10 transition-colors disabled:opacity-50"
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
                <p className="text-sm font-medium text-gray-700 pt-3">Cadastrar à mão</p>
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
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-50"
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
