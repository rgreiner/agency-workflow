'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowRight, CalendarClock, Check, ExternalLink, Link2, Loader2, Plus,
  RotateCcw, Trash2, Truck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/Select'
import { Combobox } from '@/components/ui/Combobox'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import {
  salvarEntrega, mudarSituacaoEntrega, excluirEntrega, tarefasDoCliente,
} from '@/app/actions/midia-hub'

export interface EntregaRow {
  id: string
  titulo: string
  cliente: string
  workspaceId: string
  campanha: string | null
  campaignId: string | null
  veiculo: string | null
  /** Veículo do cadastro (mig. 278); null nas entregas antigas só com texto. */
  veiculoId: string | null
  veiculoContato: string | null
  formato: string | null
  prazoEnvio: string | null
  situacao: 'aguardando' | 'liberado' | 'cancelado'
  observacao: string | null
  tarefa: {
    id: string; titulo: string; status: string | null; prazo: string | null
    arquivada: boolean; campaignId: string | null; workspaceId: string | null
    materialPronto: boolean
    previewUrl: string | null; finalUrl: string | null; pastaUrl: string | null
  } | null
  conflitoPrazo: boolean
}

interface StatusCfg { valor: string; label: string; bg: string; txt: string }

/** Veículo do cadastro, com o contato já em uma linha (e-mail · telefone). */
export interface VeiculoOpt { id: string; nome: string; contato: string | null }

/** Sentinela: entrega antiga cujo veículo é só texto, fora do cadastro. */
const VEICULO_TEXTO = '__texto__'

const hojeBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const fmt = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—')

function diasAte(prazo: string | null): number | null {
  if (!prazo) return null
  return Math.round(
    (new Date(prazo.slice(0, 10) + 'T12:00:00').getTime() - new Date(hojeBR() + 'T12:00:00').getTime()) / 86400000)
}

/**
 * Sentinela do select "Tarefa da criação". O vazio ('') já significava "material
 * pronto, não passa pela criação" — usar o mesmo vazio pra "ainda não tem tarefa"
 * deixava os dois casos indistinguíveis, e por isso a entrega nunca chegava no
 * atendimento. Este valor separa os dois e é o que dispara a criação do briefing.
 */
const NOVA_TAREFA = '__briefing__'

// Última campanha usada por cliente — a mídia repete o mesmo projeto o tempo todo.
const LS_CAMPANHA = 'flow:midia:entrega:campanha:v1'

function lerMapaCampanha(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_CAMPANHA) ?? '{}') as Record<string, string> }
  catch { return {} }
}
function lembrarCampanha(workspaceId: string, campaignId: string) {
  try {
    localStorage.setItem(LS_CAMPANHA, JSON.stringify({ ...lerMapaCampanha(), [workspaceId]: campaignId }))
  } catch { /* storage indisponível (aba anônima) — só perde a memória */ }
}

type Filtro = 'pendentes' | 'liberadas' | 'todas'

// A situação no banco continua 'liberado'; no texto o gesto é "enviei ao veículo".
const ROTULO_FILTRO: Record<Filtro, string> = {
  pendentes: 'pendentes', liberadas: 'enviadas', todas: 'todas',
}

export function EntregasMidia({ orgSlug, entregas, clientes, veiculos, statusCfg }: {
  orgSlug: string
  entregas: EntregaRow[]
  clientes: { id: string; nome: string }[]
  veiculos: VeiculoOpt[]
  statusCfg: StatusCfg[]
}) {
  const [filtro, setFiltro] = useState<Filtro>('pendentes')
  const [cliente, setCliente] = useState('')
  const [editando, setEditando] = useState<EntregaRow | 'nova' | null>(null)
  const cfg = useMemo(() => new Map(statusCfg.map(s => [s.valor, s])), [statusCfg])

  const lista = useMemo(() => {
    let l = entregas
    if (filtro === 'pendentes') l = l.filter(e => e.situacao === 'aguardando')
    if (filtro === 'liberadas') l = l.filter(e => e.situacao === 'liberado')
    if (cliente) l = l.filter(e => e.workspaceId === cliente)
    return l
  }, [entregas, filtro, cliente])

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Entregas</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Cadastro do que a mídia precisa enviar: nova, editar, histórico. O prazo daqui é o do veículo —
            o da tarefa continua sendo da criação. Para tocar o dia, use{' '}
            <Link href={`/${orgSlug}/midia`} className="text-orange-600 hover:text-orange-700 inline-flex items-center gap-0.5">
              Trabalhar <ArrowRight className="w-3 h-3" />
            </Link>.
          </p>
        </div>
        <button onClick={() => setEditando('nova')}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors">
          <Plus className="w-4 h-4" /> Nova entrega
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-xl p-0.5">
          {(['pendentes', 'liberadas', 'todas'] as const).map(f => (
            <button key={f} onClick={() => setFiltro(f)} aria-pressed={filtro === f}
              className={cn('px-3.5 py-1.5 text-sm font-medium rounded-[10px] transition-colors capitalize',
                filtro === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
              {ROTULO_FILTRO[f]}
            </button>
          ))}
        </div>
        <div className="w-56">
          <Select value={cliente} onChange={setCliente}
            options={[{ value: '', label: 'Todos os clientes' }, ...clientes.map(c => ({ value: c.id, label: c.nome }))]} />
        </div>
      </div>

      {lista.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-16 bg-white border border-gray-200 rounded-xl">
          {filtro === 'pendentes' ? 'Nenhuma entrega pendente.' : 'Nada por aqui.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {lista.map(e => (
            <LinhaEntrega key={e.id} orgSlug={orgSlug} e={e} cfg={cfg} onEditar={() => setEditando(e)} />
          ))}
        </ul>
      )}

      {editando && (
        <ModalEntrega orgSlug={orgSlug} clientes={clientes} veiculos={veiculos}
          entrega={editando === 'nova' ? null : editando}
          onClose={() => setEditando(null)} />
      )}
    </div>
  )
}

function LinhaEntrega({ orgSlug, e, cfg, onEditar }: {
  orgSlug: string; e: EntregaRow; cfg: Map<string, StatusCfg>; onEditar: () => void
}) {
  const [pending, start] = useTransition()
  const dias = diasAte(e.prazoEnvio)
  const st = e.tarefa?.status ? cfg.get(e.tarefa.status) : null
  const liberada = e.situacao === 'liberado'

  // Aqui é cadastro: o "Enviei ao veículo" mora no Trabalhar. Reabrir fica,
  // porque a enviada só aparece nesta lista — e reabrir não desconclui a tarefa.
  function reabrir() {
    start(async () => {
      const r = await mudarSituacaoEntrega(orgSlug, e.id, 'aguardando')
      if (r?.error) { toast.error(r.error); return }
      toast.success('Entrega reaberta — a tarefa segue concluída.')
    })
  }

  return (
    <li className={cn('bg-white border rounded-xl p-4',
      liberada ? 'border-gray-100 opacity-70' : e.conflitoPrazo ? 'border-red-200' : 'border-gray-200')}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={onEditar} className="text-sm font-medium text-gray-900 hover:text-orange-600 transition-colors text-left">
              {e.titulo}
            </button>
            {e.veiculo && <span className="text-[11px] text-gray-500 inline-flex items-center gap-1"><Truck className="w-3 h-3" /> {e.veiculo}</span>}
            {e.veiculoContato && <span className="text-[11px] text-gray-500">{e.veiculoContato}</span>}
            {e.formato && <span className="text-[11px] text-gray-400">{e.formato}</span>}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {e.cliente}{e.campanha ? ` · ${e.campanha}` : ''}
          </p>

          {e.tarefa ? (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {e.tarefa.campaignId && e.tarefa.workspaceId ? (
                <Link href={`/${orgSlug}/workspaces/${e.tarefa.workspaceId}/campaigns/${e.tarefa.campaignId}/activities/${e.tarefa.id}?from=${encodeURIComponent(`/${orgSlug}/midia/entregas`)}`}
                  className="text-[12px] text-gray-600 hover:text-orange-600 transition-colors inline-flex items-center gap-1">
                  <Link2 className="w-3 h-3" /> {e.tarefa.titulo}
                </Link>
              ) : (
                <span className="text-[12px] text-gray-400 inline-flex items-center gap-1"><Link2 className="w-3 h-3" /> {e.tarefa.titulo}</span>
              )}
              {st && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: st.bg, color: st.txt }}>{st.label}</span>
              )}
              <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full',
                e.tarefa.materialPronto ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                {e.tarefa.materialPronto ? 'material pronto' : 'com a criação'}
              </span>
              <span className="text-[11px] text-gray-400">tarefa: {fmt(e.tarefa.prazo)}</span>
              {e.tarefa.finalUrl && <Atalho url={e.tarefa.finalUrl} label="Final" />}
              {e.tarefa.previewUrl && <Atalho url={e.tarefa.previewUrl} label="Preview" />}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-gray-400">Sem tarefa vinculada — material que não passa pela criação.</p>
          )}

          {e.observacao && <p className="mt-2 text-[12px] text-gray-500">{e.observacao}</p>}
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className={cn('text-[11px] font-medium px-2 py-1 rounded-lg inline-flex items-center gap-1',
            liberada ? 'bg-gray-100 text-gray-500'
              : dias == null ? 'bg-gray-100 text-gray-500'
              : dias < 0 ? 'bg-red-50 text-red-700'
              : dias === 0 ? 'bg-orange-50 text-orange-700'
              : dias <= 3 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600')}>
            <CalendarClock className="w-3 h-3" />
            {e.prazoEnvio ? `envio ${fmt(e.prazoEnvio)}` : 'sem prazo'}
            {!liberada && dias != null && dias < 0 && ' · vencido'}
            {!liberada && dias === 0 && ' · hoje'}
          </span>
          {liberada && (
            <button onClick={reabrir} disabled={pending}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-60">
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Reabrir
            </button>
          )}
        </div>
      </div>

      {e.conflitoPrazo && !liberada && (
        <p className="mt-2.5 text-[12px] text-red-700 bg-red-50 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          A tarefa vence {fmt(e.tarefa?.prazo ?? null)}, depois do envio ({fmt(e.prazoEnvio)}).
        </p>
      )}
    </li>
  )
}

function Atalho({ url, label }: { url: string; label: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-50 text-[11px] font-medium text-gray-600 hover:bg-orange-50 hover:text-orange-700 transition-colors">
      <ExternalLink className="w-3 h-3" /> {label}
    </a>
  )
}

function ModalEntrega({ orgSlug, clientes, veiculos, entrega, onClose }: {
  orgSlug: string
  clientes: { id: string; nome: string }[]
  veiculos: VeiculoOpt[]
  entrega: EntregaRow | null
  onClose: () => void
}) {
  const [pending, start] = useTransition()
  const [form, setForm] = useState({
    workspaceId: entrega?.workspaceId ?? '',
    titulo: entrega?.titulo ?? '',
    veiculo: entrega?.veiculo ?? '',
    // Entrega antiga só com texto entra como opção própria — trocar pelo cadastro é
    // um clique, mas ninguém é obrigado a recadastrar o que já estava salvo.
    veiculoId: entrega?.veiculoId ?? (entrega?.veiculo ? VEICULO_TEXTO : ''),
    formato: entrega?.formato ?? '',
    prazoEnvio: entrega?.prazoEnvio?.slice(0, 10) ?? '',
    activityId: entrega?.tarefa?.id ?? '',
    campaignId: entrega?.campaignId ?? '',
    observacao: entrega?.observacao ?? '',
  })
  const [tarefas, setTarefas] = useState<{ id: string; titulo: string; prazo: string | null; campanha: string; campaignId: string }[]>([])
  const [campanhas, setCampanhas] = useState<{ id: string; nome: string }[]>([])
  const [carregandoTarefas, setCarregandoTarefas] = useState(false)

  async function trocarCliente(id: string) {
    setForm(f => ({ ...f, workspaceId: id, activityId: '', campaignId: '' }))
    setTarefas([])
    setCampanhas([])
    if (!id) return
    setCarregandoTarefas(true)
    const r = await tarefasDoCliente(orgSlug, id)
    setCarregandoTarefas(false)
    if ('error' in r && r.error) { toast.error(r.error); return }
    setTarefas(r.tarefas ?? [])
    setCampanhas(r.campanhas ?? [])
  }

  const opcoesVeiculo = useMemo(() => {
    const base = veiculos.map(v => ({ value: v.id, label: v.nome }))
    return entrega?.veiculo && !entrega.veiculoId
      ? [{ value: VEICULO_TEXTO, label: `${entrega.veiculo} · texto antigo, fora do cadastro` }, ...base]
      : base
  }, [veiculos, entrega])
  const veiculoEscolhido = veiculos.find(v => v.id === form.veiculoId) ?? null

  function trocarVeiculo(id: string) {
    setForm(f => ({
      ...f,
      veiculoId: id,
      veiculo: id === VEICULO_TEXTO ? (entrega?.veiculo ?? '') : (veiculos.find(v => v.id === id)?.nome ?? ''),
    }))
  }

  // Espelha tituloDaTarefa() do servidor: DATA - VEÍCULO - FORMATO - JOB, sem
  // deduplicar nada. Mostrar aqui evita a surpresa de descobrir o nome depois.
  const nomeTarefa = useMemo(() => {
    const d = hojeBR()
    const data = `${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}`
    return [data, form.veiculo, form.formato, form.titulo]
      .map(x => x.trim()).filter(Boolean).join(' - ')
  }, [form.veiculo, form.formato, form.titulo])

  // Projeto sugerido: o último usado neste cliente, se ainda existir.
  function sugerirCampanha(): string {
    if (form.campaignId) return form.campaignId
    const ultima = lerMapaCampanha()[form.workspaceId]
    return ultima && campanhas.some(c => c.id === ultima) ? ultima : ''
  }

  // Ao abrir para editar, já traz as tarefas do cliente para poder trocar o vínculo.
  const [iniciado, setIniciado] = useState(false)
  if (!iniciado && entrega?.workspaceId) {
    setIniciado(true)
    void trocarCliente(entrega.workspaceId).then(() =>
      setForm(f => ({ ...f, activityId: entrega.tarefa?.id ?? '', campaignId: entrega.campaignId ?? '' })))
  }

  function salvar() {
    if (!form.workspaceId) { toast.error('Escolha o cliente.'); return }
    if (!form.titulo.trim()) { toast.error('Dê um nome à entrega.'); return }
    const abrindoBriefing = form.activityId === NOVA_TAREFA
    if (abrindoBriefing && !form.campaignId) {
      toast.error('Escolha o projeto onde a tarefa vai nascer.'); return
    }
    if (abrindoBriefing && !form.prazoEnvio) {
      toast.error('Informe o prazo de envio — é dele que sai o prazo da tarefa.'); return
    }
    start(async () => {
      const tarefa = tarefas.find(t => t.id === form.activityId)
      const r = await salvarEntrega(orgSlug, {
        id: entrega?.id ?? null,
        workspaceId: form.workspaceId,
        titulo: form.titulo,
        veiculo: form.veiculo,
        veiculoId: form.veiculoId && form.veiculoId !== VEICULO_TEXTO ? form.veiculoId : null,
        formato: form.formato,
        prazoEnvio: form.prazoEnvio || null,
        activityId: abrindoBriefing ? null : (form.activityId || null),
        // A campanha vem da tarefa quando há vínculo — evita escolher duas vezes.
        campaignId: tarefa?.campaignId ?? form.campaignId ?? null,
        observacao: form.observacao,
        briefingEmCampanha: abrindoBriefing ? form.campaignId : null,
      })
      if ('error' in r) { toast.error(r.error); return }
      if (abrindoBriefing) {
        lembrarCampanha(form.workspaceId, form.campaignId)
        if (r.briefingErro) toast.warning(`Entrega salva, mas o briefing não abriu: ${r.briefingErro}`)
        else toast.success('Entrega salva e briefing aberto para o atendimento.')
      } else {
        toast.success(entrega ? 'Entrega atualizada.' : 'Entrega criada.')
      }
      onClose()
    })
  }

  function excluir() {
    if (!entrega) return
    start(async () => {
      const r = await excluirEntrega(orgSlug, entrega.id)
      if (r?.error) { toast.error(r.error); return }
      toast.success('Entrega excluída.')
      onClose()
    })
  }

  const campo = 'w-full mt-0.5 bg-gray-100 border border-transparent rounded-xl px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:bg-white focus:border-orange-300 focus:outline-none transition-colors'

  return (
    <Modal open onClose={onClose} size="xl" label={entrega ? 'Editar entrega' : 'Nova entrega'}
      dismissOnBackdrop={false} dismissable={!pending}>
      <ModalHeader title={entrega ? 'Editar entrega' : 'Nova entrega'} onClose={onClose} />
      <div className="space-y-3 px-6 py-5">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] text-gray-400">Cliente</span>
            <div className="mt-0.5">
              <Select value={form.workspaceId} onChange={trocarCliente}
                options={clientes.map(c => ({ value: c.id, label: c.nome }))} placeholder="Escolha o cliente" />
            </div>
          </label>
          <label className="block">
            <span className="text-[11px] text-gray-400">Prazo de envio ao veículo</span>
            <input type="date" value={form.prazoEnvio}
              onChange={e => setForm(f => ({ ...f, prazoEnvio: e.target.value }))} className={campo} />
          </label>
        </div>

        <label className="block">
          <span className="text-[11px] text-gray-400">O que é a entrega</span>
          <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
            placeholder="Anúncio 1/2 página — Revista Rural" className={campo} />
        </label>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="block">
            <span className="text-[11px] text-gray-400">Veículo</span>
            <div className="mt-0.5">
              <Combobox value={form.veiculoId} onChange={trocarVeiculo} options={opcoesVeiculo}
                minChars={2} placeholder="Digite o nome do veículo" />
            </div>
            {veiculoEscolhido ? (
              <span className="text-[11px] text-gray-500 mt-1 block">
                {veiculoEscolhido.contato ?? 'Sem e-mail nem telefone no cadastro.'}
              </span>
            ) : (
              <a href={`/${orgSlug}/cadastros/veiculos`} target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-gray-400 hover:text-orange-600 transition-colors mt-1 inline-flex items-center gap-1">
                Não está na lista? Cadastrar veículo <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <label className="block">
            <span className="text-[11px] text-gray-400">Especificação</span>
            <input value={form.formato} onChange={e => setForm(f => ({ ...f, formato: e.target.value }))}
              placeholder="21×14cm · CMYK · PDF/X-1a" className={campo} />
          </label>
        </div>

        <label className="block">
          <span className="text-[11px] text-gray-400">
            Tarefa da criação {carregandoTarefas && <span className="text-gray-300">· carregando…</span>}
          </span>
          <div className="mt-0.5">
            <Select
              value={form.activityId}
              onChange={v => setForm(f => ({
                ...f,
                activityId: v,
                // Ao escolher "precisa de criação", já sugere o último projeto usado.
                campaignId: v === NOVA_TAREFA ? sugerirCampanha() : f.campaignId,
              }))}
              options={[
                { value: NOVA_TAREFA, label: 'Precisa de criação — abrir briefing' },
                { value: '', label: 'Material pronto — não passa pela criação' },
                ...tarefas.map(t => ({ value: t.id, label: `${t.titulo}${t.prazo ? ` · ${fmt(t.prazo)}` : ''}` })),
              ]}
              placeholder={form.workspaceId ? 'Vincular a uma tarefa' : 'Escolha o cliente primeiro'} />
          </div>
          {form.activityId !== NOVA_TAREFA && (
            <span className="text-[11px] text-gray-400 mt-1 block">
              O prazo da tarefa continua sendo o da criação. Se ele passar do envio, a entrega avisa.
            </span>
          )}
        </label>

        {form.activityId === NOVA_TAREFA && (
          <div className="rounded-xl bg-orange-50 border border-orange-100 p-3 space-y-2">
            <label className="block">
              <span className="text-[11px] text-orange-800">Projeto onde a tarefa vai nascer</span>
              <div className="mt-0.5">
                <Select value={form.campaignId} onChange={v => setForm(f => ({ ...f, campaignId: v }))}
                  options={campanhas.map(c => ({ value: c.id, label: c.nome }))}
                  placeholder={campanhas.length ? 'Escolha o projeto' : 'Este cliente não tem projeto ativo'} />
              </div>
            </label>
            <p className="text-[11px] text-orange-800/80">
              A tarefa nasce em <b>Briefing</b>, <b>sem responsável</b> — cai na fila &ldquo;Sem responsável&rdquo;
              do atendimento — com prazo {form.prazoEnvio ? fmt(form.prazoEnvio) : 'igual ao do envio'} e a pasta
              do Drive já criada com o mesmo nome. O briefing nasce em branco, para o atendimento escrever.
            </p>
            <p className="text-[11px] text-orange-800/70">
              Nome da tarefa: <span className="font-mono text-orange-900">{nomeTarefa}</span>
            </p>
          </div>
        )}

        <label className="block">
          <span className="text-[11px] text-gray-400">Observação</span>
          <input value={form.observacao} onChange={e => setForm(f => ({ ...f, observacao: e.target.value }))}
            placeholder="ex.: enviar por e-mail para comercial@veiculo.com.br" className={campo} />
        </label>

        <div className="flex items-center justify-between gap-2 pt-1">
          {entrega ? (
            <button onClick={excluir} disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60">
              <Trash2 className="w-4 h-4" /> Excluir
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3.5 py-2 text-sm font-medium rounded-xl text-gray-600 hover:bg-gray-100 transition-colors">
              Cancelar
            </button>
            <button onClick={salvar} disabled={pending}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors disabled:opacity-60">
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
