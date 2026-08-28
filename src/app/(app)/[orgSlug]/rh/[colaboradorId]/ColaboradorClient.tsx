'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Check, Archive, ArchiveRestore, CalendarClock, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { formatBRL, parseMoney } from '@/lib/midia'
import { maskCPF, maskPhone } from '@/lib/masks'
import { salvarColaborador, setColaboradorArquivado, carregarImpactoDesligamento, setBatePonto, setEntraFechamento, setCustoOverhead } from '@/app/actions/rh'
import { JornadaEditor, type JornadaVals } from '../JornadaEditor'
import { Timeline } from '@/components/rh/Timeline'
import { LancamentosFuturos } from '@/components/rh/LancamentosFuturos'

export interface Colaborador {
  id: string; nome: string; cpf: string | null; email: string | null; telefone: string | null
  cargo: string | null; tipo_vinculo: string | null; data_admissao: string | null; data_demissao: string | null
  /** false = sócio/cargo de confiança: sem jornada controlada (migration 209). */
  bate_ponto?: boolean | null
  /** false = nunca entra no fechamento da contabilidade (migration 256). */
  entra_fechamento?: boolean | null
  status: string; gestor_id: string | null; salario_atual: number | string | null; beneficios_mensal: number | string | null; observacao: string | null; arquivado: boolean
  membro_user_id: string | null
  /** Substitui a folha no custo/hora (mig. 257) — sócio: retirada projetada. */
  custo_projetado_mensal?: number | string | null
  /** true = custo rateia como overhead (não atua em tarefas). */
  custo_overhead?: boolean | null
  /** Aviso prévio trabalhado (art. 488, migs. 262/263): reduz a carga esperada. */
  aviso_previo_ini?: string | null
  aviso_previo_fim?: string | null
  aviso_previo_modo?: string | null
}
export interface GestorRef { id: string; nome: string }
export interface MembroRef { user_id: string; profiles: { full_name: string | null; email: string } | null }

const VINCULOS = [{ value: 'clt', label: 'CLT' }, { value: 'socio', label: 'Sócio(a)' }, { value: 'pj', label: 'PJ' }, { value: 'estagio', label: 'Estágio' }, { value: 'outro', label: 'Outro' }]
const STATUS = [{ value: 'ativo', label: 'Ativo' }, { value: 'afastado', label: 'Afastado' }, { value: 'desligado', label: 'Desligado' }]
const inputCls = 'w-full px-4 py-2.5 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent'
const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5'

export function ColaboradorClient({ orgSlug, colab, gestores, membros, jornadaOverride, jornadaPadrao }: {
  orgSlug: string; colab: Colaborador; gestores: GestorRef[]; membros: MembroRef[]
  jornadaOverride: Partial<JornadaVals> | null; jornadaPadrao: Partial<JornadaVals> | null
}) {
  const router = useRouter()
  const [f, setF] = useState({
    nome: colab.nome ?? '', cpf: colab.cpf ? maskCPF(colab.cpf) : '', email: colab.email ?? '', telefone: colab.telefone ? maskPhone(colab.telefone) : '',
    cargo: colab.cargo ?? '', tipo_vinculo: colab.tipo_vinculo ?? '', status: colab.status ?? 'ativo',
    data_admissao: colab.data_admissao ?? '', data_demissao: colab.data_demissao ?? '',
    gestor_id: colab.gestor_id ?? '', salario_atual: colab.salario_atual != null ? formatBRL(Number(colab.salario_atual)).replace('R$', '').trim() : '',
    beneficios_mensal: colab.beneficios_mensal != null && Number(colab.beneficios_mensal) > 0 ? formatBRL(Number(colab.beneficios_mensal)).replace('R$', '').trim() : '',
    custo_projetado_mensal: colab.custo_projetado_mensal != null && Number(colab.custo_projetado_mensal) > 0 ? formatBRL(Number(colab.custo_projetado_mensal)).replace('R$', '').trim() : '',
    observacao: colab.observacao ?? '', membro_user_id: colab.membro_user_id ?? '',
    aviso_previo_ini: colab.aviso_previo_ini ?? '', aviso_previo_fim: colab.aviso_previo_fim ?? '',
    aviso_previo_modo: colab.aviso_previo_modo ?? '',
  })
  // Desligar aqui corta o acesso e solta as atividades (gatilho da migration 179).
  // A ficha avisa o tamanho disso ANTES de salvar — ninguém deve descobrir depois.
  const [impacto, setImpacto] = useState<{ tem_acesso: boolean; ativas: number } | null>(null)
  const set = (k: keyof typeof f, v: string) => {
    setF(p => ({ ...p, [k]: v }))
    if (k === 'status') {
      if (v !== 'desligado') { setImpacto(null); return }
      startAction(async () => {
        const r = await carregarImpactoDesligamento(orgSlug, colab.id)
        if (!r?.error) setImpacto(r.impacto ?? null)
      })
    }
  }
  const [saving, startSave] = useTransition()
  const [pending, startAction] = useTransition()

  const [batePonto, setBatePontoLocal] = useState(colab.bate_ponto !== false)
  const [togglando, startToggle] = useTransition()
  function alternarPonto(v: boolean) {
    setBatePontoLocal(v)               // otimista: o interruptor responde na hora
    startToggle(async () => {
      const r = await setBatePonto(orgSlug, colab.id, v)
      if (r?.error) { setBatePontoLocal(!v); toast.error(r.error); return }
      toast.success(v ? 'Passa a bater ponto.' : 'Dispensado de bater ponto.')
      router.refresh()
    })
  }

  // Separado de bate_ponto DE PROPÓSITO: sócio pode bater ponto para medir
  // custo/hora por tarefa e mesmo assim ficar fora do corte da contabilidade.
  const [entraFech, setEntraFechLocal] = useState(colab.entra_fechamento !== false)
  function alternarFechamento(v: boolean) {
    setEntraFechLocal(v)
    startToggle(async () => {
      const r = await setEntraFechamento(orgSlug, colab.id, v)
      if (r?.error) { setEntraFechLocal(!v); toast.error(r.error); return }
      toast.success(v ? 'Entra no fechamento da contabilidade.' : 'Fora do fechamento da contabilidade.')
      router.refresh()
    })
  }

  // Cargo adm/gestão que não atua em tarefas (mig. 257): o custo rateia como
  // overhead em quem produz e as horas saem do denominador.
  const [custoOh, setCustoOhLocal] = useState(colab.custo_overhead === true)
  function alternarCustoOverhead(v: boolean) {
    setCustoOhLocal(v)
    startToggle(async () => {
      const r = await setCustoOverhead(orgSlug, colab.id, v)
      if (r?.error) { setCustoOhLocal(!v); toast.error(r.error); return }
      toast.success(v ? 'Custo passa a ratear como overhead.' : 'Custo volta a ser direto da pessoa.')
      router.refresh()
    })
  }

  function salvar() {
    if (!f.nome.trim()) { toast.error('Nome é obrigatório.'); return }
    // CPF é a chave que casa a folha com a pessoa: sem ele o reimport criava uma
    // segunda ficha da mesma pessoa (decisão do Rafael, 03/08).
    if (f.cpf.replace(/\D/g, '').length !== 11) { toast.error('Informe o CPF completo — é ele que casa a folha com a pessoa.'); return }
    startSave(async () => {
      const r = await salvarColaborador(orgSlug, colab.id, {
        ...f,
        // Demissão só faz sentido p/ desligado; se voltou a ativo, limpa.
        data_demissao: f.status === 'desligado' ? f.data_demissao : null,
        // Aviso prévio NÃO depende do status: quem cumpre aviso está ATIVA
        // (marcar desligado antes da hora corta o acesso — mig. 179).
        aviso_previo_modo: f.aviso_previo_modo || null,
        aviso_previo_ini: f.aviso_previo_modo ? (f.aviso_previo_ini || null) : null,
        aviso_previo_fim: f.aviso_previo_modo ? (f.aviso_previo_fim || null) : null,
        salario_atual: f.salario_atual ? String(parseMoney(f.salario_atual)) : null,
        beneficios_mensal: f.beneficios_mensal ? String(parseMoney(f.beneficios_mensal)) : '0',
        custo_projetado_mensal: f.custo_projetado_mensal ? String(parseMoney(f.custo_projetado_mensal)) : null,
        gestor_id: f.gestor_id || null,
      })
      if (r?.error) toast.error(r.error)
      else { toast.success('Ficha salva.'); router.push(`/${orgSlug}/rh`) }
    })
  }

  function arquivar(v: boolean) {
    startAction(async () => {
      const r = await setColaboradorArquivado(orgSlug, colab.id, v)
      if (r?.error) toast.error(r.error)
      else { toast.success(v ? 'Colaborador arquivado.' : 'Colaborador restaurado.'); router.refresh() }
    })
  }

  return (
    <div className="p-6 max-w-3xl">
      <button onClick={() => router.push(`/${orgSlug}/rh`)} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Pessoas
      </button>

      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{f.nome || 'Colaborador'}</h1>
          <p className="text-gray-500 text-sm mt-0.5">{f.cargo || 'Sem cargo'}</p>
        </div>
        <button onClick={() => arquivar(!colab.arquivado)} disabled={pending}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-800 rounded-xl hover:bg-gray-100 transition disabled:opacity-50">
          {colab.arquivado ? <><ArchiveRestore className="w-4 h-4" /> Restaurar</> : <><Archive className="w-4 h-4" /> Arquivar</>}
        </button>
      </div>

      {/* Ficha */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelCls}>Nome *</label><input value={f.nome} onChange={e => set('nome', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Cargo</label><input value={f.cargo} onChange={e => set('cargo', e.target.value)} className={inputCls} /></div>
          <div>
            <label className={labelCls}>CPF <span className="text-orange-500">*</span></label>
            <input value={f.cpf} onChange={e => set('cpf', maskCPF(e.target.value))} className={inputCls} placeholder="000.000.000-00" inputMode="numeric" />
            {/* É o CPF que casa a folha com a pessoa. Sem ele, o reimport criava
                uma segunda ficha da mesma pessoa (migration 197). */}
            {f.cpf.replace(/\D/g, '').length !== 11 && (
              <p className="text-[11px] text-amber-700 mt-1">Sem CPF a folha não casa com esta pessoa no import.</p>
            )}
          </div>
          <div><label className={labelCls}>Vínculo</label><Select value={f.tipo_vinculo} onChange={v => set('tipo_vinculo', v)} options={VINCULOS} placeholder="—" /></div>

          {/* Interruptor, não campo do formulário: salva na hora pela RPC
              própria. Fica ao lado do Vínculo porque é ali que se decide se a
              pessoa tem jornada controlada. */}
          <div className="sm:col-span-2">
            <label className={labelCls}>Controle de jornada</label>
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-gray-100">
              {/* Switch canônico (ui/Switch) — a cópia inline antiga posicionava
                  a bolinha sem `left` e quebrou (dependia da posição estática). */}
              <div className="mt-0.5 shrink-0">
                <Switch checked={batePonto} onChange={alternarPonto} disabled={togglando} label="Bate ponto" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-gray-800">
                  {batePonto ? 'Bate ponto' : 'Dispensado de bater ponto'}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {batePonto
                    ? 'Tem jornada a cumprir: entra na cobrança e no espelho.'
                    : 'Sem jornada a cumprir — não gera falta nem entra na cobrança. É o caso de sócio e cargo de confiança (art. 62, II da CLT). Se registrar horas, elas aparecem como estão.'}
                </p>
              </div>
            </div>
            {/* O segundo interruptor é independente do primeiro: bater ponto
                para medir custo/hora por tarefa ≠ ir para a contabilidade. */}
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-gray-100 mt-2">
              <div className="mt-0.5 shrink-0">
                <Switch checked={entraFech} onChange={alternarFechamento} disabled={togglando} label="Entra no fechamento da contabilidade" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-gray-800">
                  {entraFech ? 'Entra no fechamento da contabilidade' : 'Fora do fechamento da contabilidade'}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {entraFech
                    ? 'Aparece pré-marcado no corte do ciclo e vai no PDF/e-mail para a contabilidade.'
                    : 'Nunca entra no corte nem no material da contabilidade — mesmo batendo ponto (ex.: sócio que registra horas só para medir custo por tarefa).'}
                </p>
              </div>
            </div>
            {/* Custo como overhead (mig. 257): cargo adm/gestão que não atua em
                tarefas — o custo dele rateia em quem produz. */}
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-gray-100 mt-2">
              <div className="mt-0.5 shrink-0">
                <Switch checked={custoOh} onChange={alternarCustoOverhead} disabled={togglando} label="Custo rateia como overhead" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-gray-800">
                  {custoOh ? 'Custo rateia como overhead' : 'Custo direto da pessoa'}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {custoOh
                    ? 'Não atua em tarefas: o custo mensal entra na estrutura (rateado em quem produz) e as horas saem do denominador do custo/hora.'
                    : 'Atua em tarefas: o custo mensal vira o custo/hora da própria pessoa. Ligue só para cargo de gestão/adm que não abre tarefa.'}
                </p>
              </div>
            </div>
          </div>
          <div><label className={labelCls}>E-mail</label><input value={f.email} onChange={e => set('email', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Telefone</label><input value={f.telefone} onChange={e => set('telefone', maskPhone(e.target.value))} className={inputCls} placeholder="(00) 00000-0000" inputMode="tel" /></div>
          <div><label className={labelCls}>Admissão</label><input type="date" value={f.data_admissao} onChange={e => set('data_admissao', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Situação</label><Select value={f.status} onChange={v => set('status', v)} options={STATUS} /></div>
          {f.status === 'desligado' && <div><label className={labelCls}>Demissão</label><input type="date" value={f.data_demissao} onChange={e => set('data_demissao', e.target.value)} className={inputCls} /></div>}
          {/* Aviso prévio trabalhado (art. 488): reduz a CARGA esperada — nada
              de abonar dia a dia. SEMPRE visível: quem cumpre aviso está ATIVA;
              marcar "Desligado" antes da hora corta o acesso na hora (mig. 179). */}
          <div className="sm:col-span-2 rounded-xl bg-gray-50 p-3">
            <div className="text-xs font-medium text-gray-600 mb-2">Aviso prévio trabalhado <span className="font-normal text-gray-400">(art. 488 — a escolha é do colaborador)</span></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Modalidade</label>
                <Select value={f.aviso_previo_modo} onChange={v => set('aviso_previo_modo', v)} options={[
                  { value: '', label: 'Sem redução (ou não se aplica)' },
                  { value: 'reducao_2h', label: 'Redução de 2h por dia' },
                  { value: 'ultima_semana', label: 'Dispensa dos últimos 7 dias' },
                ]} />
              </div>
              {f.aviso_previo_modo && (<>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Início do aviso</label>
                  <input type="date" value={f.aviso_previo_ini} onChange={e => set('aviso_previo_ini', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Último dia trabalhado</label>
                  <input type="date" value={f.aviso_previo_fim} onChange={e => set('aviso_previo_fim', e.target.value)} className={inputCls} />
                </div>
              </>)}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              {f.aviso_previo_modo === 'reducao_2h'
                ? 'Do início ao último dia, a jornada esperada cai 2h por dia — espelho e fechamento já contam assim, sem justificativa.'
                : f.aviso_previo_modo === 'ultima_semana'
                  ? 'Jornada cheia durante o aviso e os 7 últimos dias corridos (até o último dia) ficam sem carga — espelho e fechamento já contam assim.'
                  : 'Se o colaborador optar por uma das modalidades, o espelho e o fechamento ajustam a carga sozinhos.'}
              {f.aviso_previo_modo && f.status !== 'desligado' && (
                <> <b className="text-amber-700">A pessoa segue ativa durante o aviso</b> — mude a Situação para
                “Desligado” (com a demissão) só no desligamento efetivo: isso corta o acesso na hora.</>
              )}
            </p>
          </div>
          <div><label className={labelCls}>Salário atual</label><input inputMode="decimal" value={f.salario_atual} onChange={e => set('salario_atual', e.target.value)} className={inputCls} placeholder="0,00" /></div>
          {/* Custo-empresa de VR/VA/plano etc. — entra na camada 4 do custo/hora (migration 170) */}
          <div><label className={labelCls}>Benefícios (custo mensal)</label><input inputMode="decimal" value={f.beneficios_mensal} onChange={e => set('beneficios_mensal', e.target.value)} className={inputCls} placeholder="0,00" /></div>
          {/* Substitui a folha no custo/hora (mig. 257): sócio informa a retirada
              projetada (pró-labore + distribuição média) — o holerite de R$ 1.621
              fazia a hora do dono ser a 2ª mais barata do time. */}
          <div className="sm:col-span-2">
            <label className={labelCls}>Custo projetado <span className="font-normal text-gray-400">(R$/mês, opcional)</span></label>
            <input inputMode="decimal" value={f.custo_projetado_mensal} onChange={e => set('custo_projetado_mensal', e.target.value)} className={inputCls} placeholder="0,00" />
            <p className="text-[11px] text-gray-400 mt-1">
              Preenchido, substitui a folha no cálculo do custo/hora — informe o custo TOTAL mensal
              (ex.: sócio = pró-labore + distribuição média; sem encargos/provisões por cima).
              Benefícios da ficha ainda somam. Vazio = usa a folha normalmente.
            </p>
          </div>
          <div><label className={labelCls}>Gestor</label><Select value={f.gestor_id} onChange={v => set('gestor_id', v)} options={[{ value: '', label: '— nenhum —' }, ...gestores.map(g => ({ value: g.id, label: g.nome }))]} /></div>
          <div><label className={labelCls}>Vincular ao login <span className="font-normal text-gray-400">(habilita o ponto)</span></label>
            <Select value={f.membro_user_id} onChange={v => set('membro_user_id', v)} options={[{ value: '', label: '— não vinculado —' }, ...membros.map(m => ({ value: m.user_id, label: m.profiles?.full_name || m.profiles?.email || m.user_id }))]} /></div>
          <div className="col-span-2"><label className={labelCls}>Observação</label><textarea value={f.observacao} onChange={e => set('observacao', e.target.value)} rows={2} className={inputCls} /></div>

          {/* Desligar aqui é o offboarding inteiro: salvar corta o acesso e solta
              as atividades. Dizer isso antes evita a descoberta pelo susto. */}
          {f.status === 'desligado' && impacto && (impacto.tem_acesso || impacto.ativas > 0) && (
            <div className="col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800">
                <p className="font-medium">Ao salvar, o offboarding acontece sozinho:</p>
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                  {impacto.tem_acesso && <li>o acesso é arquivado na hora (perde o login e sai dos filtros)</li>}
                  {impacto.ativas > 0 && <li><strong>{impacto.ativas}</strong> atividade(s) ativa(s) ficam sem responsável — redistribua pelo filtro “Sem responsável” da Lista</li>}
                </ul>
                <p className="mt-1 text-amber-700">O histórico e as métricas do que a pessoa entregou continuam com ela.</p>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <button onClick={salvar} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 disabled:opacity-50 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Salvar ficha
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-3">Os documentos ficam na lista de Pessoas — botão “Documentos” na linha da pessoa.</p>

      {/* O que ainda está previsto no fluxo para esta pessoa (mig. 268) — o
          desligamento no RH não mexe no financeiro sozinho; aqui ele decide. */}
      <LancamentosFuturos orgSlug={orgSlug} colaboradorId={colab.id} nome={colab.nome}
        ativo={f.status !== 'desligado' && !f.aviso_previo_modo} />

      {/* Linha do tempo: promoção, reajuste, feedback, advertência (mig. 226) */}
      <div className="mt-4">
        <Timeline orgSlug={orgSlug} colaboradorId={colab.id}
          salarioAtual={colab.salario_atual != null ? Number(colab.salario_atual) : null}
          cargoAtual={colab.cargo ?? null} />
      </div>

      {/* Jornada: herda o padrão da empresa ou personaliza */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 mt-4">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3"><CalendarClock className="w-4 h-4" /> Jornada</h2>
        <JornadaEditor orgSlug={orgSlug} colaboradorId={colab.id}
          inicial={jornadaOverride ?? jornadaPadrao} temOverride={!!jornadaOverride} padrao={jornadaPadrao} />
      </div>
    </div>
  )
}
