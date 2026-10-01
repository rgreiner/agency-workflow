'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, FileText, ReceiptText, AlertTriangle, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/midia'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { emitirNota, type NotaDoLancamento } from '@/app/actions/nfse'

/**
 * Emissão de NFS-e a partir do lançamento a receber (migs. 309/313).
 *
 * Emitir é ato público com prazo curto para cancelar: por isso UMA por vez e
 * sempre com diálogo que diz o valor, o tomador e — em letras grandes — se a
 * nota é de teste ou oficial. Nada de lote.
 */

/** Pílula da coluna NF: emite quando não há nota, mostra o número quando há. */
export function NotaCelula({ orgSlug, lancamentoId, nota, podeEmitir, onEmitida }: {
  orgSlug: string
  lancamentoId: string
  nota?: NotaDoLancamento
  /** Falso quando o lançamento não é a receber ou veio de importação. */
  podeEmitir: boolean
  onEmitida: (n: NotaDoLancamento) => void
}) {
  const [confirmar, setConfirmar] = useState(false)

  if (nota) {
    return (
      <span className="inline-flex items-center gap-1" title={`Chave ${nota.chave}`}>
        <FileText className={cn('w-3.5 h-3.5', nota.ambiente === 'producao' ? 'text-emerald-600' : 'text-sky-500')} />
        <span className="text-[11px] font-medium tabular-nums text-gray-700">{nota.numero ?? 'NF'}</span>
      </span>
    )
  }
  if (!podeEmitir) return <span className="text-gray-300">—</span>

  return (
    <>
      <button type="button" onClick={() => setConfirmar(true)}
        title="Emitir NFS-e deste lançamento"
        className="press inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium text-gray-400 hover:text-orange-700 hover:bg-orange-50 transition-colors">
        <ReceiptText className="w-3.5 h-3.5" /> Emitir
      </button>
      {confirmar && (
        <DialogoEmitir orgSlug={orgSlug} lancamentoId={lancamentoId}
          onFechar={() => setConfirmar(false)} onEmitida={n => { setConfirmar(false); onEmitida(n) }} />
      )}
    </>
  )
}

/** Bloco dentro do lançamento aberto — o lugar com espaço para o detalhe. */
export function NotaFiscalBloco({ orgSlug, lancamentoId, nota, valor, cliente, onEmitida }: {
  orgSlug: string
  lancamentoId: string
  nota?: NotaDoLancamento
  valor: number
  cliente: string | null
  onEmitida: (n: NotaDoLancamento) => void
}) {
  const [confirmar, setConfirmar] = useState(false)
  const [copiado, setCopiado] = useState(false)

  async function copiarChave() {
    if (!nota) return
    try {
      await navigator.clipboard.writeText(nota.chave)
      setCopiado(true); setTimeout(() => setCopiado(false), 1600)
    } catch { toast.error('Não foi possível copiar.') }
  }

  return (
    <div className="border-t border-gray-100 pt-4">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-gray-600 inline-flex items-center gap-1.5">
          <ReceiptText className="w-3.5 h-3.5" /> Nota fiscal
        </label>
        {!nota && (
          <button type="button" onClick={() => setConfirmar(true)}
            className="press inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors">
            <ReceiptText className="w-3.5 h-3.5" /> Emitir NFS-e
          </button>
        )}
      </div>

      {nota ? (
        <div className="rounded-xl bg-gray-50 px-3 py-2.5 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-gray-900 tabular-nums">
              NFS-e {nota.numero ?? '—'}{nota.serie ? ` · série ${nota.serie}` : ''}
            </span>
            <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              nota.ambiente === 'producao' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700')}>
              {nota.ambiente === 'producao' ? 'oficial' : 'teste'}
            </span>
          </div>
          {/* A chave é o que se procura em conferência — clicar copia. */}
          <button type="button" onClick={copiarChave}
            className="no-press group flex items-center gap-1.5 text-left text-[11px] font-mono text-gray-500 hover:text-gray-800 transition-colors break-all">
            {copiado ? <Check className="w-3 h-3 shrink-0 text-emerald-600" /> : <Copy className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />}
            {nota.chave}
          </button>
        </div>
      ) : (
        <p className="text-xs text-gray-500 py-1">
          Sem nota. Emitir usa o certificado e os dados fiscais de Configurações → Nota fiscal.
        </p>
      )}

      {confirmar && (
        <DialogoEmitir orgSlug={orgSlug} lancamentoId={lancamentoId} valor={valor} cliente={cliente}
          onFechar={() => setConfirmar(false)} onEmitida={n => { setConfirmar(false); onEmitida(n) }} />
      )}
    </div>
  )
}

function DialogoEmitir({ orgSlug, lancamentoId, valor, cliente, onFechar, onEmitida }: {
  orgSlug: string
  lancamentoId: string
  valor?: number
  cliente?: string | null
  onFechar: () => void
  onEmitida: (n: NotaDoLancamento) => void
}) {
  const router = useRouter()
  const [emitindo, start] = useTransition()

  return (
    <ConfirmDialog
      open
      title="Emitir NFS-e?"
      description={[
        cliente ? `Tomador: ${cliente}.` : '',
        valor != null ? `Valor: ${formatBRL(valor)}.` : '',
        'A nota é enviada à Receita no ambiente configurado. Nota emitida tem prazo curto para cancelar.',
      ].filter(Boolean).join(' ')}
      confirmLabel="Emitir"
      loading={emitindo}
      onCancel={onFechar}
      onConfirm={() => start(async () => {
        const r = await emitirNota(orgSlug, lancamentoId)
        if (r.error) { toast.error(r.error, { duration: 10000 }); return }
        if (!r.nota) { toast.error('A Receita não devolveu a nota.'); return }
        toast.success(`NFS-e ${r.nota.numero ?? ''} emitida${r.nota.ambiente === 'restrita' ? ' (teste)' : ''}.`)
        onEmitida(r.nota)
        router.refresh()
      })}
    >
      <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-px text-amber-600" />
        Confira o valor e o tomador antes. Código do serviço e tributação vêm do cadastro fiscal — se estiverem errados, a correção é cancelar a nota.
      </p>
    </ConfirmDialog>
  )
}

/** Indicador de carregamento das notas, usado enquanto o mapa não chegou. */
export function NotaCarregando() {
  return <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-300 inline" />
}
