import { assertRhAccess } from '@/lib/rh'
import { unwrap, unwrapOne } from '@/lib/supabase/unwrap'
import { marcacoesFora } from '@/app/actions/rh-ponto'
import { meuIp, type LocalRh } from '@/app/actions/rh-local'
import { PontoGestaoClient, type ExtraPend, type JustPend, type JornadaResumo, type JustDoDia } from './PontoGestaoClient'
import type { JornadaVals } from '../JornadaEditor'

export const dynamic = 'force-dynamic'

type ExtraRow = Omit<ExtraPend, 'batidas' | 'jornada' | 'justs'> & { rh_marcacao: { hora: string; seq: number }[] | null }

export default async function PontoGestaoPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const { supabase, orgId } = await assertRhAccess(orgSlug)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extrasRaw = unwrap<ExtraRow>(await (supabase as any)
    .from('rh_ponto')
    .select('id, data, minutos, saldo_min, acima_10h, colaborador_id, motivo, rh_colaborador!colaborador_id(nome), rh_marcacao(hora, seq)')
    .eq('org_id', orgId).eq('extra_status', 'pendente')
    .order('data', { ascending: false }), 'horas extras')

  // Contexto da aprovação: jornada prevista de cada pessoa (personalizada, senão a
  // padrão da org) e justificativas que cobrem os dias pendentes — o aprovador
  // decide vendo previsto × batido × motivo, sem sair da tela.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jornadas = unwrap<JornadaResumo & { colaborador_id: string | null }>(await (supabase as any)
    .from('rh_jornada')
    .select('colaborador_id, entrada, intervalo_ini, intervalo_fim, saida')
    .eq('org_id', orgId), 'jornadas')
  const jornadaDe = (cid: string): JornadaResumo | null =>
    jornadas.find(j => j.colaborador_id === cid) ?? jornadas.find(j => j.colaborador_id === null) ?? null

  let justsDosDias: (JustDoDia & { colaborador_id: string; data_ini: string; data_fim: string })[] = []
  if (extrasRaw.length) {
    const datas = extrasRaw.map(e => e.data).sort()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    justsDosDias = unwrap(await (supabase as any)
      .from('rh_justificativa')
      .select('colaborador_id, data_ini, data_fim, tipo, descricao, status')
      .eq('org_id', orgId)
      .lte('data_ini', datas[datas.length - 1]).gte('data_fim', datas[0]), 'justificativas dos dias')
  }

  const extras: ExtraPend[] = extrasRaw.map(({ rh_marcacao, ...e }) => ({
    ...e,
    batidas: (rh_marcacao ?? []).slice().sort((a, b) => a.seq - b.seq).map(m => m.hora.slice(0, 5)),
    jornada: jornadaDe(e.colaborador_id),
    justs: justsDosDias.filter(x => x.colaborador_id === e.colaborador_id && x.data_ini <= e.data && x.data_fim >= e.data),
    esperado_min: e.minutos - e.saldo_min,
  }))

  // Carga LÍQUIDA do dia (abono, feriado, escala — mig. 214): é a régua do
  // fechamento. O saldo_min gravado é pré-abono — numa extra que nasceu de
  // abono (mig. 259) ele até é negativo, e exibi-lo mentiria o tamanho da extra.
  await Promise.all(extras.map(async e => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: esp } = await (supabase as any)
      .rpc('rh_esperado_min', { p_colaborador: e.colaborador_id, p_data: e.data })
    if (typeof esp === 'number') e.esperado_min = esp
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const justs = unwrap<JustPend>(await (supabase as any)
    .from('rh_justificativa')
    .select('id, colaborador_id, data_ini, data_fim, tipo, descricao, status, doc_id, ausencia_ini, ausencia_fim, marcacoes, hora_entrada, hora_intervalo_ini, hora_intervalo_fim, hora_saida, rh_colaborador!colaborador_id(nome)')
    .eq('org_id', orgId).eq('status', 'pendente')
    .order('created_at', { ascending: false }), 'justificativas')

  // Marcações ATUAIS do dia de cada justificativa de um dia só: pré-carregam o
  // editor de pares e são a régua do "mudou de verdade?" na decisão.
  await Promise.all(justs.filter(j => j.data_ini === j.data_fim).map(async j => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ponto } = await (supabase as any)
      .from('rh_ponto').select('rh_marcacao(hora, seq)')
      .eq('colaborador_id', j.colaborador_id).eq('data', j.data_ini).maybeSingle()
    j.atuais = ((ponto?.rh_marcacao ?? []) as { hora: string; seq: number }[])
      .sort((a, b) => a.seq - b.seq).map(m => m.hora.slice(0, 5))
  }))

  // Jornada padrão da org (colaborador_id null) — pode não existir se a org é nova.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jornadaPadrao = unwrapOne<Partial<JornadaVals>>(await (supabase as any)
    .from('rh_jornada')
    .select('entrada, intervalo_ini, intervalo_fim, saida, flex_min, tolerancia_min, dias_semana')
    .eq('org_id', orgId).is('colaborador_id', null).maybeSingle(), 'jornada padrão')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cfg } = await (supabase as any)
    .from('org_settings').select('ponto_obrigatorio').eq('org_id', orgId).maybeSingle()

  // Locais autorizados + batidas fora aguardando conferência (mig. 227).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const locais = unwrap<LocalRh>(await (supabase as any)
    .from('rh_local').select('id, nome, ips, lat, lon, raio_m, ativo')
    .eq('org_id', orgId).order('nome'), 'locais')

  const [fora, ipAtual] = await Promise.all([
    marcacoesFora(orgSlug),
    meuIp(),
  ])

  return <PontoGestaoClient
    pontoObrigatorio={!!cfg?.ponto_obrigatorio} orgSlug={orgSlug} extras={extras} justificativas={justs}
    jornadaPadrao={jornadaPadrao} locais={locais} fora={fora} ipAtual={ipAtual} />
}
