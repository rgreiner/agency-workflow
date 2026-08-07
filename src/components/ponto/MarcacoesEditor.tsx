'use client'

import { Plus, Trash2 } from 'lucide-react'

/** Editor de marcações em N pares livres (entrada · saída · retorno …) — o
 *  mesmo padrão do modal "Corrigir dia" do RH no espelho. Controlado: recebe a
 *  lista e devolve a lista nova a cada mudança. */
export function MarcacoesEditor({ horas, onChange, disabled }: {
  horas: string[]; onChange: (v: string[]) => void; disabled?: boolean
}) {
  const set = (i: number, v: string) => onChange(horas.map((x, k) => (k === i ? v : x)))
  const add = () => onChange([...horas, '', ''])
  const del = (i: number) => onChange(horas.filter((_, k) => k !== i))

  return (
    <div>
      <div className="space-y-2">
        {horas.map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400 w-14">{i === 0 ? 'Entrada' : i % 2 === 1 ? 'Saída' : 'Retorno'}</span>
            <input type="time" value={h} disabled={disabled} onChange={e => set(i, e.target.value)}
              className="w-24 px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50" />
            <button type="button" onClick={() => del(i)} disabled={disabled}
              className="p-1 text-gray-400 hover:text-red-500 transition disabled:opacity-50" title="Remover marcação">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} disabled={disabled}
        className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-orange-600 transition disabled:opacity-50">
        <Plus className="w-3.5 h-3.5" /> Adicionar par (pausa)
      </button>
    </div>
  )
}

/** Limpa e valida a lista do editor: pares completos e ordem crescente.
 *  Devolve a lista sem vazios, pronta para enviar. */
export function validarMarcacoes(horas: string[]): { ok: true; limpo: string[] } | { ok: false; erro: string } {
  const limpo = horas.map(h => h.trim()).filter(Boolean)
  if (limpo.length % 2 === 1) return { ok: false, erro: 'As marcações vêm em pares (entrada e saída).' }
  const ordenado = [...limpo].sort()
  if (ordenado.join() !== limpo.join()) return { ok: false, erro: 'As marcações precisam estar em ordem crescente.' }
  return { ok: true, limpo }
}
