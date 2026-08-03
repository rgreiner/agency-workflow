import 'server-only'
import { apagarArquivoDocumento } from '@/lib/rh/documento-arquivo'
import type { CronJob } from './jobs'

interface Expurgavel {
  id: string; org_id: string; tipo: string | null; nome: string | null
  chave: string | null; criado_em: string
}

/**
 * Retenção de documentos de RH (migration 198): passado o prazo da organização
 * (5 anos, decisão do Rafael em 03/08), o arquivo sai do volume e a linha sai da
 * tabela — sobrando só o registro em `rh_documento_expurgo` de que existiu.
 *
 * Mensal, dia 1. Não há pressa: um documento que vence hoje pode sair amanhã, e
 * rodar todo dia só multiplicaria a chance de apagar algo por engano num acervo
 * que fica cinco anos parado.
 *
 * ⚠️ Este é o único job do Flow que APAGA arquivo. A ordem (arquivo → linha) é
 * deliberada: se o unlink falhar, a linha fica e o documento reaparece na próxima
 * execução. O contrário perderia o rastro do órfão.
 */
export const rhExpurgoJob: CronJob = {
  name: 'rh-expurgo',
  monthlyOnDay: 1,
  dailyAfterHour: 3,
  run: async ({ supabase, dry }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('rh_documentos_expurgaveis', { p_org: null })
    if (error) throw new Error(error.message)
    const docs = (data ?? []) as Expurgavel[]
    if (!docs.length) return 'nenhum documento fora do prazo'
    if (dry) {
      return `${docs.length} documento(s) fora do prazo: ${docs.slice(0, 5).map(d => `${d.tipo ?? 'doc'}/${d.criado_em.slice(0, 10)}`).join(', ')}`
    }

    let apagados = 0
    const falhas: string[] = []
    for (const d of docs) {
      const r = await apagarArquivoDocumento(d.chave)
      if (!r.ok) { falhas.push(`${d.id}: ${r.erro}`); continue }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (supabase as any).rpc('rh_expurgar_documento', { p_id: d.id, p_motivo: 'retencao' })
      if (e) { falhas.push(`${d.id}: ${e.message}`); continue }
      apagados++
    }
    return `${apagados} expurgado(s)${falhas.length ? `, ${falhas.length} falhou(aram): ${falhas.slice(0, 3).join(' · ')}` : ''}`
  },
}
