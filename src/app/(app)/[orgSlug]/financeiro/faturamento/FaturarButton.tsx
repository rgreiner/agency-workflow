'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Receipt, Send, Loader2, AlertTriangle, FileText } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Botões da conferência de Faturamento:
 *  • "Faturar" — só gera o(s) lançamento(s) (como sempre).
 *  • "Faturar e enviar" (quando `enviar` é passado) — fatura E dispara o e-mail
 *    ao cliente com os documentos anexados. NUNCA automático: o financeiro
 *    escolhe, confirma o destinatário e envia.
 *  • "e emitir NF" (quando `emitirNf` é passado) — fatura e abre a emissão da
 *    NFS-e. Nessa ordem porque a nota é emitida contra um lançamento, e o
 *    lançamento nasce no faturar. Quem passou `emitirNf` cuida do refresh:
 *    atualizar aqui tiraria a linha da tela no meio da emissão.
 * Se faltar NF/Boleto, avisa mas não trava (decisão: só avisar).
 *
 * `blocked` é outra coisa: é o caso em que faturar NÃO geraria lançamento — hoje,
 * mídia sem veículo. Aí o botão some e fica o motivo no lugar dele, porque deixar
 * clicar só pra receber erro do banco é pior do que não deixar clicar.
 */
export function FaturarButton({ action, missing, okToast, enviar, destinatarioPadrao, blocked, semComissao, emitirNf }: {
  action: () => Promise<{ error?: string } | void>
  missing: string[]
  okToast: string
  enviar?: (destinatario: string) => Promise<{ error?: string }>
  destinatarioPadrao?: string
  blocked?: string
  /**
   * Documento em que a agência não ganha comissão (o cliente paga o veículo
   * direto). Faturar aqui serve só para ele constar no Relatório de
   * Autorização — nenhum lançamento é gerado, e a confirmação diz isso.
   */
  semComissao?: boolean
  /**
   * Fatura e, em seguida, abre a emissão da NFS-e. Só aparece quando a org tem
   * nota configurada e o documento ainda não tem NF anexada — oferecer emissão
   * sobre documento que já tem nota é convidar à duplicata.
   */
  emitirNf?: () => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [mode, setMode] = useState<null | 'faturar' | 'enviar' | 'nf'>(null)
  const [dest, setDest] = useState(destinatarioPadrao ?? '')

  if (blocked) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700 text-right leading-tight" title={blocked}>
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {blocked}
      </span>
    )
  }

  const avisoMissing = missing.length > 0 && (
    <span className="inline-flex items-center gap-1 text-amber-600" title={`Faltam: ${missing.join(', ')}`}>
      <AlertTriangle className="w-3.5 h-3.5" /> falta {missing.join(' + ')}
    </span>
  )

  function runFaturar() {
    start(async () => {
      const res = await action()
      if (res?.error) { toast.error(res.error); return }
      toast.success(okToast)
      setMode(null)
      router.refresh()
    })
  }

  function runEnviar() {
    start(async () => {
      const r1 = await action()
      if (r1?.error) { toast.error(r1.error); return }
      const r2 = await enviar!(dest)
      if (r2?.error) { toast.error(r2.error); setMode(null); router.refresh(); return }
      toast.success('Faturado e enviado ao cliente.')
      setMode(null)
      router.refresh()
    })
  }

  function runEmitir() {
    start(async () => {
      const r1 = await action()
      if (r1?.error) { toast.error(r1.error); return }
      // Sem refresh aqui: a linha sairia da lista (o documento vira "faturado")
      // e levaria junto o diálogo de emissão que está prestes a abrir.
      const r2 = await emitirNf!()
      if (r2?.error) { toast.error(r2.error); setMode(null); router.refresh(); return }
      setMode(null)
    })
  }

  // Confirmação do "e emitir NF": fatura primeiro, por isso o aviso.
  if (mode === 'nf') {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        {avisoMissing}
        <span className="text-gray-500">Fatura e abre a emissão. Faturar?</span>
        <button onClick={runEmitir} disabled={pending}
          className="font-medium text-orange-600 hover:text-orange-700 inline-flex items-center gap-1 disabled:opacity-50">
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Sim'}
        </button>
        <button onClick={() => setMode(null)} className="text-gray-400 hover:text-gray-600">Não</button>
      </span>
    )
  }

  // Confirmação do "Faturar e enviar": destinatário editável.
  if (mode === 'enviar') {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        {avisoMissing}
        <input
          type="email" value={dest} onChange={(e) => setDest(e.target.value)}
          placeholder="financeiro@cliente.com.br"
          className="px-2 py-1 w-52 bg-gray-100 border border-transparent rounded-lg text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        <button onClick={runEnviar} disabled={pending || !dest.trim()}
          className="font-medium text-orange-600 hover:text-orange-700 inline-flex items-center gap-1 disabled:opacity-50">
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <>Faturar e enviar</>}
        </button>
        <button onClick={() => setMode(null)} className="text-gray-400 hover:text-gray-600">Cancelar</button>
      </span>
    )
  }

  // Confirmação do "Faturar" simples.
  if (mode === 'faturar') {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        {avisoMissing}
        <span className={semComissao ? 'text-amber-700' : 'text-gray-500'}>
          {semComissao ? 'Sem comissão — entra no relatório, não gera lançamento. Faturar?' : 'Faturar?'}
        </span>
        <button onClick={runFaturar} disabled={pending}
          className="font-medium text-orange-600 hover:text-orange-700 inline-flex items-center gap-1 disabled:opacity-50">
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Sim'}
        </button>
        <button onClick={() => setMode(null)} className="text-gray-400 hover:text-gray-600">Não</button>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button onClick={() => setMode('faturar')}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-[#fff] text-xs font-medium rounded-lg hover:bg-orange-700 active:scale-[0.97] transition">
        <Receipt className="w-3.5 h-3.5" /> Faturar
      </button>
      {emitirNf && (
        <button onClick={() => setMode('nf')}
          title="Faturar e emitir a NFS-e desta primeira parcela"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-orange-200 text-orange-700 text-xs font-medium rounded-lg hover:bg-orange-500/10 active:scale-[0.97] transition-colors">
          <FileText className="w-3.5 h-3.5" /> <span className="hidden sm:inline">e emitir NF</span>
        </button>
      )}
      {enviar && (
        <button onClick={() => { setDest(destinatarioPadrao ?? ''); setMode('enviar') }}
          title="Faturar e enviar o financeiro ao cliente por e-mail"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-orange-200 text-orange-700 text-xs font-medium rounded-lg hover:bg-orange-500/10 active:scale-[0.97] transition">
          <Send className="w-3.5 h-3.5" /> <span className="hidden sm:inline">e enviar</span>
        </button>
      )}
    </span>
  )
}
