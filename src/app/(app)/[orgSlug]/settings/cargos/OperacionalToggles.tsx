'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Marcadores de acesso ao Operacional de um cargo. "Vê tudo" (Diretoria) sobrepõe
 * os demais — quando ligado, Mídias/Produção ficam desabilitados (implícitos).
 */
export function OperacionalToggles({ verTudo, midias, producao, setVerTudo, setMidias, setProducao }: {
  verTudo: boolean; midias: boolean; producao: boolean
  setVerTudo: (v: boolean) => void; setMidias: (v: boolean) => void; setProducao: (v: boolean) => void
}) {
  const rows = [
    { checked: verTudo, onChange: setVerTudo, disabled: false, label: 'Vê tudo (Diretoria)', hint: 'Enxerga todas as seções, ignora os toggles do usuário' },
    { checked: midias, onChange: setMidias, disabled: verTudo, label: 'Libera Mídias', hint: 'Com Vendas ligado no usuário, mostra Liberação de mídias' },
    { checked: producao, onChange: setProducao, disabled: verTudo, label: 'Libera Produção', hint: 'Com Vendas ligado no usuário, mostra Liberação de Produção' },
  ]
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-2">Acesso ao Operacional</label>
      <div className="space-y-1">
        {rows.map(r => (
          <button
            key={r.label}
            type="button"
            onClick={() => { if (!r.disabled) r.onChange(!r.checked) }}
            disabled={r.disabled}
            className={cn(
              'w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg border text-left transition',
              r.disabled ? 'opacity-40 cursor-not-allowed border-gray-100'
                : r.checked ? 'border-orange-200 bg-orange-50/50' : 'border-gray-200 hover:border-gray-300'
            )}
          >
            <span className={cn(
              'w-4 h-4 mt-0.5 rounded border flex items-center justify-center shrink-0',
              r.checked ? 'bg-orange-600 border-orange-600' : 'border-gray-300'
            )}>
              {r.checked && <Check className="w-3 h-3 text-white" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-gray-800">{r.label}</span>
              <span className="block text-[11px] text-gray-400">{r.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
