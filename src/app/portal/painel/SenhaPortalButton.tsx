'use client'

import { useState, useTransition } from 'react'
import { KeyRound, X, Loader2, CheckCircle2 } from 'lucide-react'
import { criarSenhaPortal } from '@/app/actions/portal'

/** Cliente cria/troca a própria senha de acesso ao portal. */
export function SenhaPortalButton({ temSenha }: { temSenha: boolean }) {
  const [open, setOpen] = useState(false)
  const [senha, setSenha] = useState('')
  const [conf, setConf] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [isPending, startTransition] = useTransition()

  function salvar() {
    setErro(null)
    if (senha.length < 6) { setErro('A senha precisa de pelo menos 6 caracteres.'); return }
    if (senha !== conf) { setErro('As senhas não conferem.'); return }
    startTransition(async () => {
      const res = await criarSenhaPortal(senha)
      if (res.error) { setErro(res.error); return }
      setOk(true)
      setSenha(''); setConf('')
    })
  }

  function fechar() {
    setOpen(false)
    setTimeout(() => { setOk(false); setErro(null); setSenha(''); setConf('') }, 200)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={temSenha ? 'Alterar senha' : 'Criar senha de acesso'}
        className="p-2 rounded-xl text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
      >
        <KeyRound className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={fechar}>
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">
                {temSenha ? 'Alterar senha' : 'Criar senha de acesso'}
              </h2>
              <button aria-label="Fechar" onClick={fechar} className="text-gray-400 hover:text-gray-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {ok ? (
              <div className="text-center py-4">
                <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2" />
                <p className="text-sm text-gray-700">
                  Senha {temSenha ? 'alterada' : 'criada'}! Da próxima vez, entre direto com
                  e-mail e senha.
                </p>
                <button onClick={fechar} className="mt-5 px-4 py-2 rounded-xl text-[#fff] text-sm font-medium bg-orange-600 hover:bg-orange-700 transition">
                  Fechar
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-500 leading-relaxed">
                  Com uma senha, você entra a qualquer momento sem precisar do link por e-mail.
                </p>
                <input
                  type="password" autoComplete="new-password" placeholder="Nova senha (mín. 6)"
                  value={senha} onChange={(e) => setSenha(e.target.value)}
                  className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <input
                  type="password" autoComplete="new-password" placeholder="Confirmar senha"
                  value={conf} onChange={(e) => setConf(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && salvar()}
                  className="w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                {erro && <p className="text-sm text-red-600">{erro}</p>}
                <button
                  onClick={salvar} disabled={isPending}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[#fff] text-sm font-medium bg-orange-600 hover:bg-orange-700 transition disabled:opacity-50"
                >
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {temSenha ? 'Salvar nova senha' : 'Criar senha'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
