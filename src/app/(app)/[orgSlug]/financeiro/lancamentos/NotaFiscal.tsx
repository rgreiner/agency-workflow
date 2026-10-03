'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, FileText, ReceiptText, AlertTriangle, Copy, Check, X, Minus,
  ClipboardCheck, Download, FileCode2, Ban, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/lib/midia'
import { Select } from '@/components/ui/Select'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  emitirNota, conferirNota, cancelarNota, dadosParaEmitir,
  type NotaDoLancamento, type LinhaConferencia, type DadosParaEmitir,
} from '@/app/actions/nfse'
import { ROTULO_TOMADOR, type TipoTomador } from '@/lib/fiscal/tomador'

/**
 * Emissão de NFS-e a partir do lançamento a receber (migs. 309/313/315).
 *
 * Emitir é ato público com prazo curto para cancelar: por isso UMA por vez e
 * sempre com diálogo que diz o valor, o tomador e — em letras grandes — se a
 * nota é de teste ou oficial. Nada de lote.
 *
 * Emitida, a nota não se edita: ou se CANCELA (não devia existir) ou se
 * SUBSTITUI (devia existir com outro conteúdo). Os dois caminhos estão aqui,
 * separados de propósito, porque a escolha entre eles é da pessoa.
 */

// A Receita exige motivo com no mínimo 15 caracteres (TSMotivo no schema).
const MOTIVO_MIN = 15

const MOTIVOS_CANCELAMENTO = [
  { value: '1', label: 'Erro na emissão' },
  { value: '2', label: 'Serviço não prestado' },
  { value: '9', label: 'Outros' },
]

const MOTIVOS_SUBSTITUICAO = [
  { value: '99', label: 'Outros' },
  { value: '01', label: 'Desenquadramento do Simples Nacional' },
  { value: '02', label: 'Enquadramento no Simples Nacional' },
  { value: '03', label: 'Inclusão retroativa de imunidade/isenção' },
  { value: '04', label: 'Exclusão retroativa de imunidade/isenção' },
  { value: '05', label: 'Rejeição da NFS-e pelo tomador' },
]

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
    const cancelada = nota.status === 'cancelada'
    return (
      <span className="inline-flex items-center gap-1"
        title={cancelada
          ? `${nota.substituidaPor ? 'Substituída' : 'Cancelada'} · chave ${nota.chave}`
          : `Chave ${nota.chave}`}>
        {cancelada
          ? <Ban className="w-3.5 h-3.5 text-gray-400" />
          : <FileText className={cn('w-3.5 h-3.5', nota.ambiente === 'producao' ? 'text-emerald-600' : 'text-sky-500')} />}
        <span className={cn('text-[11px] font-medium tabular-nums',
          cancelada ? 'text-gray-400 line-through' : 'text-gray-700')}>
          {nota.numero ?? 'NF'}
        </span>
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
export function NotaFiscalBloco({ orgSlug, lancamentoId, nota, cliente, nfAnexada, onEmitida }: {
  orgSlug: string
  lancamentoId: string
  nota?: NotaDoLancamento
  cliente: string | null
  /** NF da agência anexada ao lançamento — emitida FORA do Flow (prefeitura). */
  nfAnexada?: { nome?: string; numero?: string } | null
  onEmitida: (n: NotaDoLancamento) => void
}) {
  const router = useRouter()
  const [confirmar, setConfirmar] = useState(false)
  const [cancelar, setCancelar] = useState(false)
  const [substituir, setSubstituir] = useState(false)
  const [copiado, setCopiado] = useState(false)

  const cancelada = nota?.status === 'cancelada'

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
        {(!nota || cancelada) && (
          <button type="button" onClick={() => setConfirmar(true)}
            className="press inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-orange-600 text-[#fff] hover:bg-orange-700 transition-colors">
            <ReceiptText className="w-3.5 h-3.5" /> {cancelada ? 'Emitir outra' : 'Emitir NFS-e'}
          </button>
        )}
      </div>

      {nota ? (
        <div className={cn('rounded-xl px-3 py-2.5 space-y-2', cancelada ? 'bg-gray-100' : 'bg-gray-50')}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn('font-medium tabular-nums', cancelada ? 'text-gray-500 line-through' : 'text-gray-900')}>
              NFS-e {nota.numero ?? '—'}{nota.serie ? ` · série ${nota.serie}` : ''}
            </span>
            <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              nota.ambiente === 'producao' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700')}>
              {nota.ambiente === 'producao' ? 'oficial' : 'teste'}
            </span>
            {cancelada && (
              <span className="rounded-md bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                {nota.substituidaPor ? 'substituída' : 'cancelada'}
              </span>
            )}
          </div>

          {/* A chave é o que se procura em conferência — clicar copia. */}
          <button type="button" onClick={copiarChave}
            className="no-press group flex items-center gap-1.5 text-left text-[11px] font-mono text-gray-500 hover:text-gray-800 transition-colors break-all">
            {copiado ? <Check className="w-3 h-3 shrink-0 text-emerald-600" /> : <Copy className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />}
            {nota.chave}
          </button>

          {cancelada && nota.motivoCancelamento && (
            <p className="text-[11px] text-gray-500">
              {nota.substituidaPor ? 'Substituída: ' : 'Cancelada: '}{nota.motivoCancelamento}
            </p>
          )}

          {/* O que vai para o cliente junto do boleto — e o XML, que é o
              documento fiscal de verdade, para a contabilidade arquivar. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <a href={`/api/fiscal/nota/${nota.id}`} download
              className="press inline-flex items-center gap-1.5 rounded-lg bg-white border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors">
              <Download className="w-3.5 h-3.5" /> Baixar DANFSe (PDF)
            </a>
            <a href={`/api/fiscal/nota/${nota.id}?xml=1`} download
              className="press inline-flex items-center gap-1.5 rounded-lg bg-white border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors">
              <FileCode2 className="w-3.5 h-3.5" /> XML
            </a>
            {!cancelada && (
              <>
                <button type="button" onClick={() => setSubstituir(true)}
                  className="press inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors">
                  <RefreshCw className="w-3.5 h-3.5" /> Substituir
                </button>
                <button type="button" onClick={() => setCancelar(true)}
                  className="press inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:text-red-700 hover:bg-red-50 transition-colors">
                  <Ban className="w-3.5 h-3.5" /> Cancelar nota
                </button>
              </>
            )}
          </div>

          <Conferencia orgSlug={orgSlug} notaId={nota.id} />
        </div>
      ) : nfAnexada ? (
        /* "Sem nota" era falso aqui: a NF existe, foi emitida no sistema da
           prefeitura e está anexada logo acima. Dizer o que o Flow sabe evita
           emitir a segunda sem perceber. */
        <div className="rounded-xl bg-gray-50 px-3 py-2.5 text-xs text-gray-600">
          <p>
            <strong className="font-medium text-gray-800">
              {nfAnexada.numero ? `NF ${nfAnexada.numero}` : 'NF'}
            </strong>{' '}
            anexada, emitida fora do Flow (sistema da prefeitura).
          </p>
          <p className="mt-0.5 text-gray-500">
            O Flow não controla essa nota: não há XML nem cancelamento por aqui. Emitir agora criaria uma segunda nota.
          </p>
        </div>
      ) : (
        <p className="text-xs text-gray-500 py-1">
          Sem nota. Emitir usa o certificado e os dados fiscais de Configurações → Nota fiscal.
        </p>
      )}

      {confirmar && (
        <DialogoEmitir orgSlug={orgSlug} lancamentoId={lancamentoId} cliente={cliente}
          onFechar={() => setConfirmar(false)} onEmitida={n => { setConfirmar(false); onEmitida(n) }} />
      )}
      {cancelar && nota && (
        <DialogoCancelar orgSlug={orgSlug} nota={nota}
          onFechar={() => setCancelar(false)}
          onPronto={() => { setCancelar(false); router.refresh() }} />
      )}
      {substituir && nota && (
        <DialogoEmitir orgSlug={orgSlug} lancamentoId={lancamentoId} cliente={cliente}
          substituir={nota}
          onFechar={() => setSubstituir(false)} onEmitida={n => { setSubstituir(false); onEmitida(n) }} />
      )}
    </div>
  )
}

/**
 * Diálogo de emissão — e de substituição, que é a mesma emissão carregando a
 * chave da nota velha.
 *
 * Carrega os dados do lançamento ao abrir porque o tomador é o ponto delicado:
 * a maioria dos lançamentos a receber veio do import sem cliente vinculado, e
 * sem tomador não há nota. O Flow sugere pelo nome do centro de custo; quem
 * confirma é a pessoa.
 */
export function DialogoEmitir({ orgSlug, lancamentoId, cliente, substituir, onFechar, onEmitida }: {
  orgSlug: string
  lancamentoId: string
  /** Só para contexto na tela; o valor da nota vem do servidor, nunca da tabela. */
  cliente?: string | null
  /** Quando presente, esta emissão SUBSTITUI a nota indicada. */
  substituir?: NotaDoLancamento
  onFechar: () => void
  onEmitida: (n: NotaDoLancamento) => void
}) {
  const router = useRouter()
  const [emitindo, start] = useTransition()
  const [dados, setDados] = useState<DadosParaEmitir | null>(null)
  // "tipo:id" — o id sozinho não identifica: cliente, veículo e fornecedor são
  // tabelas diferentes e nada impede dois cadastros com o mesmo uuid de origem.
  const [escolha, setEscolha] = useState('')
  const [cMotivo, setCMotivo] = useState('99')
  const [xMotivo, setXMotivo] = useState('')
  const [cienteDaDuplicata, setCiente] = useState(false)
  const [descricao, setDescricao] = useState('')

  useEffect(() => {
    let vivo = true
    dadosParaEmitir(orgSlug, lancamentoId).then(r => {
      if (!vivo) return
      if (r.error) { toast.error(r.error); onFechar(); return }
      setDados(r.dados ?? null)
      const inicial = r.dados?.tomador ?? r.dados?.sugestao
      setEscolha(inicial ? `${inicial.tipo}:${inicial.id}` : '')
      setDescricao(r.dados?.descricaoSugerida ?? '')
    })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, lancamentoId])

  const escolhido = dados?.tomadores.find(t => `${t.tipo}:${t.id}` === escolha) ?? null
  const vinculado = !!dados?.tomador
  const motivoCurto = substituir && xMotivo.trim().length < MOTIVO_MIN
  // Duplicata exige aceite explícito: o aviso sozinho vira paisagem, e nota em
  // duplicidade só se desfaz cancelando.
  const precisaAceite = !!dados?.nfAnexada && !substituir
  // Descrição vazia não emite: ela é o que o tomador lê na nota.
  const travado = !dados || !escolha || !descricao.trim() || !!motivoCurto || (precisaAceite && !cienteDaDuplicata)

  return (
    <ConfirmDialog
      open
      size="lg"
      title={substituir ? 'Substituir a NFS-e?' : 'Emitir NFS-e?'}
      description={substituir
        ? `A nota ${substituir.numero ?? ''} é cancelada pela Receita e uma nova é emitida com os dados atuais deste lançamento.`
        : 'A nota é enviada à Receita no ambiente configurado. Nota emitida tem prazo curto para cancelar.'}
      confirmLabel={substituir ? 'Substituir' : 'Emitir'}
      loading={emitindo}
      onCancel={onFechar}
      onConfirm={() => {
        if (travado) return
        start(async () => {
          const [tipo, id] = escolha.split(':')
          const r = await emitirNota(orgSlug, lancamentoId, {
            tomador: tipo && id ? { tipo: tipo as TipoTomador, id } : undefined,
            descricao: descricao.trim(),
            confirmarNfAnexada: cienteDaDuplicata,
            substituir: substituir ? { notaId: substituir.id, cMotivo, xMotivo: xMotivo.trim() } : undefined,
          })
          if (r.error) { toast.error(r.error, { duration: 10000 }); return }
          if (!r.nota) { toast.error('A Receita não devolveu a nota.'); return }
          toast.success(`NFS-e ${r.nota.numero ?? ''} emitida${r.nota.ambiente === 'restrita' ? ' (teste)' : ''}.`)
          onEmitida(r.nota)
          router.refresh()
        })
      }}
    >
      {!dados ? (
        <p className="flex items-center gap-2 py-2 text-xs text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Conferindo o cadastro…
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Tomador (quem recebe a nota)</label>
            <Select
              value={escolha}
              onChange={setEscolha}
              options={dados.tomadores.map(t => ({
                value: `${t.tipo}:${t.id}`,
                // O tipo entra no rótulo porque a lista mistura os três cadastros
                // e há nome parecido entre eles — "quem é este Rede Outdoor?"
                // precisa de resposta sem abrir outra tela.
                label: `${t.nome} · ${ROTULO_TOMADOR[t.tipo].toLowerCase()}`,
              }))}
              placeholder="Escolher quem recebe a nota"
            />
            {/* Dizer de onde veio o palpite evita aceitar o tomador errado no
                automático — e numa nota fiscal isso só se conserta cancelando. */}
            {!vinculado && dados.sugestao && escolha === `${dados.sugestao.tipo}:${dados.sugestao.id}` && (
              <p className="mt-1 text-[11px] text-gray-500">
                Sugerido pelo contato do lançamento. Confira antes de emitir.
                {dados.sugestao.tipo === 'cliente' && ' Sendo cliente, o vínculo fica salvo.'}
              </p>
            )}
            {!vinculado && !dados.sugestao && (
              <p className="mt-1 text-[11px] text-amber-700">
                Este lançamento não tem tomador vinculado. Fee e Job vão para o cliente;
                comissão de mídia, para o veículo; comissão de produção, para o fornecedor.
              </p>
            )}
          </div>

          {/* A descrição vai IMPRESSA na nota, e é o que o cliente lê. A do
              lançamento é rótulo do financeiro ("Venda", "Comissão") e já virou
              descrição de uma nota de verdade — por isso aqui se confirma. */}
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Descrição do serviço (vai impressa na nota)</label>
            <textarea
              value={descricao} onChange={e => setDescricao(e.target.value)} rows={2} maxLength={2000}
              placeholder="Ex.: PP 1911 | FC Cascavel"
              className="w-full rounded-xl bg-gray-100 border-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:bg-white focus:border-gray-300 transition-colors"
            />
            {dados.descricao && dados.descricao.trim() !== descricao.trim() && (
              <p className="mt-1 text-[11px] text-gray-400">
                No lançamento está: <span className="text-gray-600">{dados.descricao}</span>
              </p>
            )}
          </div>

          {substituir && (
            <>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Motivo da substituição</label>
                <Select value={cMotivo} onChange={setCMotivo} options={MOTIVOS_SUBSTITUICAO} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Explicação (vai no evento, na Receita)</label>
                <textarea
                  value={xMotivo} onChange={e => setXMotivo(e.target.value)} rows={2} maxLength={255}
                  placeholder="Ex.: valor do serviço corrigido conforme contrato"
                  className="w-full rounded-xl bg-gray-100 border-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:bg-white focus:border-gray-300 transition-colors"
                />
                <p className={cn('mt-1 text-[11px] tabular-nums', motivoCurto ? 'text-amber-700' : 'text-gray-400')}>
                  {xMotivo.trim().length}/{MOTIVO_MIN} mínimo — a Receita recusa texto curto.
                </p>
              </div>
            </>
          )}

          {/* Já existe NF da agência anexada: emitir por cima é nota em
              duplicidade, e duplicidade só se desfaz cancelando. */}
          {precisaAceite && (
            <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <p className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px text-amber-600" />
                <span>
                  Este lançamento já tem a <strong>{dados.nfAnexada!.numero ? `NF ${dados.nfAnexada!.numero}` : 'NF'}</strong> da
                  agência anexada, emitida fora do Flow. Emitir agora cria uma <strong>segunda</strong> nota para o mesmo serviço.
                </span>
              </p>
              <label className="mt-2 flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={cienteDaDuplicata} onChange={e => setCiente(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500" />
                <span>Sei que já existe nota e quero emitir outra.</span>
              </label>
            </div>
          )}

          {/* Conferência final: o que a Receita vai registrar. */}
          {escolhido && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-gray-500">Confira antes de emitir</p>
              <Conferir linhas={[
                { rotulo: 'Razão social', valor: escolhido.razao || escolhido.nome,
                  alerta: !escolhido.razao },
                { rotulo: 'CNPJ', valor: formatarCnpj(escolhido.cnpj), inteiro: true },
                { rotulo: 'Competência', valor: formatarData(dados.competencia) || '—',
                  inteiro: true, alerta: !dados.competencia },
                { rotulo: 'Serviço', valor: descricao.trim() || '—', alerta: !descricao.trim() },
                { rotulo: 'Valor total', valor: formatBRL(dados.valor), forte: true, inteiro: true },
              ]} />
              {!escolhido.razao && (
                <p className="mt-1 text-[11px] text-amber-700">
                  Este cadastro não tem razão social — a nota sairá com o nome acima.
                  O botão de buscar o CNPJ no cadastro preenche.
                </p>
              )}
            </div>
          )}

          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px text-amber-600" />
            {dados.ambiente === 'producao'
              ? 'Ambiente OFICIAL: esta nota vale e vai para a Receita. Código do serviço e tributação vêm do cadastro fiscal — se estiverem errados, a correção é cancelar.'
              : 'Ambiente de TESTE (produção restrita): a nota não tem valor fiscal e não serve para cobrança.'}
          </p>
          {cliente && !vinculado && (
            <p className="text-[11px] text-gray-400">Contato do lançamento: {cliente}</p>
          )}
        </div>
      )}
    </ConfirmDialog>
  )
}

/** Cancelamento: a nota não devia existir. */
function DialogoCancelar({ orgSlug, nota, onFechar, onPronto }: {
  orgSlug: string
  nota: NotaDoLancamento
  onFechar: () => void
  onPronto: () => void
}) {
  const [indo, start] = useTransition()
  const [cMotivo, setCMotivo] = useState('1')
  const [xMotivo, setXMotivo] = useState('')
  const curto = xMotivo.trim().length < MOTIVO_MIN

  return (
    <ConfirmDialog
      open
      title={`Cancelar a NFS-e ${nota.numero ?? ''}?`}
      description="O cancelamento é registrado na Receita e não se desfaz. Se a nota precisa existir com outro conteúdo, use Substituir."
      confirmLabel="Cancelar a nota"
      cancelLabel="Voltar"
      loading={indo}
      onCancel={onFechar}
      onConfirm={() => {
        if (curto) return
        start(async () => {
          const r = await cancelarNota(orgSlug, nota.id, { cMotivo, xMotivo: xMotivo.trim() })
          if (r.error) { toast.error(r.error, { duration: 10000 }); return }
          toast.success('Nota cancelada na Receita.')
          onPronto()
        })
      }}
    >
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Motivo</label>
          <Select value={cMotivo} onChange={setCMotivo} options={MOTIVOS_CANCELAMENTO} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Explicação (vai no evento, na Receita)</label>
          <textarea
            value={xMotivo} onChange={e => setXMotivo(e.target.value)} rows={2} maxLength={255}
            placeholder="Ex.: nota emitida para o cliente errado"
            className="w-full rounded-xl bg-gray-100 border-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:bg-white focus:border-gray-300 transition-colors"
          />
          <p className={cn('mt-1 text-[11px] tabular-nums', curto ? 'text-amber-700' : 'text-gray-400')}>
            {xMotivo.trim().length}/{MOTIVO_MIN} mínimo — a Receita recusa texto curto.
          </p>
        </div>
      </div>
    </ConfirmDialog>
  )
}

/** Indicador de carregamento das notas, usado enquanto o mapa não chegou. */
export function NotaCarregando() {
  return <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-300 inline" />
}

const formatarCnpj = (v: string) =>
  v.length === 14 ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : v

const formatarData = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : ''

/**
 * O que vai na nota, lado a lado, antes de disparar.
 *
 * Emitir é ato público com prazo curto para cancelar, e os cinco campos abaixo
 * são os que não têm conserto depois: tomador errado, competência errada, valor
 * errado ou descrição errada só se resolvem cancelando a nota. Ler isto leva
 * cinco segundos; cancelar leva um evento registrado na Receita para sempre.
 */
function Conferir({ linhas }: {
  linhas: { rotulo: string; valor: string; forte?: boolean; alerta?: boolean; inteiro?: boolean }[]
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
      {linhas.map(l => (
        // Em tela estreita o rótulo sobe e o valor fica com a linha inteira:
        // duas colunas espremidas quebram CNPJ e razão social no meio.
        <div key={l.rotulo} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3">
          <span className="shrink-0 text-[11px] text-gray-500 sm:w-24">{l.rotulo}</span>
          <span className={cn(
            'min-w-0 flex-1 text-sm',
            // `inteiro` protege o que não pode ser lido pela metade — CNPJ e
            // valor. O resto pode quebrar, e é melhor quebrar que estourar.
            l.inteiro ? 'whitespace-nowrap tabular-nums' : 'break-words',
            l.forte ? 'font-semibold text-gray-900 tabular-nums' : 'text-gray-800',
            l.alerta && 'text-amber-700',
          )}>
            {l.valor}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Conferência campo a campo: o que o Flow PEDIU na DPS × o que a Receita
 * REGISTROU na nota autorizada.
 *
 * "Deu 201" prova que a nota foi aceita, não que saiu certa. Na primeira emissão
 * real é isto que se olha — e depois, sempre que algo cheirar errado.
 */
function Conferencia({ orgSlug, notaId }: { orgSlug: string; notaId: string }) {
  const [aberto, setAberto] = useState(false)
  const [linhas, setLinhas] = useState<LinhaConferencia[] | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function abrir() {
    setAberto(a => !a)
    if (linhas || carregando) return
    setCarregando(true)
    try {
      const r = await conferirNota(orgSlug, notaId)
      if (r.error) { toast.error(r.error); setAberto(false); return }
      setLinhas(r.linhas ?? [])
    } finally {
      setCarregando(false)
    }
  }

  const divergem = (linhas ?? []).filter(l => l.bate === false).length

  return (
    <div className="pt-1">
      <button type="button" onClick={abrir}
        className="press inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-800 transition-colors">
        {carregando ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardCheck className="w-3 h-3" />}
        {aberto ? 'Fechar conferência' : 'Conferir campo a campo'}
        {linhas && divergem > 0 && (
          <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">{divergem}</span>
        )}
      </button>

      {aberto && linhas && (
        <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-gray-500">
                <th className="text-left font-medium px-2.5 py-1.5">Campo</th>
                <th className="text-left font-medium px-2.5 py-1.5">Flow pediu</th>
                <th className="text-left font-medium px-2.5 py-1.5">Receita registrou</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {linhas.map(l => (
                <tr key={l.campo} className={cn(l.bate === false && 'bg-amber-50')}>
                  <td className="px-2.5 py-1.5 text-gray-600 align-top whitespace-nowrap">
                    {l.campo}
                    {l.nota && <span className="block text-[10px] text-gray-400 font-normal">{l.nota}</span>}
                  </td>
                  <td className="px-2.5 py-1.5 text-gray-700 align-top break-all">{l.pedido || <span className="text-gray-300">—</span>}</td>
                  <td className="px-2.5 py-1.5 text-gray-900 align-top break-all">{l.registrado || <span className="text-gray-300">—</span>}</td>
                  <td className="px-2.5 py-1.5 align-top">
                    {l.bate === true ? <Check className="w-3.5 h-3.5 text-emerald-600" />
                      : l.bate === false ? <X className="w-3.5 h-3.5 text-amber-600" />
                      : <Minus className="w-3.5 h-3.5 text-gray-300" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-2.5 py-2 text-[10px] text-gray-500 border-t border-gray-100">
            {divergem === 0
              ? 'Tudo que o Flow pediu foi registrado igual.'
              : `${divergem} campo(s) divergem — a Receita registrou diferente do que foi enviado. Confira antes de emitir a próxima.`}
          </p>
        </div>
      )}
    </div>
  )
}
