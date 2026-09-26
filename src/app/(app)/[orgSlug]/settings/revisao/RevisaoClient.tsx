'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { FileText, Palette, PackageCheck, Sparkles, KeyRound, Loader2, FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { salvarRevisaoIA, testarRevisaoIA } from '@/app/actions/revisao-ia'
import { ETAPAS, PROVEDORES, modeloPadrao, type RevisaoEtapa, type RevisaoEtapas, type RevisaoProvider } from '@/lib/ai/revisao-modelos'

interface Config {
  enabled: boolean
  stages: RevisaoEtapas
  provider: RevisaoProvider
  model: string
  keyHint: string | null
  keyIlegivel: boolean
}

const ICONE: Record<RevisaoEtapa, typeof FileText> = { redacao: FileText, design: Palette, finalizacao: PackageCheck }

export function RevisaoClient({ orgSlug, initial, geminiNoServidor }: { orgSlug: string; initial: Config; geminiNoServidor: boolean }) {
  const [salvo, setSalvo] = useState<Config>(initial)
  const [provider, setProvider] = useState<RevisaoProvider>(initial.provider)
  const [model, setModel] = useState(initial.model)
  const [chave, setChave] = useState('')
  const [salvando, startSalvar] = useTransition()
  const [testando, startTestar] = useTransition()
  const [confirmarRemocao, setConfirmarRemocao] = useState(false)

  const prov = PROVEDORES.find(p => p.value === provider)!
  const trocouProvedor = provider !== salvo.provider
  const temChave = !!salvo.keyHint && !salvo.keyIlegivel && !trocouProvedor
  const alterado = trocouProvedor || model !== salvo.model || !!chave.trim()

  // Liga/desliga e etapas salvam na hora (sem mexer na chave).
  function salvarRapido(next: Pick<Config, 'enabled' | 'stages'>, msg: string) {
    const prev = salvo
    setSalvo({ ...salvo, ...next })
    startSalvar(async () => {
      const r = await salvarRevisaoIA(orgSlug, { ...next, provider: salvo.provider, model: salvo.model })
      if (r.error) { setSalvo(prev); toast.error(r.error) } else toast.success(msg)
    })
  }

  function salvarModelo() {
    const nova = chave.trim()
    if (trocouProvedor && !nova && provider === 'anthropic') {
      toast.error('Cole a chave da Anthropic para trocar de provedor.')
      return
    }
    // Trocou de provedor sem chave nova (Gemini): a chave antiga é do outro — sai.
    const apiKey = nova ? nova : trocouProvedor ? '' : undefined
    startSalvar(async () => {
      const r = await salvarRevisaoIA(orgSlug, { enabled: salvo.enabled, stages: salvo.stages, provider, model, apiKey })
      if (r.error) { toast.error(r.error); return }
      setSalvo({
        ...salvo, provider, model,
        keyHint: apiKey === undefined ? salvo.keyHint : apiKey ? apiKey.slice(-4) : null,
        keyIlegivel: apiKey === undefined ? salvo.keyIlegivel : false,
      })
      setChave('')
      toast.success('Configuração salva.')
    })
  }

  function removerChave() {
    startSalvar(async () => {
      const r = await salvarRevisaoIA(orgSlug, { enabled: salvo.enabled, stages: salvo.stages, provider: salvo.provider, model: salvo.model, apiKey: '' })
      if (r.error) { toast.error(r.error); return }
      setSalvo({ ...salvo, keyHint: null, keyIlegivel: false })
      setConfirmarRemocao(false)
      toast.success('Chave removida.')
    })
  }

  function testar() {
    startTestar(async () => {
      const r = await testarRevisaoIA(orgSlug)
      if (r.error) toast.error(r.error, { duration: 8000 })
      else toast.success(r.ok, { duration: 8000 })
    })
  }

  const semChaveAviso = provider === 'anthropic'
    ? 'Sem chave cadastrada — o botão Revisar não funciona até cadastrar.'
    : geminiNoServidor
      ? 'Sem chave cadastrada — usa a chave do Gemini que já está no servidor.'
      : 'Sem chave cadastrada — o botão Revisar não funciona até cadastrar.'

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900 inline-flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-orange-500" /> Revisão por IA
        </h2>
        <p className="text-gray-500 text-sm mt-0.5">
          Botão <strong>Revisar</strong> na tarefa: a pessoa pede a revisão antes de mover o status e vê só os erros
          apontados. Seguir ou corrigir é decisão dela — nada trava a tarefa.
        </p>
      </div>

      {/* Liga/desliga geral */}
      <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3 max-w-2xl">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">Revisão IA ligada</p>
          <p className="text-xs text-gray-500 mt-0.5">Desligada, o botão Revisar some de todas as tarefas.</p>
        </div>
        <Switch
          checked={salvo.enabled}
          label="Revisão IA ligada"
          disabled={salvando}
          onChange={v => salvarRapido({ enabled: v, stages: salvo.stages }, v ? 'Revisão IA ligada.' : 'Revisão IA desligada.')}
        />
      </div>

      {/* Etapas */}
      <div className="max-w-2xl">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Etapas com o botão</p>
        <ul className={cn('space-y-2', !salvo.enabled && 'opacity-50')}>
          {ETAPAS.map(({ key, label, desc }) => {
            const Icon = ICONE[key]
            return (
              <li key={key} className="flex items-start gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
                <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', salvo.stages[key] ? 'text-orange-500' : 'text-gray-300')} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                </div>
                <Switch
                  checked={salvo.stages[key]}
                  label={`Revisão em ${label}`}
                  disabled={salvando || !salvo.enabled}
                  onChange={v => salvarRapido(
                    { enabled: salvo.enabled, stages: { ...salvo.stages, [key]: v } },
                    v ? `Botão Revisar em ${label}.` : `Sem botão Revisar em ${label}.`,
                  )}
                />
              </li>
            )
          })}
        </ul>
      </div>

      {/* Provedor, modelo e chave */}
      <div className="max-w-2xl bg-white border border-gray-200 rounded-2xl p-4 space-y-4">
        <p className="text-sm font-medium text-gray-900 inline-flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-orange-500" /> Modelo e chave
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-gray-500">Provedor</span>
            <div className="mt-1">
              <Select
                value={provider}
                onChange={v => { const p = v as RevisaoProvider; setProvider(p); setModel(p === salvo.provider ? salvo.model : modeloPadrao(p)) }}
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
                options={prov.modelos.map(m => ({ value: m.value, label: `${m.label} · ${m.custo}` }))}
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
            placeholder={temChave ? `•••• ${salvo.keyHint} (cadastrada — cole outra para trocar)` : prov.keyHint}
            className="mt-1 w-full px-3 py-2.5 text-base sm:text-sm bg-gray-100 border border-transparent rounded-xl focus:bg-white focus:border-orange-300 focus:outline-none transition-colors"
          />
          <span className="block text-xs mt-1 text-gray-400">
            {salvo.keyIlegivel && !trocouProvedor
              ? 'A chave salva não pôde ser lida (o segredo do servidor mudou). Cadastre de novo.'
              : temChave ? 'A chave fica cifrada no banco e nunca volta para o navegador.' : semChaveAviso}
          </span>
        </label>

        <p className="text-xs text-gray-400">
          Custo estimado se toda saída de etapa fosse revisada (~350/mês, medido em 09/2026). Com o botão sob demanda tende a ser menos.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={salvarModelo}
            disabled={salvando || !alterado}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 active:scale-[0.97] transition-colors disabled:opacity-40"
          >
            {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Salvar
          </button>
          <button
            type="button"
            onClick={testar}
            disabled={testando || alterado}
            title={alterado ? 'Salve antes de testar' : 'Revisa "A sua caza é bonita." com a configuração salva'}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-[0.97] transition-colors disabled:opacity-40"
          >
            {testando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
            Testar
          </button>
          {salvo.keyHint && !trocouProvedor && (
            <button
              type="button"
              onClick={() => setConfirmarRemocao(true)}
              disabled={salvando}
              className="ml-auto text-xs text-gray-400 hover:text-red-600 transition-colors"
            >
              Remover chave
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmarRemocao}
        title="Remover a chave da IA?"
        description="O botão Revisar para de funcionar até cadastrar outra chave."
        confirmLabel="Remover"
        loading={salvando}
        onConfirm={removerChave}
        onCancel={() => setConfirmarRemocao(false)}
      />
    </div>
  )
}
