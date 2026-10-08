'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  UserPlus, Plus, Loader2, Check, Copy, ExternalLink, Mail, Send, Ban, Eraser, Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatBRL, parseMoney } from '@/lib/midia'
import { nomeLegivel } from '@/lib/nomes'
import {
  montarCarta, urlProposta, horasSemanais, STATUS_ADMISSAO,
  type BeneficiosProposta, type JornadaProposta,
} from '@/lib/admissao'
import { salvarProposta, enviarProposta, cancelarProcesso, limparDadosProcesso } from '@/app/actions/rh-admissao'

export interface AdmissaoRow {
  id: string; nome: string; email: string | null; telefone: string | null
  cargo: string | null; tipo_vinculo: string | null; salario: string | null
  data_inicio: string | null; data_primeiro_pagamento: string | null
  local_trabalho: string | null
  jornada: JornadaProposta | null; beneficios: BeneficiosProposta | null
  carta: string | null; token: string | null; expira_em: string | null
  enviada_em: string | null; aberta_em: string | null
  aceita_em: string | null; recusada_em: string | null; recusa_motivo: string | null
  ficha_em: string | null; exame_em: string | null; exame_local: string | null
  status: string; observacao: string | null; dados_limpos_em: string | null
  created_at: string
}
export interface ConfigAdmissao {
  exame_local?: string | null
  exame_horarios?: string | null
  beneficios_padrao?: BeneficiosProposta
  endereco?: string | null
}

const VINCULOS = [
  { value: 'clt', label: 'CLT' }, { value: 'estagio', label: 'Estágio' },
  { value: 'pj', label: 'PJ' }, { value: 'outro', label: 'Outro' },
]
const dataBR = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '')
const dataHoraBR = (d?: string | null) => (d
  ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '')
const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'
const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1'

export function ContratacoesClient({ orgSlug, agencia, lista, config, jornadaPadrao, hoje }: {
  orgSlug: string; agencia: string; lista: AdmissaoRow[]; config: ConfigAdmissao
  jornadaPadrao: JornadaProposta | null; hoje: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editando, setEditando] = useState<AdmissaoRow | 'novo' | null>(null)
  const [cancelar, setCancelar] = useState<AdmissaoRow | null>(null)
  const [limpar, setLimpar] = useState<AdmissaoRow | null>(null)

  const abertas = useMemo(() => lista.filter(a => !['efetivada', 'cancelada', 'recusada'].includes(a.status)), [lista])
  const fechadas = useMemo(() => lista.filter(a => ['efetivada', 'cancelada', 'recusada'].includes(a.status)), [lista])

  function copiar(a: AdmissaoRow) {
    if (!a.token) return
    navigator.clipboard.writeText(urlProposta(a.token))
      .then(() => toast.success('Link copiado.'))
      .catch(() => toast.error('Não consegui copiar — abra o link e copie da barra.'))
  }
  function reenviar(a: AdmissaoRow) {
    start(async () => {
      const r = await enviarProposta(orgSlug, a.id)
      if (r?.error) { toast.error(r.error); return }
      toast.success(r.enviado ? `E-mail reenviado para ${a.email}.` : 'Link pronto — copie e mande por WhatsApp.')
      router.refresh()
    })
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-orange-600" /> Contratações
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Proposta, aceite e ficha de admissão — até a pessoa virar ficha no RH.
          </p>
        </div>
        <button onClick={() => setEditando('novo')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 active:scale-[0.97] transition-colors shrink-0">
          <Plus className="w-4 h-4" /> Nova proposta
        </button>
      </div>

      {lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 px-5 py-12 text-center">
          <p className="text-sm text-gray-600">Nenhuma contratação em andamento.</p>
          <p className="text-xs text-gray-400 mt-1">
            A proposta vira um link para o candidato aceitar; daí sai a ficha de admissão e o cadastro no RH.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <Secao titulo="Em andamento" itens={abertas} vazio="Nada em andamento."
            orgSlug={orgSlug} pending={pending} hoje={hoje}
            onAbrir={setEditando} onCopiar={copiar} onReenviar={reenviar}
            onCancelar={setCancelar} onLimpar={setLimpar} />
          {fechadas.length > 0 && (
            <Secao titulo="Encerradas" itens={fechadas} vazio=""
              orgSlug={orgSlug} pending={pending} hoje={hoje}
              onAbrir={setEditando} onCopiar={copiar} onReenviar={reenviar}
              onCancelar={setCancelar} onLimpar={setLimpar} />
          )}
        </div>
      )}

      {editando && (
        <PropostaModal orgSlug={orgSlug} agencia={agencia} config={config} jornadaPadrao={jornadaPadrao}
          atual={editando === 'novo' ? null : editando}
          onClose={() => setEditando(null)} />
      )}

      <ConfirmDialog
        open={!!cancelar} loading={pending}
        title="Cancelar processo"
        description={cancelar ? `O link de ${nomeLegivel(cancelar.nome)} para de funcionar na hora. O histórico do processo fica guardado.` : ''}
        confirmLabel="Cancelar processo"
        onConfirm={() => {
          const a = cancelar; setCancelar(null)
          if (!a) return
          start(async () => {
            const r = await cancelarProcesso(orgSlug, a.id)
            if (r?.error) toast.error(r.error)
            else { toast.success('Processo cancelado.'); router.refresh() }
          })
        }}
        onCancel={() => setCancelar(null)} />

      <ConfirmDialog
        open={!!limpar} loading={pending}
        title="Apagar os dados pessoais"
        description={limpar
          ? `Apaga a ficha preenchida, os anexos, o e-mail e o telefone de ${nomeLegivel(limpar.nome)}. `
            + 'Fica só o registro de que o processo existiu. Não dá para desfazer.'
          : ''}
        confirmLabel="Apagar dados"
        onConfirm={() => {
          const a = limpar; setLimpar(null)
          if (!a) return
          start(async () => {
            const r = await limparDadosProcesso(orgSlug, a.id)
            if (r?.error) toast.error(r.error)
            else { toast.success('Dados pessoais apagados.'); router.refresh() }
          })
        }}
        onCancel={() => setLimpar(null)} />
    </div>
  )
}

function Secao({ titulo, itens, vazio, pending, hoje, onAbrir, onCopiar, onReenviar, onCancelar, onLimpar }: {
  titulo: string; itens: AdmissaoRow[]; vazio: string; orgSlug: string; pending: boolean; hoje: string
  onAbrir: (a: AdmissaoRow) => void; onCopiar: (a: AdmissaoRow) => void; onReenviar: (a: AdmissaoRow) => void
  onCancelar: (a: AdmissaoRow) => void; onLimpar: (a: AdmissaoRow) => void
}) {
  if (!itens.length && !vazio) return null
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-700 mb-2">{titulo} <span className="text-gray-400">{itens.length}</span></h2>
      {itens.length === 0 ? (
        <p className="text-sm text-gray-400">{vazio}</p>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-50">
          {itens.map(a => {
            const st = STATUS_ADMISSAO[a.status] ?? STATUS_ADMISSAO.rascunho
            const vencida = !!a.expira_em && !a.aceita_em && !a.recusada_em && hoje > a.expira_em
            return (
              <div key={a.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button onClick={() => onAbrir(a)}
                    className="font-medium text-gray-900 hover:text-orange-600 transition-colors">
                    {nomeLegivel(a.nome)}
                  </button>
                  {a.cargo && <span className="text-sm text-gray-500">· {a.cargo}</span>}
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${vencida ? 'bg-gray-100 text-gray-500' : st.cls}`}>
                    {vencida ? 'Prazo vencido' : st.label}
                  </span>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1">
                    {a.token && (
                      <>
                        <button onClick={() => onCopiar(a)} title="Copiar o link do candidato"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-500/10 transition-colors">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <a href={urlProposta(a.token)} target="_blank" rel="noopener noreferrer" title="Abrir como o candidato vê"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-500/10 transition-colors">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </>
                    )}
                    {!a.aceita_em && !a.recusada_em && a.status !== 'cancelada' && (
                      <button onClick={() => onReenviar(a)} disabled={pending} title={a.email ? `Reenviar para ${a.email}` : 'Gerar o link'}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-500/10 transition-colors disabled:opacity-50">
                        {a.enviada_em ? <Mail className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    {a.status !== 'cancelada' && a.status !== 'efetivada' && (
                      <button onClick={() => onCancelar(a)} disabled={pending} title="Cancelar processo"
                        className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50">
                        <Ban className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {!a.dados_limpos_em && (a.status === 'cancelada' || a.status === 'recusada') && (
                      <button onClick={() => onLimpar(a)} disabled={pending} title="Apagar os dados pessoais (LGPD)"
                        className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50">
                        <Eraser className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-[11px] text-gray-400 mt-1 flex flex-wrap gap-x-3 tabular-nums">
                  {a.salario && <span>{formatBRL(Number(a.salario))}</span>}
                  {a.data_inicio && <span>início {dataBR(a.data_inicio)}</span>}
                  {a.enviada_em && !a.aceita_em && !a.recusada_em && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" /> enviada {dataHoraBR(a.enviada_em)}
                      {a.aberta_em ? ' · abriu o link' : ' · ainda não abriu'}
                      {a.expira_em && ` · vale até ${dataBR(a.expira_em)}`}
                    </span>
                  )}
                  {a.aceita_em && <span className="text-emerald-700">aceita em {dataHoraBR(a.aceita_em)}</span>}
                  {a.recusada_em && <span>recusou em {dataHoraBR(a.recusada_em)}{a.recusa_motivo ? ` — “${a.recusa_motivo}”` : ''}</span>}
                  {a.dados_limpos_em && <span>dados apagados em {dataHoraBR(a.dados_limpos_em)}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** Proposta: os campos de cima montam a carta; a carta é o que o candidato lê. */
function PropostaModal({ orgSlug, agencia, config, jornadaPadrao, atual, onClose }: {
  orgSlug: string; agencia: string; config: ConfigAdmissao; jornadaPadrao: JornadaProposta | null
  atual: AdmissaoRow | null; onClose: () => void
}) {
  const router = useRouter()
  const [saving, start] = useTransition()
  const padraoBen = config.beneficios_padrao ?? {}
  const respondida = !!(atual?.aceita_em || atual?.recusada_em)

  const [f, setF] = useState(() => ({
    nome: atual?.nome ?? '',
    email: atual?.email ?? '',
    telefone: atual?.telefone ?? '',
    cargo: atual?.cargo ?? '',
    tipo_vinculo: atual?.tipo_vinculo ?? 'clt',
    salario: atual?.salario ? formatBRL(Number(atual.salario)).replace('R$', '').trim() : '',
    data_inicio: atual?.data_inicio ?? '',
    data_primeiro_pagamento: atual?.data_primeiro_pagamento ?? '',
    local_trabalho: atual?.local_trabalho ?? config.endereco ?? '',
    exame_em: atual?.exame_em ? atual.exame_em.slice(0, 16) : '',
    exame_local: atual?.exame_local ?? config.exame_local ?? '',
  }))
  const [j, setJ] = useState<JornadaProposta>(() => atual?.jornada && Object.keys(atual.jornada).length
    ? atual.jornada
    : {
        entrada: jornadaPadrao?.entrada?.slice(0, 5) ?? '08:30',
        intervalo_ini: jornadaPadrao?.intervalo_ini?.slice(0, 5) ?? '12:00',
        intervalo_fim: jornadaPadrao?.intervalo_fim?.slice(0, 5) ?? '13:30',
        saida: jornadaPadrao?.saida?.slice(0, 5) ?? '18:00',
        dias_semana: jornadaPadrao?.dias_semana ?? [1, 2, 3, 4, 5],
      })
  const [b, setB] = useState<BeneficiosProposta>(() => atual?.beneficios && Object.keys(atual.beneficios).length
    ? atual.beneficios : padraoBen)
  const [carta, setCarta] = useState(atual?.carta ?? '')
  const [cartaEditada, setCartaEditada] = useState(!!atual?.carta)
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }))

  // Enquanto ninguém mexeu no texto, a carta acompanha os campos. Depois da
  // primeira edição à mão ela para de ser regenerada — a palavra é do RH.
  const dados = {
    nome: f.nome || 'candidato(a)', cargo: f.cargo, salario: parseMoney(f.salario),
    data_inicio: f.data_inicio || null, data_primeiro_pagamento: f.data_primeiro_pagamento || null,
    local_trabalho: f.local_trabalho || null, jornada: j, beneficios: b,
  }
  const cartaAuto = useMemo(() => montarCarta(dados, agencia),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agencia, f.nome, f.cargo, f.salario, f.data_inicio, f.data_primeiro_pagamento, f.local_trabalho, j, b])
  const cartaFinal = cartaEditada ? carta : cartaAuto

  function gravar(enviar: boolean) {
    if (!f.nome.trim()) { toast.error('Informe o nome do candidato.'); return }
    if (enviar && !f.cargo.trim()) { toast.error('Informe o cargo — ele aparece na carta.'); return }
    start(async () => {
      const r = await salvarProposta(orgSlug, atual?.id ?? null, {
        nome: f.nome.trim(), email: f.email.trim() || null, telefone: f.telefone.trim() || null,
        cargo: f.cargo.trim() || null, tipo_vinculo: f.tipo_vinculo,
        salario: parseMoney(f.salario) != null ? String(parseMoney(f.salario)) : null,
        data_inicio: f.data_inicio || null, data_primeiro_pagamento: f.data_primeiro_pagamento || null,
        local_trabalho: f.local_trabalho.trim() || null,
        jornada: { ...j, horas_semanais: horasSemanais(j) },
        beneficios: b,
        carta: cartaFinal,
        exame_em: f.exame_em || null, exame_local: f.exame_local.trim() || null,
      })
      if (r?.error) { toast.error(r.error); return }
      if (!enviar) { toast.success('Rascunho salvo.'); onClose(); router.refresh(); return }

      const env = await enviarProposta(orgSlug, r.id!)
      if (env?.error) { toast.error(env.error); return }
      await navigator.clipboard.writeText(env.url!).catch(() => {})
      toast.success(env.enviado ? 'Proposta enviada por e-mail — link copiado.' : 'Link gerado e copiado.', {
        description: env.enviado ? undefined : 'Cole no WhatsApp para mandar ao candidato.',
        duration: 8000,
      })
      onClose(); router.refresh()
    })
  }

  return (
    <Modal open onClose={onClose} label="Proposta de trabalho" dismissable={!saving} dismissOnBackdrop={false}>
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <UserPlus className="w-4.5 h-4.5 text-orange-600" /> {atual ? 'Proposta' : 'Nova proposta'}
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {respondida
            ? 'Já respondida — os campos ficam como registro do que foi combinado.'
            : 'Os campos montam a carta; o texto abaixo é o que o candidato lê.'}
        </p>
      </div>

      <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={labelCls}>Nome do candidato *</label>
            <input value={f.nome} onChange={e => set('nome', e.target.value)} className={inputCls} placeholder="Nome completo" />
          </div>
          <div>
            <label className={labelCls}>E-mail <span className="font-normal text-gray-400">(manda a proposta)</span></label>
            <input type="email" value={f.email} onChange={e => set('email', e.target.value)} className={inputCls} placeholder="nome@email.com" />
          </div>
          <div>
            <label className={labelCls}>Celular</label>
            <input value={f.telefone} onChange={e => set('telefone', e.target.value)} className={inputCls} placeholder="(45) 9 9999-9999" />
          </div>
          <div>
            <label className={labelCls}>Cargo</label>
            <input value={f.cargo} onChange={e => set('cargo', e.target.value)} className={inputCls} placeholder="Diretor de Arte" />
          </div>
          <div>
            <label className={labelCls}>Vínculo</label>
            <Select value={f.tipo_vinculo} onChange={v => set('tipo_vinculo', v)} options={VINCULOS} />
          </div>
          <div>
            <label className={labelCls}>Salário</label>
            <input inputMode="decimal" value={f.salario} onChange={e => set('salario', e.target.value)} className={inputCls} placeholder="0,00" />
          </div>
          <div>
            <label className={labelCls}>Início</label>
            <input type="date" value={f.data_inicio} onChange={e => set('data_inicio', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>1º pagamento</label>
            <input type="date" value={f.data_primeiro_pagamento} onChange={e => set('data_primeiro_pagamento', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Exame admissional</label>
            <input type="datetime-local" value={f.exame_em} onChange={e => set('exame_em', e.target.value)} className={inputCls} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Local de trabalho</label>
            <input value={f.local_trabalho} onChange={e => set('local_trabalho', e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="rounded-xl bg-gray-50 p-3">
          <p className="text-[11px] font-medium text-gray-500 mb-2">Jornada — dá {horasSemanais(j)}h semanais</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {([['Entrada', 'entrada'], ['Saída almoço', 'intervalo_ini'], ['Volta', 'intervalo_fim'], ['Saída', 'saida']] as const).map(([lb, k]) => (
              <div key={k}>
                <label className={labelCls}>{lb}</label>
                <input type="time" value={(j[k] as string) ?? ''} onChange={e => setJ(p => ({ ...p, [k]: e.target.value }))}
                  className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900" />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-gray-50 p-3 space-y-3">
          <p className="text-[11px] font-medium text-gray-500">Benefícios</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Vale-alimentação por dia</label>
              <input inputMode="decimal" value={b.va_dia ?? ''} onChange={e => setB(p => ({ ...p, va_dia: Number(e.target.value) || undefined }))}
                className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900" placeholder="34" />
            </div>
            <div>
              <label className={labelCls}>Desconto do VA em folha (%)</label>
              <input inputMode="numeric" value={b.va_desconto_pct ?? ''} onChange={e => setB(p => ({ ...p, va_desconto_pct: Number(e.target.value) || undefined }))}
                className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900" placeholder="20" />
            </div>
            <div className="col-span-2 flex items-center justify-between gap-3">
              <span className="text-sm text-gray-700">Oferece vale-transporte</span>
              <div className="flex items-center gap-2">
                {b.vt && (
                  <input inputMode="numeric" value={b.vt_desconto_pct ?? ''} onChange={e => setB(p => ({ ...p, vt_desconto_pct: Number(e.target.value) || undefined }))}
                    className="w-20 px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900" placeholder="% desc." />
                )}
                <Switch checked={!!b.vt} onChange={v => setB(p => ({ ...p, vt: v }))} label="Oferece vale-transporte" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Ajuda de custo</label>
              <input inputMode="decimal" value={b.ajuda_custo ?? ''} onChange={e => setB(p => ({ ...p, ajuda_custo: Number(e.target.value) || undefined }))}
                className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900" placeholder="150" />
            </div>
            <div>
              <label className={labelCls}>Para quê</label>
              <input value={b.ajuda_custo_nome ?? ''} onChange={e => setB(p => ({ ...p, ajuda_custo_nome: e.target.value || undefined }))}
                className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900" placeholder="pacote Adobe" />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Outros benefícios <span className="font-normal text-gray-400">(um por linha)</span></label>
              <textarea value={(b.extras ?? []).join('\n')} rows={2}
                onChange={e => setB(p => ({ ...p, extras: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }))}
                className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900"
                placeholder="happy hour especial na última sexta-feira de cada mês" />
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={labelCls}>A carta, como o candidato vai ler</label>
            {cartaEditada && (
              <button onClick={() => { setCartaEditada(false); setCarta('') }}
                className="text-[11px] text-gray-400 hover:text-orange-600 transition-colors">
                Refazer a partir dos campos
              </button>
            )}
          </div>
          <textarea value={cartaFinal} rows={12} readOnly={respondida}
            onChange={e => { setCartaEditada(true); setCarta(e.target.value) }}
            className={`${inputCls} leading-relaxed ${respondida ? 'opacity-70' : ''}`} />
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 px-6 py-4 border-t border-gray-100">
        <button onClick={onClose} disabled={saving}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">Fechar</button>
        {!respondida && (
          <>
            <button onClick={() => gravar(false)} disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-100 active:scale-[0.97] transition-colors disabled:opacity-50">
              Salvar rascunho
            </button>
            <button onClick={() => gravar(true)} disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 active:scale-[0.97] transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {atual?.token ? 'Salvar e reenviar' : 'Gerar link e enviar'}
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
