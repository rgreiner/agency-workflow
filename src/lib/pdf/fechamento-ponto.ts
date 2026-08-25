import 'server-only'
import type { EspelhoPdfDados } from './EspelhoDoc'

export interface RunLinhaRef { colaborador_id: string; ini: string; fim: string }

/**
 * Espelhos (dados do PDF) das pessoas de um fechamento, cada uma no período
 * PRÓPRIO da sua linha — o do desligado pode ser mais longo que o do ciclo
 * (mig. 256). Assinaturas eletrônicas válidas da competência carimbam a página
 * de quem já assinou.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function montarEspelhosDoRun(sb: any, orgId: string, competencia: string, linhas: RunLinhaRef[]): Promise<EspelhoPdfDados[]> {
  const ids = linhas.map(l => l.colaborador_id)
  const { data: assin } = await sb.from('rh_assinatura')
    .select('colaborador_id, papel, hash, assinado_em, ip, assinado_por')
    .in('colaborador_id', ids).eq('tipo', 'espelho')
    .eq('competencia', competencia).is('invalidada_em', null)
    .order('assinado_em', { ascending: true })
  type Assin = { colaborador_id: string; papel: string; hash: string; assinado_em: string; ip: string | null; assinado_por: string }
  const todas = (assin ?? []) as Assin[]

  const porIds = [...new Set(todas.map(a => a.assinado_por))]
  const { data: perfis } = porIds.length
    ? await sb.from('profiles').select('id, full_name').in('id', porIds)
    : { data: [] }
  const nomePor = new Map<string, string | null>(
    ((perfis ?? []) as { id: string; full_name: string | null }[]).map(p => [p.id, p.full_name]))

  const out: EspelhoPdfDados[] = []
  for (const l of linhas) {
    const { data: esp, error } = await sb.rpc('rh_espelho', {
      p_org_id: orgId, p_colaborador_id: l.colaborador_id,
      p_competencia: competencia, p_ini: l.ini, p_fim: l.fim,
    })
    if (error) throw new Error(`Espelho de ${l.colaborador_id}: ${error.message}`)
    out.push({
      ...(esp as EspelhoPdfDados),
      assinaturas: todas.filter(a => a.colaborador_id === l.colaborador_id).map(a => ({
        papel: a.papel, por: nomePor.get(a.assinado_por) ?? null,
        assinado_em: a.assinado_em, hash: a.hash, ip: a.ip,
      })),
    })
  }
  return out
}
