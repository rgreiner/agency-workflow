'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

type Resultado = { error?: string; revisao?: 'confirmar'; erros?: { trecho: string; correcao: string }[]; falhou?: boolean } | undefined

/**
 * Mover o status passando pela Revisão IA: quando o servidor pede confirmação
 * (a revisão apontou erros ou a IA não respondeu), abre o diálogo e, se a
 * pessoa concordar, repete o pedido com `aceitar`. Cancelar = `{ cancelado }`.
 */
export function useAvancoRevisado() {
  const [pedido, setPedido] = useState<{ erros: { trecho: string; correcao: string }[]; falhou: boolean } | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  function responder(ok: boolean) {
    resolver.current?.(ok)
    resolver.current = null
    setPedido(null)
  }

  async function mover(chamar: (aceitar: boolean) => Promise<Resultado>): Promise<Resultado | { cancelado: true }> {
    const r = await chamar(false)
    if (r?.revisao !== 'confirmar') return r
    const ok = await new Promise<boolean>(res => {
      resolver.current = res
      setPedido({ erros: r.erros ?? [], falhou: !!r.falhou })
    })
    if (!ok) return { cancelado: true }
    return chamar(true)
  }

  const n = pedido?.erros.length ?? 0
  // Portal no body: a tarefa costuma abrir dentro de um modal com transform, que
  // prenderia o `fixed` do diálogo dentro dele.
  const dialogo = pedido && typeof document !== 'undefined' && createPortal(
    <ConfirmDialog
      open
      title={pedido?.falhou ? 'Seguir sem a revisão?' : `Seguir com ${n} ${n === 1 ? 'erro apontado' : 'erros apontados'}?`}
      description={pedido?.falhou
        ? 'A revisão por IA não foi concluída. Confirmando, você assume seguir sem ela — fica registrado na movimentação.'
        : 'Confirmando, você concorda em seguir com os apontamentos abaixo sem corrigir — fica registrado na movimentação.'}
      confirmLabel="Concordo, seguir"
      cancelLabel="Voltar e corrigir"
      onConfirm={() => responder(true)}
      onCancel={() => responder(false)}
    >
      {!!n && (
        <ul className="mt-3 space-y-1 text-sm text-gray-700 max-h-48 overflow-y-auto">
          {pedido!.erros.map((e, i) => <li key={i}>Erro &quot;{e.trecho}&quot; - {e.correcao}</li>)}
        </ul>
      )}
    </ConfirmDialog>,
    document.body,
  )

  return { mover, dialogo }
}
