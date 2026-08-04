'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { ShieldCheck, Loader2, Check, X, FileSignature, Unlock, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { assinarTermo, assinarEspelho, reabrirCiclo, carregarAssinaturas, type Assinaturas } from '@/app/actions/rh-assinatura'
import { TERMO_TEXTO } from '@/lib/rh/termo'
import { enviarCodigo } from '@/app/actions/rh-otp'

const dt = (s: string) => new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function AssinaturaPanel({ orgSlug, colaboradorId, competencia, papel, onMudou }: {
  orgSlug: string; colaboradorId: string; competencia: string
  /** 'colaborador' = a própria pessoa assinando · 'empresa' = o RH contra-assinando */
  papel: 'colaborador' | 'empresa'
  onMudou?: () => void
}) {
  const [a, setA] = useState<Assinaturas | null>(null)
  const [modal, setModal] = useState<null | 'termo' | 'assinar' | 'reabrir'>(null)
  const [senha, setSenha] = useState('')
  const [codigo, setCodigo] = useState('')
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [pending, start] = useTransition()

  const carregar = useCallback(async () => {
    const r = await carregarAssinaturas(orgSlug, colaboradorId, competencia)
    if (!r?.error) setA(r?.assinaturas ?? null)
  }, [orgSlug, colaboradorId, competencia])

  useEffect(() => { carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const daColab = a?.espelho.find(x => x.papel === 'colaborador')
  const daEmpresa = a?.espelho.find(x => x.papel === 'empresa')
  const minha = papel === 'colaborador' ? daColab : daEmpresa
  const precisaTermo = papel === 'colaborador' && !a?.termo

  function fechar() { setModal(null); setSenha(''); setCodigo(''); setEnviadoPara(null); setMotivo('') }

  // OTP só para o colaborador: a empresa contra-assina apenas com senha.
  const precisaCodigo = papel === 'colaborador'
  function pedirCodigo(finalidade: 'assinar_termo' | 'assinar_espelho') {
    start(async () => {
      const r = await enviarCodigo(orgSlug, colaboradorId, finalidade)
      if (r?.error) toast.error(r.error)
      else { setEnviadoPara(r.destino ?? null); toast.success('Código enviado ao seu e-mail pessoal.') }
    })
  }

  function assinarT() {
    start(async () => {
      const r = await assinarTermo(orgSlug, colaboradorId, senha, codigo)
      if (r?.error) toast.error(r.error)
      else { toast.success('Termo assinado.'); fechar(); carregar() }
    })
  }
  function assinarE() {
    start(async () => {
      const r = await assinarEspelho(orgSlug, colaboradorId, competencia, papel, senha, codigo)
      if (r?.error) toast.error(r.error)
      else { toast.success('Espelho assinado.'); fechar(); carregar(); onMudou?.() }
    })
  }
  function reabrir() {
    start(async () => {
      const r = await reabrirCiclo(orgSlug, colaboradorId, competencia, motivo)
      if (r?.error) toast.error(r.error)
      else { toast.success('Ciclo reaberto — a assinatura foi invalidada.'); fechar(); carregar(); onMudou?.() }
    })
  }

  const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 mb-5">
      <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
        <FileSignature className="w-4 h-4" /> Assinatura do período
      </h2>

      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        {([['Colaborador', daColab], ['Empresa', daEmpresa]] as const).map(([label, s]) => (
          <div key={label} className={`rounded-xl px-3 py-2.5 ring-1 ${s ? 'bg-emerald-50 ring-emerald-200' : 'bg-gray-50 ring-gray-200'}`}>
            <div className="text-[11px] text-gray-500">{label}</div>
            {s ? (
              <>
                <div className="text-sm font-medium text-emerald-700 inline-flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Assinado</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{s.por ?? '—'} · {dt(s.assinado_em)}{s.ip && ` · IP ${s.ip}`}</div>
                <div className="text-[10px] text-gray-400 font-mono mt-0.5 truncate" title={s.hash}>hash {s.hash.slice(0, 24)}…</div>
              </>
            ) : <div className="text-sm text-gray-400">Pendente</div>}
          </div>
        ))}
      </div>

      {precisaTermo && (
        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2.5 mb-3 text-xs text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>Antes de assinar o espelho é preciso aceitar o <b>termo de adesão à assinatura eletrônica</b> — é ele que dá validade jurídica à assinatura (MP 2.200-2/2001, art. 10 §2º).</div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {precisaTermo && (
          <button onClick={() => setModal('termo')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-gray-900 text-[#fff] hover:bg-gray-800 transition">
            <FileSignature className="w-4 h-4" /> Ler e aceitar o termo
          </button>
        )}
        {!minha && !precisaTermo && (
          <button onClick={() => setModal('assinar')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition">
            <ShieldCheck className="w-4 h-4" /> {papel === 'empresa' ? 'Contra-assinar' : 'Conferi e assino'}
          </button>
        )}
        {papel === 'empresa' && (daColab || daEmpresa) && (
          <button onClick={() => setModal('reabrir')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
            <Unlock className="w-4 h-4" /> Reabrir ciclo
          </button>
        )}
      </div>

      {!!a?.historico.length && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
          {a.historico.map((h, i) => (
            <div key={i} className="text-[11px] text-gray-400">
              Assinatura de {h.papel} em {dt(h.assinado_em)} — <b>invalidada</b> em {dt(h.invalidada_em)}{h.motivo && `: ${h.motivo}`}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => { if (e.target === e.currentTarget) fechar() }}>
          <div className="modal-card w-full max-w-lg max-h-[90vh] overflow-hidden bg-white rounded-2xl shadow-xl border border-gray-200 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">
                {modal === 'termo' ? 'Termo de adesão à assinatura eletrônica'
                  : modal === 'assinar' ? 'Assinar o espelho de ponto' : 'Reabrir o ciclo'}
              </h3>
              <button onClick={fechar} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
              {modal === 'termo' && (
                <pre className="whitespace-pre-wrap text-xs text-gray-600 bg-gray-50 rounded-xl p-4 leading-relaxed font-sans">{TERMO_TEXTO}</pre>
              )}
              {modal === 'assinar' && (
                <p className="text-sm text-gray-600">
                  {papel === 'empresa'
                    ? 'Você contra-assina o espelho como empresa. Após assinado, o período fica travado para edição.'
                    : 'Ao assinar, você confirma que conferiu os registros do período e que eles refletem sua jornada. O período fica travado para edição.'}
                </p>
              )}
              {modal === 'reabrir' && (
                <>
                  <p className="text-sm text-gray-600">A assinatura será <b>invalidada</b> (fica no histórico, não é apagada) e o período volta a aceitar edição.</p>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Motivo da reabertura *</label>
                    <input value={motivo} onChange={e => setMotivo(e.target.value)} className={inputCls} placeholder="ex.: atestado entregue depois do fechamento" />
                  </div>
                </>
              )}

              {modal !== 'reabrir' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Confirme sua senha *</label>
                    <input type="password" value={senha} onChange={e => setSenha(e.target.value)} className={inputCls} autoComplete="current-password" placeholder="sua senha do Flow" />
                  </div>
                  {precisaCodigo && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Código do e-mail pessoal *</label>
                      <div className="flex gap-2">
                        <input value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          className={`${inputCls} font-mono tracking-widest`} inputMode="numeric" placeholder="000000" />
                        <button type="button" onClick={() => pedirCodigo(modal === 'termo' ? 'assinar_termo' : 'assinar_espelho')} disabled={pending}
                          className="px-3 py-2 text-xs font-medium rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition whitespace-nowrap disabled:opacity-50">
                          {enviadoPara ? 'Reenviar' : 'Enviar código'}
                        </button>
                      </div>
                      {enviadoPara && <p className="text-[11px] text-emerald-700 mt-1.5">Código enviado para {enviadoPara} — vale 10 minutos.</p>}
                    </div>
                  )}
                  <p className="text-[11px] text-gray-400">
                    {precisaCodigo
                      ? 'Senha + código no seu e-mail pessoal. O e-mail é pessoal de propósito: o corporativo é administrado pela empresa, então não serviria como segunda prova de que foi você.'
                      : 'A senha confirma que é você — só estar logado não basta.'}
                    {' '}Ficam registrados data/hora do servidor, seu IP e um hash do conteúdo assinado.
                  </p>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={fechar} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition">Cancelar</button>
              <button onClick={modal === 'termo' ? assinarT : modal === 'assinar' ? assinarE : reabrir} disabled={pending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {modal === 'termo' ? 'Li e aceito' : modal === 'assinar' ? 'Assinar' : 'Reabrir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
