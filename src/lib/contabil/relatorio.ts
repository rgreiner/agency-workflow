import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { MailAttachment } from '@/lib/email/send'

/**
 * Pacote mensal pra contabilidade: extrato bancário + recebimentos do mês.
 *
 * São DUAS coisas de propósito (pedido do contador, 20/07/2026):
 * - o OFX ORIGINAL do banco, que é o documento que eles aceitam;
 * - uma planilha legível gerada daqui, que cobre todas as contas e também o
 *   período anterior a passarmos a guardar o arquivo original.
 */

const REALIZADO_EXTRATO = ['Conciliado', 'Quitado', 'Transferido']

export interface PacoteContabil {
  anexos: MailAttachment[]
  resumo: { contas: number; movimentos: number; recebimentos: number; totalRecebido: number; ofxAnexados: number }
  avisos: string[]
}

function fmtData(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** Primeiro e último dia da competência 'YYYY-MM'. */
export function limitesCompetencia(competencia: string): { ini: string; fim: string } {
  const [y, m] = competencia.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { ini: `${competencia}-01`, fim: `${competencia}-${String(ultimo).padStart(2, '0')}` }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function montarPacoteContabil(sb: any, orgId: string, competencia: string): Promise<PacoteContabil> {
  const { ini, fim } = limitesCompetencia(competencia)
  const avisos: string[] = []
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  // ── Extrato por conta (só realizado — é o que a contabilidade lança) ───────
  const { data: contas } = await sb
    .from('contas_financeiras')
    .select('id, nome').eq('org_id', orgId).order('nome')

  let totalMovimentos = 0
  const linhasExtrato: Record<string, string | number>[] = []
  for (const c of (contas ?? []) as { id: string; nome: string }[]) {
    const { data: movs } = await sb
      .from('extrato_importado')
      .select('data_mov, contato, descricao, categoria, valor, situacao')
      .eq('org_id', orgId).eq('conta', c.nome)
      .in('situacao', REALIZADO_EXTRATO)
      .gte('data_mov', ini).lte('data_mov', fim)
      .order('data_mov', { ascending: true }).order('id', { ascending: true })

    for (const m of (movs ?? []) as Record<string, unknown>[]) {
      linhasExtrato.push({
        Conta: c.nome,
        Data: fmtData(m.data_mov as string),
        Contato: (m.contato as string) ?? '',
        Histórico: (m.descricao as string) ?? '',
        Categoria: (m.categoria as string) ?? '',
        Valor: Number(m.valor ?? 0),
      })
      totalMovimentos++
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasExtrato), 'Extrato')

  // ── Recebimentos do mês (entradas com baixa na competência) ────────────────
  // Decisão do Rafael: "recebimentos" = o que ENTROU no mês, não a posição em
  // aberto. É a leitura fiscal — receita realizada no período.
  const { data: receb } = await sb
    .from('lancamentos')
    .select('data_liquidacao, vencimento, contato_nome, descricao, categoria, valor, valor_realizado, conta_id, origem_tipo')
    .eq('org_id', orgId).eq('tipo', 'entrada')
    .in('situacao', ['recebido', 'pago'])
    .gte('data_liquidacao', ini).lte('data_liquidacao', fim)
    .order('data_liquidacao', { ascending: true })

  const nomeConta = new Map((contas ?? []).map((c: { id: string; nome: string }) => [c.id, c.nome]))
  let totalRecebido = 0
  // Transferência entre contas NÃO é receita — é dinheiro mudando de conta (nasce
  // 'recebido' com data_liquidacao). Sem excluir, o fechamento reportava a
  // transferência como receita realizada pra contabilidade. Filtro no JS (o `neq`
  // do PostgREST descartaria também as linhas com origem_tipo NULL).
  const linhasReceb = ((receb ?? []) as Record<string, unknown>[])
    .filter(l => l.origem_tipo !== 'transferencia')
    .map(l => {
    const v = Number(l.valor_realizado ?? l.valor ?? 0)
    totalRecebido += v
    return {
      Data: fmtData(l.data_liquidacao as string),
      Cliente: (l.contato_nome as string) ?? '',
      Descrição: (l.descricao as string) ?? '',
      Categoria: (l.categoria as string) ?? '',
      Conta: nomeConta.get(l.conta_id as string) ?? '',
      Vencimento: fmtData(l.vencimento as string),
      Valor: v,
    }
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasReceb), 'Recebimentos')

  const planilha: MailAttachment = {
    filename: `flow-${competencia}-extrato-e-recebimentos.xlsx`,
    content: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  }

  // ── OFX originais do período ───────────────────────────────────────────────
  const anexos: MailAttachment[] = [planilha]
  const { data: arquivos } = await sb
    .from('ofx_arquivos')
    .select('nome, caminho, periodo_fim')
    .eq('org_id', orgId)
    .gte('periodo_fim', ini).lte('periodo_fim', fim)
    .order('periodo_fim')

  const root = process.env.UPLOAD_DIR || '/app/uploads'
  for (const a of (arquivos ?? []) as { nome: string; caminho: string }[]) {
    try {
      // caminho é relativo e validado na gravação; resolve e confere que não escapou.
      const abs = path.resolve(root, a.caminho)
      if (!abs.startsWith(path.resolve(root) + path.sep)) { avisos.push(`Caminho suspeito ignorado: ${a.nome}`); continue }
      anexos.push({ filename: a.nome, content: await readFile(abs) })
    } catch {
      avisos.push(`OFX "${a.nome}" está registrado mas o arquivo não foi encontrado no servidor.`)
    }
  }

  const ofxAnexados = anexos.length - 1
  if (ofxAnexados === 0) {
    avisos.push('Nenhum OFX original foi anexado — só passamos a guardar o arquivo a partir de agora. A planilha cobre o período.')
  }

  return {
    anexos,
    resumo: {
      contas: (contas ?? []).length,
      movimentos: totalMovimentos,
      recebimentos: linhasReceb.length,
      totalRecebido: Math.round(totalRecebido * 100) / 100,
      ofxAnexados,
    },
    avisos,
  }
}
