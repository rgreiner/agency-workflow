'use server'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getUsuario } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'

async function ctx(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' as const }
  const { data: org } = await supabase.from('organizations').select('id').eq('slug', orgSlug).single()
  if (!org) return { error: 'Organização não encontrada' as const }
  return { supabase, orgId: org.id as string, userId: user.id as string }
}

/** Registra a próxima marcação do dia. Não há tipo fixo: são N pares livres
 *  (entrada, pausas quantas precisar, saída). A regra do almoço de 1h é conferida
 *  no fechamento do dia (intervalo_ok), não no clique.
 *
 *  Localização (mig. 227): o IP sai do header aqui no servidor — o cliente não
 *  tem como saber o próprio IP público, e mandar de lá seria forjável. A
 *  coordenada vem do navegador e é opcional: quem negar a permissão bate
 *  normalmente e a marcação entra na fila do RH como "fora". */
export async function baterPonto(orgSlug: string, colaboradorId: string, geo?: {
  lat: number | null; lon: number | null; motivo?: string | null
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }

  const h = await headers()
  // x-forwarded-for pode vir encadeado ("cliente, proxy1, proxy2") — o primeiro
  // é o cliente real. Atrás do Traefik é sempre esse formato.
  const ip = (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim() || null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_bater_ponto', {
    p_colaborador_id: colaboradorId,
    p_lat: geo?.lat ?? null, p_lon: geo?.lon ?? null,
    p_ip: ip, p_motivo: geo?.motivo ?? null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/ponto`)
  return { ok: true, resultado: data as { hora: string; fora?: boolean; local?: string | null } }
}

/** Marcações batidas fora dos locais autorizados, aguardando o RH. */
export async function marcacoesFora(orgSlug: string, status = 'pendente') {
  const c = await ctx(orgSlug)
  if ('error' in c) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (c.supabase as any).rpc('rh_marcacoes_fora', { p_org: c.orgId, p_status: status })
  return (data ?? []) as {
    marcacao_id: string; data: string; hora: string; seq: number
    colaborador_id: string; nome: string; cargo: string | null
    lat: number | null; lon: number | null; ip: string | null
    motivo: string | null; status: string
  }[]
}

/** Decide uma marcação fora. É AUDITORIA: a hora já contou desde a batida —
 *  corrigir o dia continua sendo o editor do espelho (rh_editar_ponto). */
export async function decidirMarcacaoFora(orgSlug: string, marcacaoId: string, status: string) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_marcacao_decidir_fora', {
    p_marcacao: marcacaoId, p_status: status,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ponto`)
  return { ok: true }
}

/** Pares completos, ordem crescente, HH:MM — a mesma régua do editor. */
function validarPares(marcacoes: string[]): string | null {
  if (marcacoes.some(h => !/^\d{2}:\d{2}$/.test(h))) return 'Horário inválido nas marcações.'
  if (marcacoes.length % 2 === 1) return 'As marcações vêm em pares (entrada e saída).'
  const ordenado = [...marcacoes].sort()
  if (ordenado.join() !== marcacoes.join()) return 'As marcações precisam estar em ordem crescente.'
  return null
}

/** Abre uma justificativa (falta/atestado/esqueci) → decisão do RH. */
export async function criarJustificativa(
  orgSlug: string, colaboradorId: string,
  j: {
    tipo: string; data_ini: string; data_fim: string; descricao?: string | null; doc_id?: string | null
    // Período que o documento cobre (ex.: 13:00–14:00 da declaração). É ele que
    // define quanto sai da carga do dia — ver rh_abono_min (migration 212).
    ausencia_ini?: string | null; ausencia_fim?: string | null
    // Marcações corretas (opcional): o dia COMPLETO em N pares ["08:30","12:00",…].
    // Se informado, a aprovação do RH grava a lista inteira (migration 222).
    marcacoes?: string[] | null
  },
) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  if (j.marcacoes?.length) {
    const erro = validarPares(j.marcacoes)
    if (erro) return { error: erro }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).from('rh_justificativa').insert({
    org_id: c.orgId, colaborador_id: colaboradorId, tipo: j.tipo,
    data_ini: j.data_ini, data_fim: j.data_fim || j.data_ini,
    descricao: j.descricao || null, doc_id: j.doc_id || null, created_by: c.userId,
    ausencia_ini: j.ausencia_ini || null, ausencia_fim: j.ausencia_fim || null,
    marcacoes: j.marcacoes?.length ? j.marcacoes : null,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/ponto`)
  revalidatePath(`/${orgSlug}/rh/ponto`)
  return { ok: true }
}

/** RH decide a justificativa: aprovado | rejeitado | abonado | falta.
 *  Se `horas` vier (ou já estiver na justificativa), aprovar AJUSTA a marcação do ponto
 *  — preservando a original em rh_ponto.ajuste_de. `marcacoes` é o dia completo em
 *  N pares; os 4 campos legados (hora_*) da justificativa antiga não são tocados. */
export async function decidirJustificativa(orgSlug: string, id: string, status: string, horas?: {
  marcacoes?: string[] | null
  ausencia_ini?: string | null; ausencia_fim?: string | null
}) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  if (!['aprovado', 'rejeitado', 'abonado', 'falta'].includes(status)) return { error: 'Status inválido' }

  // O RH pode corrigir/informar o horário na hora de decidir.
  if (horas && (horas.marcacoes !== undefined || horas.ausencia_ini || horas.ausencia_fim)) {
    if (horas.marcacoes?.length) {
      const erro = validarPares(horas.marcacoes)
      if (erro) return { error: erro }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upd: Record<string, any> = {
      ausencia_ini: horas.ausencia_ini || null, ausencia_fim: horas.ausencia_fim || null,
    }
    // undefined = não mexe; [] = limpa a correção pedida; lista = dia completo novo.
    if (horas.marcacoes !== undefined) upd.marcacoes = horas.marcacoes?.length ? horas.marcacoes : null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e1 } = await (c.supabase as any).from('rh_justificativa')
      .update(upd)
      .eq('id', id).eq('org_id', c.orgId)
    if (e1) return { error: e1.message }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c.supabase as any).rpc('rh_decidir_justificativa', {
    p_id: id, p_status: status,
  })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ponto`)
  revalidatePath(`/${orgSlug}/ponto`)
  // `nao_aplicados` (migration 193) diz quando a decisão valeu mas o ajuste não
  // pôde ser gravado — competência assinada, dia importado. A tela TEM que dizer:
  // era exatamente esse silêncio que fazia o RH achar que tinha corrigido.
  const r = data as { pontos_ajustados?: number; nao_aplicados?: { data: string; motivo: string }[] }
  return {
    ok: true,
    ajustados: r?.pontos_ajustados ?? 0,
    naoAplicados: r?.nao_aplicados ?? [],
  }
}

/** Gestor decide a hora extra do dia: aprovado | rejeitado (opcionalmente aloca em projeto). */
export async function decidirExtra(orgSlug: string, pontoId: string, status: string, projetoId?: string | null) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  if (!['aprovado', 'rejeitado'].includes(status)) return { error: 'Status inválido' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).from('rh_ponto')
    .update({ extra_status: status, extra_por: c.userId, extra_em: new Date().toISOString(), extra_projeto: projetoId || null })
    .eq('id', pontoId).eq('org_id', c.orgId)
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ponto`)
  return { ok: true }
}

/** Estado do dia para o lembrete de ponto (card no canto). null = sem ficha vinculada. */
export async function pontoEstado() {
  try {
    const supabase = await createClient()
    const user = await getUsuario()
    if (!user) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).rpc('rh_ponto_estado')
    return (data ?? null) as {
      colaborador_id: string
      dia: string
      marcacoes: string[]
      jornada: { entrada: string; intervalo_ini: string; intervalo_fim: string; saida: string; flex_min: number }
      primeiro_foco: string | null
      agora: string
    } | null
  } catch {
    return null
  }
}

/** Trava do ponto (migration 199): a org exige e a pessoa ainda não bateu hoje?
 *  Desligada na org, devolve sempre `exige: false` — é o default. */
export async function pontoGate() {
  try {
    const supabase = await createClient()
    const user = await getUsuario()
    if (!user) return { exige: false }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).rpc('rh_ponto_gate')
    return (data ?? { exige: false }) as { exige: boolean; colaborador_id?: string; dia?: string }
  } catch {
    // Falha aqui NUNCA pode trancar ninguém fora do sistema.
    return { exige: false }
  }
}

/** Liga/desliga a exigência de ponto para usar o Flow (RH → Ponto). */
export async function setPontoObrigatorio(orgSlug: string, ativo: boolean) {
  const c = await ctx(orgSlug)
  if ('error' in c) return { error: c.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (c.supabase as any).rpc('rh_set_ponto_obrigatorio', { p_org: c.orgId, p_ativo: ativo })
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/rh/ponto`)
  return { ok: true }
}

/** Entrada retroativa confirmada: registra a 1ª marcação do dia na hora do
 *  primeiro foco (travado no servidor — sem foco, sem retro). */
export async function baterEntradaRetro(orgSlug: string) {
  const supabase = await createClient()
  const user = await getUsuario()
  if (!user) return { error: 'Não autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('rh_bater_entrada_retro')
  if (error) return { error: error.message }
  revalidatePath(`/${orgSlug}/ponto`)
  return { ok: true, hora: (data as { hora?: string })?.hora }
}
