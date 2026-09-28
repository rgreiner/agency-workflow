'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { LifeBuoy, Loader2, FlaskConical } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { salvarReservaIA, testarRevisaoIA } from '@/app/actions/revisao-ia'
import { PROVEDORES, modeloPadrao, type RevisaoProvider } from '@/lib/ai/revisao-modelos'

interface Reserva { provider: RevisaoProvider; model: string; keyHint: string | null; keyIlegivel: boolean }

/**
 * Chave RESERVA: se a principal falhar (sem crédito, chave recusada, provedor
 * fora do ar), toda a IA do Flow tenta esta. Opcional.
 */
export function ReservaCard({ orgSlug, initial, principal }: { orgSlug: string; initial: Reserva | null; principal: RevisaoProvider }) {
  const inicialProvider: RevisaoProvider = initial?.provider ?? (principal === 'gemini' ? 'anthropic' : 'gemini')
  const [salvo, setSalvo] = useState<Reserva | null>(initial)
  const [provider, setProvider] = useState<RevisaoProvider>(inicialProvider)
  const [model, setModel] = useState(initial?.model ?? modeloPadrao(inicialProvider))
  const [chave, setChave] = useState('')
  const [salvando, startSalvar] = useTransition()
  const [testando, startTestar] = useTransition()
  const [confirmarRemocao, setConfirmarRemocao] = useState(false)

  const prov = PROVEDORES.find(p => p.value === provider)!
  const trocouProvedor = !!salvo && provider !== salvo.provider
  const temChave = !!salvo?.keyHint && !salvo.keyIlegivel && !trocouProvedor
  const alterado = !salvo ? !!chave.trim() : trocouProvedor || model !== salvo.model || !!chave.trim()

  function salvar() {
    const nova = chave.trim()
    if ((!salvo || trocouProvedor) && !nova) { toast.error('Cole a chave da reserva.'); return }
    startSalvar(async () => {
      const r = await salvarReservaIA(orgSlug, { provider, model, apiKey: nova || undefined })
      if (r.error) { toast.error(r.error); return }
      setSalvo({ provider, model, keyHint: nova ? nova.slice(-4) : salvo!.keyHint, keyIlegivel: nova ? false : salvo!.keyIlegivel })
      setChave('')
      toast.success('Reserva salva.')
    })
  }

  function remover() {
    startSalvar(async () => {
      const r = await salvarReservaIA(orgSlug, { provider, model, apiKey: '' })
      if (r.error) { toast.error(r.error); return }
      setSalvo(null)
      setConfirmarRemocao(false)
      toast.success('Reserva removida.')
    })
  }

  function testar() {
    startTestar(async () => {
      const r = await testarRevisaoIA(orgSlug, 'reserva')
      if (r.error) toast.error(r.error, { duration: 8000 })
      else toast.success(r.ok, { duration: 8000 })
    })
  }

  return (
    <div className="max-w-2xl bg-white border border-gray-200 rounded-2xl p-4 space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-900 inline-flex items-center gap-2">
          <LifeBuoy className="w-4 h-4 text-orange-500" /> Chave reserva <span className="text-xs font-normal text-gray-400">(opcional)</span>
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Se a principal falhar — sem crédito, chave recusada ou provedor fora do ar —, a mesma chamada tenta esta.
          Melhor de outro provedor, para não cair junto.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-gray-500">Provedor</span>
          <div className="mt-1">
            <Select
              value={provider}
              onChange={v => { const p = v as RevisaoProvider; setProvider(p); setModel(p === salvo?.provider ? salvo.model : modeloPadrao(p)) }}
              options={PROVEDORES.map(p => ({ value: p.value, label: p.label }))}
              className="w-full"
            />
          </div>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">Modelo</span>
          <div className="mt-1">
            <Select
              value={model}
              onChange={setModel}
              options={prov.modelos.map(m => ({ value: m.value, label: m.label }))}
              className="w-full"
            />
          </div>
        </label>
      </div>

      <label className="block">
        <span className="text-xs text-gray-500">Chave da API</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={chave}
          onChange={e => setChave(e.target.value)}
          placeholder={temChave ? `•••• ${salvo!.keyHint} (cadastrada — cole outra para trocar)` : prov.keyHint}
          className="mt-1 w-full px-3 py-2.5 text-base sm:text-sm bg-gray-100 border border-transparent rounded-xl focus:bg-white focus:border-orange-300 focus:outline-none transition-colors"
        />
        {salvo?.keyIlegivel && !trocouProvedor && (
          <span className="block text-xs mt-1 text-gray-400">A chave salva não pôde ser lida (o segredo do servidor mudou). Cadastre de novo.</span>
        )}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={salvar}
          disabled={salvando || !alterado}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 active:scale-[0.97] transition-colors disabled:opacity-40"
        >
          {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Salvar reserva
        </button>
        <button
          type="button"
          onClick={testar}
          disabled={testando || alterado || !salvo}
          title={!salvo ? 'Cadastre a reserva antes de testar' : alterado ? 'Salve antes de testar' : 'Testa só a reserva'}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-[0.97] transition-colors disabled:opacity-40"
        >
          {testando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
          Testar reserva
        </button>
        {salvo && (
          <button
            type="button"
            onClick={() => setConfirmarRemocao(true)}
            disabled={salvando}
            className="ml-auto text-xs text-gray-400 hover:text-red-600 transition-colors"
          >
            Remover reserva
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmarRemocao}
        title="Remover a chave reserva?"
        description="Se a principal falhar, a IA volta a ficar sem alternativa."
        confirmLabel="Remover"
        loading={salvando}
        onConfirm={remover}
        onCancel={() => setConfirmarRemocao(false)}
      />
    </div>
  )
}
