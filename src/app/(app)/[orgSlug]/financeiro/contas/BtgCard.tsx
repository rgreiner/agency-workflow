'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Landmark, Loader2, RefreshCw, Plug, Unplug, CheckCircle2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatDateBR } from '@/lib/midia'
import { testBtg, disconnectBtg } from '@/app/actions/btg'

export interface BtgStatus {
  configured: boolean
  env: 'sandbox' | 'production'
  connected: boolean
  status: string | null
  companyId: string | null
  accountId: string | null
  lastSyncAt: string | null
  lastError: string | null
}

const FEEDBACK: Record<string, { ok: boolean; msg: string }> = {
  ok: { ok: true, msg: 'BTG conectado.' },
  erro: { ok: false, msg: 'Não foi possível conectar ao BTG. Tente de novo.' },
  semacesso: { ok: false, msg: 'Sem permissão de Financeiro para conectar.' },
  naoconfig: { ok: false, msg: 'Credenciais do BTG não configuradas no servidor.' },
  semrefresh: { ok: false, msg: 'O BTG não retornou refresh token (verifique os escopos, ex.: offline_access).' },
}

export function BtgCard({ orgSlug, btg, voltarPara }: {
  orgSlug: string; btg: BtgStatus
  /** Rota pra limpar o ?btg=... depois do OAuth. O card vive dentro da conta
   *  vinculada (migration 128), então nem sempre é a listagem. */
  voltarPara?: string
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, start] = useTransition()
  const [confirm, setConfirm] = useState(false)
  const destino = voltarPara ?? `/${orgSlug}/financeiro/contas`

  // Toast do retorno do OAuth (?btg=...), limpando o parâmetro depois.
  useEffect(() => {
    const f = sp.get('btg')
    if (f && FEEDBACK[f]) {
      if (FEEDBACK[f].ok) toast.success(FEEDBACK[f].msg); else toast.error(FEEDBACK[f].msg)
      router.replace(destino)
    }
  }, [sp, destino, router])

  function runTest() {
    start(async () => {
      const r = await testBtg(orgSlug)
      if (!r.ok) toast.error(r.error)
      else toast.success(`OK — ${r.contas} conta(s), ${r.movimentos} movimento(s) nos últimos 30 dias${r.saldo != null ? `, saldo ${r.saldo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}.`)
    })
  }
  function runDisconnect() {
    start(async () => { await disconnectBtg(orgSlug); setConfirm(false); toast.success('BTG desconectado.'); router.refresh() })
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gray-900 text-[#fff] flex items-center justify-center shrink-0"><Landmark className="w-4 h-4" /></div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              Integração BTG
              <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                btg.env === 'production' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                {btg.env === 'production' ? 'Produção' : 'Sandbox'}
              </span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Puxa o extrato pra conciliar com os lançamentos.</p>
          </div>
        </div>
        {btg.connected && (
          <span className={cn('inline-flex items-center gap-1 text-xs font-medium',
            btg.status === 'error' ? 'text-red-600' : 'text-emerald-600')}>
            {btg.status === 'error' ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {btg.status === 'error' ? 'Erro' : 'Conectado'}
          </span>
        )}
      </div>

      {!btg.configured ? (
        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2.5 mt-4">
          Credenciais não configuradas no servidor. Defina <code className="text-gray-700">BTG_CLIENT_ID</code>, <code className="text-gray-700">BTG_CLIENT_SECRET</code>, <code className="text-gray-700">BTG_COMPANY_ID</code> e <code className="text-gray-700">BTG_SCOPES</code> no Coolify e registre o redirect <code className="text-gray-700">/api/btg/callback</code> no app BTG.
        </p>
      ) : !btg.connected ? (
        <div className="mt-4">
          <a href={`/api/btg/connect?org=${orgSlug}`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 transition">
            <Plug className="w-4 h-4" /> Conectar BTG
          </a>
          <p className="text-[11px] text-gray-400 mt-2">Abre o login do BTG Id; após consentir, a conexão fica salva (renovada automaticamente).</p>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mt-4">
            <div><dt className="text-gray-400">CNPJ</dt><dd className="text-gray-700 tabular-nums">{btg.companyId || '—'}</dd></div>
            <div><dt className="text-gray-400">Conta</dt><dd className="text-gray-700 truncate">{btg.accountId || '—'}</dd></div>
            <div><dt className="text-gray-400">Último sync</dt><dd className="text-gray-700">{btg.lastSyncAt ? formatDateBR(btg.lastSyncAt.slice(0, 10)) : '—'}</dd></div>
          </dl>
          {btg.status === 'error' && btg.lastError && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-3">{btg.lastError}</p>
          )}
          <div className="flex items-center gap-2 mt-4">
            <button onClick={runTest} disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition disabled:opacity-50">
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Testar conexão
            </button>
            {confirm ? (
              <span className="inline-flex items-center gap-2 text-xs">
                <span className="text-gray-500">Desconectar?</span>
                <button onClick={runDisconnect} disabled={pending} className="font-medium text-red-600 hover:text-red-700 disabled:opacity-50">Sim</button>
                <button onClick={() => setConfirm(false)} className="text-gray-400 hover:text-gray-600">Não</button>
              </span>
            ) : (
              <button onClick={() => setConfirm(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-600 transition">
                <Unplug className="w-3.5 h-3.5" /> Desconectar
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
