'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Award, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { promoverColaborador } from '@/app/actions/rh'
import { formatBRL, parseMoney } from '@/lib/midia'

const VINCULOS = [
  { value: 'clt', label: 'CLT' }, { value: 'socio', label: 'Sócio(a)' },
  { value: 'pj', label: 'PJ' }, { value: 'estagio', label: 'Estágio' },
  { value: 'outro', label: 'Outro' },
]
const VINC_LABEL: Record<string, string> = Object.fromEntries(VINCULOS.map(v => [v.value, v.label]))
const hm = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`
const inputCls = 'w-full px-3 py-2 bg-gray-100 border border-transparent rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500'
const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1'

/**
 * Promoção / mudança de vínculo em UM ato (mig. 290).
 *
 * Existe porque as quatro mudanças — vínculo, salário, cargo e jornada — moram
 * em lugares diferentes da ficha, e esquecer uma foi o que gerou o caso real:
 * a ficha já dizia CLT enquanto a jornada seguia de 6h. Aqui elas andam juntas,
 * o ANTES vira marco na linha do tempo, e a jornada nova vale a partir da data
 * — o passado continua cobrando a carga que valia nele.
 */
export function PromocaoModal({ orgSlug, colaborador, jornadaAtual, onClose }: {
  orgSlug: string
  colaborador: { id: string; nome: string; tipo_vinculo: string | null; salario_atual: number | null; cargo: string | null }
  /** Jornada vigente hoje — base para a nova e para mostrar o "de → para". */
  jornadaAtual: { carga_min: number; entrada: string; intervalo_ini: string; intervalo_fim: string; saida: string } | null
  onClose: () => void
}) {
  const router = useRouter()
  const [saving, start] = useTransition()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  const cargaAtual = jornadaAtual?.carga_min ?? 480
  const [data, setData] = useState(hoje)
  // O "de" é editável porque o caminho real é o DP corrigir a ficha primeiro e
  // só depois registrar o marco — aí o vínculo gravado já é o novo.
  const [vinculoDe, setVinculoDe] = useState(colaborador.tipo_vinculo ?? '')
  const [vinculo, setVinculo] = useState(colaborador.tipo_vinculo ?? '')
  const salarioFicha = colaborador.salario_atual != null
    ? formatBRL(Number(colaborador.salario_atual)).replace('R$', '').trim() : ''
  const [salarioDe, setSalarioDe] = useState(salarioFicha)
  const [salario, setSalario] = useState(salarioFicha)
  const [cargo, setCargo] = useState(colaborador.cargo ?? '')
  const [mudaJornada, setMudaJornada] = useState(false)
  const [entrada, setEntrada] = useState(jornadaAtual?.entrada?.slice(0, 5) ?? '08:30')
  const [intIni, setIntIni] = useState(jornadaAtual?.intervalo_ini?.slice(0, 5) ?? '12:00')
  const [intFim, setIntFim] = useState(jornadaAtual?.intervalo_fim?.slice(0, 5) ?? '13:30')
  const [saida, setSaida] = useState(jornadaAtual?.saida?.slice(0, 5) ?? '18:00')
  const [descricao, setDescricao] = useState('')

  // A carga sai dos horários — é o que a pessoa realmente vai cumprir.
  const cargaNova = useMemo(() => {
    const min = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
    const total = (min(intIni) - min(entrada)) + (min(saida) - min(intFim))
    return total > 0 ? total : 0
  }, [entrada, intIni, intFim, saida])

  const fichaJaMexida = vinculoDe !== (colaborador.tipo_vinculo ?? '')
  const vincMudou = !!vinculo && vinculo !== vinculoDe
  const salarioNovo = parseMoney(salario)
  const salarioAnterior = parseMoney(salarioDe)
  const salarioMudou = salarioNovo != null && Number(salarioNovo) !== Number(salarioAnterior ?? 0)
  const cargoMudou = cargo.trim() && cargo.trim() !== (colaborador.cargo ?? '')
  // Mudar só os horários (mesma carga) também é jornada nova: quem entra 08:00
  // em vez de 08:30 tem outra régua de atraso a partir da data.
  const horarioMudou = !!jornadaAtual && (
    entrada !== jornadaAtual.entrada.slice(0, 5) || intIni !== jornadaAtual.intervalo_ini.slice(0, 5)
    || intFim !== jornadaAtual.intervalo_fim.slice(0, 5) || saida !== jornadaAtual.saida.slice(0, 5))
  const jornadaMudou = mudaJornada && (cargaNova !== cargaAtual || horarioMudou)
  const algoMudou = vincMudou || salarioMudou || cargoMudou || jornadaMudou

  // Efeitos que a mudança dispara em outras partes — o time descobria isso
  // depois, quando o número aparecia errado no fechamento.
  const efeitos = useMemo(() => {
    const e: string[] = []
    if (vincMudou && vinculo === 'clt') {
      e.push(`A admissão CLT passa a ser ${data.slice(8, 10)}/${data.slice(5, 7)} — o tempo de casa continua contando da entrada.`)
      // A provisão de 22% é ligada pela CATEGORIA da folha (101…), não pelo
      // vínculo da ficha: só entra quando a folha chegar como CLT.
      e.push('O custo/hora soma 22% de provisão (13º, férias, aviso) a partir da folha em que ela vier como CLT.')
      e.push('Começa o contrato de experiência: 45 + 45 dias.')
      // O Flow não mexe na previsão do financeiro (mig. 268) — dizer que "sai
      // de uma categoria e entra na outra" prometeria automação que não existe.
      e.push('No Financeiro, os lançamentos previstos continuam em “Remuneração de Estagiários” — troque para “Remuneração Funcionários” você mesmo; a Conferência de folha vai apontar a diferença.')
      e.push('As férias CLT passam a contar a partir desta data.')
    }
    if (jornadaMudou) {
      e.push(cargaNova !== cargaAtual
        ? `A jornada vale ${hm(cargaNova)} a partir de ${data.slice(8, 10)}/${data.slice(5, 7)} — os dias anteriores seguem cobrando ${hm(cargaAtual)}.`
        : `O horário novo vale a partir de ${data.slice(8, 10)}/${data.slice(5, 7)} — os dias anteriores seguem com o horário antigo.`)
    }
    return e
  }, [vincMudou, vinculo, jornadaMudou, cargaNova, cargaAtual, data])

  function salvar() {
    if (!algoMudou) { toast.error('Nada mudou — ajuste ao menos um campo.'); return }
    if (mudaJornada && cargaNova <= 0) { toast.error('Confira os horários: a jornada ficou zerada.'); return }
    start(async () => {
      const r = await promoverColaborador(orgSlug, colaborador.id, {
        data_efeito: data,
        tipo_vinculo: vincMudou ? vinculo : null,
        vinculo_de: fichaJaMexida ? vinculoDe : null,
        salario: salarioMudou ? String(salarioNovo) : null,
        salario_de: fichaJaMexida && salarioAnterior != null ? String(salarioAnterior) : null,
        cargo: cargoMudou ? cargo.trim() : null,
        carga_min: jornadaMudou ? cargaNova : null,
        entrada, intervalo_ini: intIni, intervalo_fim: intFim, saida,
        descricao: descricao.trim() || null,
      })
      if (r?.error) { toast.error(r.error); return }
      toast.success('Registrado na linha do tempo e aplicado a partir da data.')
      onClose()
      router.refresh()
    })
  }

  return (
    <Modal open onClose={onClose} label="Promoção ou mudança de vínculo" dismissable={!saving} dismissOnBackdrop={false}>
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <Award className="w-4.5 h-4.5 text-orange-600" /> Promoção ou mudança de vínculo
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {colaborador.nome} · o que estava vale até a véspera; o novo passa a valer na data.
        </p>
      </div>

      <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>A partir de</label>
            <input type="date" value={data} onChange={e => setData(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Vínculo — passa a ser</label>
            <Select value={vinculo} onChange={setVinculo} options={VINCULOS} />
          </div>
        </div>

        <div className="rounded-xl bg-gray-50 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Era, até esta data</label>
              <Select value={vinculoDe} onChange={setVinculoDe} options={VINCULOS} />
            </div>
            {/* Quem já mexeu no vínculo à mão provavelmente mexeu no salário
                também — só aí o campo aparece. */}
            {fichaJaMexida && (
              <div>
                <label className={labelCls}>Ganhava</label>
                <input inputMode="decimal" value={salarioDe} onChange={e => setSalarioDe(e.target.value)}
                  className={inputCls} placeholder="0,00" />
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            {fichaJaMexida
              ? <>A ficha já está como <b>{VINC_LABEL[colaborador.tipo_vinculo ?? ''] ?? '—'}</b>. É isto aqui que
                 vai para o histórico como o “antes” — sem ele, o marco sairia sem o que a pessoa era.</>
              : <>Vem da ficha. Se alguém já trocou o vínculo na mão, corrija aqui para o histórico ficar certo.</>}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Salário</label>
            <input inputMode="decimal" value={salario} onChange={e => setSalario(e.target.value)}
              className={inputCls} placeholder="0,00" />
            {salarioMudou && (
              <p className="text-[11px] text-sky-700 mt-1">
                {salarioAnterior != null ? formatBRL(Number(salarioAnterior)) : '—'} → <b>{formatBRL(Number(salarioNovo))}</b>
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Cargo</label>
            <input value={cargo} onChange={e => setCargo(e.target.value)} className={inputCls} placeholder="Cargo" />
          </div>
        </div>

        {/* A jornada é o campo que mais esquecem — e o único que, mudado à mão,
            reescreveria a carga do passado. */}
        <div className="rounded-xl bg-gray-50 p-3">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={mudaJornada} onChange={e => setMudaJornada(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-orange-600" />
            <span className="min-w-0">
              <span className="block text-sm text-gray-800">Mudar a jornada</span>
              <span className="block text-[11px] text-gray-500 mt-0.5">
                Hoje: <b>{hm(cargaAtual)}/dia</b>. A nova vale só a partir da data — os dias já trabalhados
                continuam com a carga que valia neles.
              </span>
            </span>
          </label>

          {mudaJornada && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([['Entrada', entrada, setEntrada], ['Saída almoço', intIni, setIntIni],
                 ['Volta', intFim, setIntFim], ['Saída', saida, setSaida]] as const).map(([lb, val, set]) => (
                <div key={lb}>
                  <label className={labelCls}>{lb}</label>
                  <input type="time" value={val} onChange={e => set(e.target.value)}
                    className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900" />
                </div>
              ))}
              <p className="col-span-2 sm:col-span-4 text-[11px] text-gray-500">
                Dá <b className="text-gray-700">{hm(cargaNova)}/dia</b>
                {cargaNova !== cargaAtual && <> — era {hm(cargaAtual)}</>}
              </p>
            </div>
          )}
        </div>

        <div>
          <label className={labelCls}>Observação <span className="font-normal text-gray-400">(opcional)</span></label>
          <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2}
            className={inputCls} placeholder="Ex.: efetivação após o período de estágio" />
        </div>

        {efeitos.length > 0 && (
          <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2.5">
            <p className="text-[11px] font-medium text-amber-900 mb-1">O que muda junto:</p>
            <ul className="space-y-0.5">
              {efeitos.map((t, i) => (
                <li key={i} className="text-[11px] text-amber-800 flex items-start gap-1.5">
                  <Check className="w-3 h-3 mt-0.5 shrink-0" /> {t}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
        <button onClick={onClose} disabled={saving}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancelar</button>
        <button onClick={salvar} disabled={saving || !algoMudou}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-[#fff] text-sm font-medium rounded-xl hover:bg-orange-700 active:scale-[0.97] disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />} Registrar e aplicar
        </button>
      </div>
    </Modal>
  )
}
