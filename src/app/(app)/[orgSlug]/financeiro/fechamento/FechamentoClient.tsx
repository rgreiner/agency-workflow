'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Mail, Paperclip, Send, AlertTriangle, Plus, X, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  previewFechamento, enviarFechamento, salvarConfigContabil, abrirFechamentoManual,
} from '@/app/actions/contabil'

export interface Fechamento {
  id: string
  competencia: string
  status: string
  confirmado_em: string | null
  enviado_em: string | null
  destinatarios: string[] | null
  erro: string | null
}
export interface ConfigContabil {
  contabil_emails: string[]
  contabil_dia: number
  contabil_ativo: boolean
}

interface Preview {
  resumo?: { contas: number; movimentos: number; recebimentos: number; totalRecebido: number; ofxAnexados: number }
  avisos?: string[]
  anexos?: { nome: string; kb: number }[]
  destinatarios?: string[]
  error?: string
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const label = (c: string) => { const [y, m] = c.split('-'); return `${MESES[Number(m) - 1]}/${y}` }
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const inputCls = 'w-full px-3 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500'

export function FechamentoClient({ orgSlug, fechamentos, config, competenciaSugerida }: {
  orgSlug: string; fechamentos: Fechamento[]; config: ConfigContabil; competenciaSugerida: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [emails, setEmails] = useState<string[]>(config.contabil_emails.length ? config.contabil_emails : [''])
  const [dia, setDia] = useState(String(config.contabil_dia))
  const [ativo, setAtivo] = useState(config.contabil_ativo)
  const [preview, setPreview] = useState<Record<string, Preview | 'carregando'>>({})
  const [confirmar, setConfirmar] = useState<Fechamento | null>(null)

  const pendentes = fechamentos.filter(f => f.status !== 'enviado')
  const enviados = fechamentos.filter(f => f.status === 'enviado')

  function salvarConfig() {
    startTransition(async () => {
      const r = await salvarConfigContabil(orgSlug, { emails, dia: Number(dia) || 5, ativo })
      if (r?.error) { toast.error(r.error); return }
      toast.success('Configuração salva.')
      router.refresh()
    })
  }

  function abrirManual() {
    startTransition(async () => {
      const r = await abrirFechamentoManual(orgSlug, competenciaSugerida)
      if (r?.error) { toast.error(r.error); return }
      toast.success(`Fechamento de ${label(competenciaSugerida)} aberto.`)
      router.refresh()
    })
  }

  async function carregarPreview(f: Fechamento) {
    setPreview(p => ({ ...p, [f.competencia]: 'carregando' }))
    const r = await previewFechamento(orgSlug, f.competencia)
    setPreview(p => ({ ...p, [f.competencia]: r as Preview }))
  }

  function enviar(f: Fechamento) {
    setConfirmar(null)
    startTransition(async () => {
      const r = await enviarFechamento(orgSlug, f.competencia)
      if (r?.error) { toast.error(r.error); return }
      if (r?.aviso) toast.warning(r.aviso)
      else toast.success(`Enviado para ${r?.destinatarios?.join(', ')}.`)
      router.refresh()
    })
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Fechamento contábil</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Extrato bancário e recebimentos do mês, enviados à contabilidade
        </p>
      </div>

      {/* Pendentes — o que exige ação */}
      {pendentes.length > 0 ? (
        <div className="space-y-3">
          {pendentes.map(f => {
            const p = preview[f.competencia]
            return (
              <div key={f.id} className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">{label(f.competencia)}</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Confira antes de enviar — depois de sair, sai.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!p && (
                      <button onClick={() => carregarPreview(f)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">
                        <FileSpreadsheet className="w-4 h-4" /> Ver o que vai
                      </button>
                    )}
                    <button onClick={() => setConfirmar(f)} disabled={isPending || !config.contabil_emails.length}
                      title={config.contabil_emails.length ? undefined : 'Configure o e-mail da contabilidade abaixo'}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
                      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Conferir e enviar
                    </button>
                  </div>
                </div>

                {f.erro && (
                  <p className="mt-3 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
                    Tentativa anterior falhou: {f.erro}
                  </p>
                )}

                {p === 'carregando' && (
                  <p className="mt-4 text-sm text-gray-400 inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Montando o pacote…
                  </p>
                )}

                {p && p !== 'carregando' && (p.error ? (
                  <p className="mt-4 text-sm text-red-600">{p.error}</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <Stat label="Movimentos" valor={String(p.resumo?.movimentos ?? 0)} />
                      <Stat label="Contas" valor={String(p.resumo?.contas ?? 0)} />
                      <Stat label="Recebimentos" valor={String(p.resumo?.recebimentos ?? 0)} />
                      <Stat label="Total recebido" valor={brl(p.resumo?.totalRecebido ?? 0)} />
                    </div>

                    <div>
                      <p className="text-xs font-medium text-gray-400 mb-1.5">Anexos</p>
                      <ul className="space-y-1">
                        {p.anexos?.map(a => (
                          <li key={a.nome} className="flex items-center gap-2 text-sm text-gray-700">
                            <Paperclip className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span className="truncate">{a.nome}</span>
                            <span className="text-xs text-gray-400 shrink-0">{a.kb} KB</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {!!p.avisos?.length && (
                      <div className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 space-y-1">
                        {p.avisos.map((a, i) => (
                          <p key={i} className="flex items-start gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{a}
                          </p>
                        ))}
                      </div>
                    )}

                    <p className="text-xs text-gray-500">
                      Vai para <strong>{p.destinatarios?.join(', ') || '(nenhum e-mail configurado)'}</strong>
                    </p>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-gray-600">
            <Check className="w-4 h-4 text-emerald-500 inline mr-1.5" />
            Nenhum fechamento pendente.
          </p>
          <button onClick={abrirManual} disabled={isPending}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50">
            <Plus className="w-4 h-4" /> Abrir {label(competenciaSugerida)} agora
          </button>
        </div>
      )}

      {/* Configuração */}
      <section className="bg-white rounded-2xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2 mb-1">
          <Mail className="w-4 h-4 text-gray-400" /> Para quem vai
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          O cron abre o fechamento do mês anterior a partir do dia escolhido e avisa o Financeiro
          na caixa de entrada. O e-mail só sai quando alguém confere e confirma aqui.
        </p>

        <div className="space-y-2 mb-4">
          {emails.map((e, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={e} onChange={ev => setEmails(v => v.map((x, j) => j === i ? ev.target.value : x))}
                placeholder="contabilidade@escritorio.com.br" className={inputCls} />
              {emails.length > 1 && (
                <button onClick={() => setEmails(v => v.filter((_, j) => j !== i))}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" aria-label="Remover">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button onClick={() => setEmails(v => [...v, ''])}
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-orange-600 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Adicionar e-mail
          </button>
        </div>

        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Dia do mês</label>
            <input type="number" min={1} max={28} value={dia} onChange={e => setDia(e.target.value)}
              className={cn(inputCls, 'w-24')} />
          </div>
          <label className="flex items-center gap-2 pb-2.5 cursor-pointer">
            <input type="checkbox" checked={ativo} onChange={() => setAtivo(v => !v)}
              className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
            <span className="text-sm text-gray-700">Abrir automaticamente todo mês</span>
          </label>
          <button onClick={salvarConfig} disabled={isPending}
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
          </button>
        </div>
      </section>

      {/* Histórico */}
      {enviados.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2.5">Já enviados</h2>
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-50">
            {enviados.map(f => (
              <div key={f.id} className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
                <span className="text-sm font-medium text-gray-900">{label(f.competencia)}</span>
                <span className="text-xs text-gray-500 truncate">{f.destinatarios?.join(', ')}</span>
                <span className="text-xs text-emerald-600 inline-flex items-center gap-1 shrink-0">
                  <Check className="w-3.5 h-3.5" />
                  {f.enviado_em ? new Date(f.enviado_em).toLocaleDateString('pt-BR') : 'enviado'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={!!confirmar} loading={isPending}
        title={`Enviar ${confirmar ? label(confirmar.competencia) : ''} à contabilidade`}
        description={`O e-mail vai para ${config.contabil_emails.join(', ')} com a planilha e os OFX do período. Não dá para cancelar depois de enviado.`}
        confirmLabel="Enviar agora"
        onConfirm={() => confirmar && enviar(confirmar)}
        onCancel={() => setConfirmar(null)}
      />
    </div>
  )
}

function Stat({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-2.5">
      <p className="text-[11px] font-medium text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-gray-900 tabular-nums">{valor}</p>
    </div>
  )
}
