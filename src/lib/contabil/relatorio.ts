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
 *
 * Duas regras do escritório (11/08/2026) moldam a aba Recebimentos: rendimento
 * de aplicação não entra no cálculo, e toda linha precisa do número da NF que a
 * agência emitiu.
 */

const REALIZADO_EXTRATO = ['Conciliado', 'Quitado', 'Transferido']

export interface ResumoContabil {
  contas: number
  movimentos: number
  recebimentos: number
  totalRecebido: number
  ofxAnexados: number
  /** Recebimentos que foram pra planilha sem o número da NF da agência. */
  semNF: number
  /** Valor deixado de fora por não ser receita de cliente (transferência, estorno…). */
  transferenciasFora: number
  /** Valor de rendimento de aplicação deixado de fora. */
  rendimentosFora: number
}

export interface PacoteContabil {
  anexos: MailAttachment[]
  resumo: ResumoContabil
  avisos: string[]
}

function fmtData(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

const brlAviso = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Primeiro e último dia da competência 'YYYY-MM'. */
export function limitesCompetencia(competencia: string): { ini: string; fim: string } {
  const [y, m] = competencia.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { ini: `${competencia}-01`, fim: `${competencia}-${String(ultimo).padStart(2, '0')}` }
}

/**
 * Categorias que NÃO são receita de cliente e por isso ficam fora da base que
 * vai à contabilidade: transferência entre contas próprias, numerário em
 * trânsito, estorno. É dinheiro que entra na conta sem ser venda.
 *
 * Sai do CADASTRO da org (flag `fora_receita` no grupo ou no filho), não de uma
 * lista fixa no código: lista fixa envelhece quando alguém cria ou renomeia
 * categoria, e volta a inflar a receita em silêncio — que é exatamente o bug
 * que isto conserta. O prefixo "Transfer" fica como rede de segurança para org
 * que ainda não marcou nada.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function categoriasForaDaReceita(finance_categorias: any): Set<string> {
  const nomes = new Set<string>()
  for (const g of (Array.isArray(finance_categorias) ? finance_categorias : [])) {
    const grupoFora = !!g?.fora_receita || /^transfer/i.test(String(g?.nome ?? ''))
    if (grupoFora && g?.nome) nomes.add(String(g.nome))
    for (const f of (Array.isArray(g?.filhos) ? g.filhos : [])) {
      if ((grupoFora || f?.fora_receita) && f?.nome) nomes.add(String(f.nome))
    }
  }
  return nomes
}

/**
 * Rendimento da conta remunerada NÃO entra no cálculo da contabilidade
 * (contador, 11/08/2026). É crédito do próprio banco, não venda: o escritório
 * lança pelo extrato, e as 15 linhas de centavos que a importação de OFX cria
 * por mês só sujavam a planilha de recebimentos.
 *
 * Fica no Extrato e no OFX anexado — sai só da base de receita.
 */
const ehRendimento = (l: Record<string, unknown>) => /rendimento/i.test(String(l.categoria ?? ''))

interface DocFiscal { tipo?: string; numero?: string; emitente?: string }

/**
 * Número da NF que a AGÊNCIA emitiu — a contabilidade pede em toda linha de
 * recebimento (contador, 11/08/2026).
 *
 * Só aceita documento marcado com `emitente: 'agencia'`. Um recebimento de
 * comissão carrega TAMBÉM a NF do fornecedor contra o cliente (entra como
 * referência, sem valor): mandar esse número como se fosse o nosso é pior que
 * mandar vazio. Sem a marcação, a linha vai em branco e vira aviso na tela
 * antes do envio.
 */
function nfDaAgencia(anexos: unknown): string {
  const docs = (Array.isArray(anexos) ? anexos : []) as DocFiscal[]
  const numeros = docs
    .filter(d => /^nf/i.test(String(d?.tipo ?? '')) && d?.emitente === 'agencia')
    .map(d => String(d?.numero ?? '').trim())
    .filter(Boolean)
  return [...new Set(numeros)].join(' / ')
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
    .select('data_liquidacao, vencimento, contato_nome, descricao, categoria, valor, valor_realizado, conta_id, origem_tipo, anexos')
    .eq('org_id', orgId).eq('tipo', 'entrada')
    .in('situacao', ['recebido', 'pago'])
    .gte('data_liquidacao', ini).lte('data_liquidacao', fim)
    .order('data_liquidacao', { ascending: true })

  const nomeConta = new Map((contas ?? []).map((c: { id: string; nome: string }) => [c.id, c.nome]))

  // Transferência entre contas NÃO é receita — é dinheiro mudando de bolso, e a
  // base do imposto é o que entra de CLIENTE. Olhar só `origem_tipo` não bastava:
  // pega a transferência feita pela tela do Flow, mas deixa passar a que veio do
  // extrato importado, que chega com origem 'conta_azul'/'ofx' e categoria de
  // transferência. Foi assim que R$ 8.500 entraram na receita de julho/2026.
  const { data: cfgCat } = await sb
    .from('org_settings').select('finance_categorias').eq('org_id', orgId).maybeSingle()
  const catFora = categoriasForaDaReceita(cfgCat?.finance_categorias)
  const ehTransferencia = (l: Record<string, unknown>) =>
    l.origem_tipo === 'transferencia'
    || catFora.has(String(l.categoria ?? ''))
    || /^transfer/i.test(String(l.categoria ?? ''))

  let totalRecebido = 0
  let transferenciasFora = 0
  let rendimentosFora = 0
  const semNF: string[] = []
  const linhasReceb = ((receb ?? []) as Record<string, unknown>[])
    .filter(l => {
      const v = Number(l.valor_realizado ?? l.valor ?? 0)
      if (ehTransferencia(l)) { transferenciasFora += v; return false }
      if (ehRendimento(l)) { rendimentosFora += v; return false }
      return true
    })
    .map(l => {
    const v = Number(l.valor_realizado ?? l.valor ?? 0)
    totalRecebido += v
    const nf = nfDaAgencia(l.anexos)
    if (!nf) {
      const quem = (l.contato_nome as string) || (l.descricao as string) || 'sem contato'
      semNF.push(`${quem} (${brlAviso(v)}, ${fmtData(l.data_liquidacao as string)})`)
    }
    return {
      Data: fmtData(l.data_liquidacao as string),
      NF: nf,
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
  // O BTG entrega todo OFX com o MESMO nome (50_004564883.ofx) — julho/2026 tem 7.
  // Sete anexos homônimos no e-mail é impossível de conferir: prefixa com o
  // período, que também deixa a lista em ordem cronológica.
  const nomesUsados = new Set<string>()
  const nomeAnexo = (nome: string, periodoFim: string | null, i: number) => {
    const prefixo = (periodoFim ?? '').slice(0, 10) || String(i + 1).padStart(2, '0')
    let candidato = `${prefixo} ${nome}`
    for (let n = 2; nomesUsados.has(candidato); n++) candidato = `${prefixo} (${n}) ${nome}`
    nomesUsados.add(candidato)
    return candidato
  }

  const listaOfx = (arquivos ?? []) as { nome: string; caminho: string; periodo_fim: string | null }[]
  for (const [i, a] of listaOfx.entries()) {
    try {
      // caminho é relativo e validado na gravação; resolve e confere que não escapou.
      const abs = path.resolve(root, a.caminho)
      if (!abs.startsWith(path.resolve(root) + path.sep)) { avisos.push(`Caminho suspeito ignorado: ${a.nome}`); continue }
      anexos.push({ filename: nomeAnexo(a.nome, a.periodo_fim, i), content: await readFile(abs) })
    } catch {
      avisos.push(`OFX "${a.nome}" está registrado mas o arquivo não foi encontrado no servidor.`)
    }
  }

  // Dito em voz alta: a contabilidade compara o total com o extrato e a
  // diferença precisa ter nome, senão parece receita faltando.
  if (transferenciasFora > 0) {
    avisos.push(
      `${brlAviso(transferenciasFora)} ficaram FORA dos recebimentos: transferência entre contas `
      + 'próprias, numerário em trânsito e estorno não são receita de cliente. Continuam no Extrato, '
      + 'como movimento bancário.',
    )
  }

  if (rendimentosFora > 0) {
    avisos.push(
      `${brlAviso(rendimentosFora)} de rendimento de aplicação ficaram FORA dos recebimentos — `
      + 'a contabilidade não considera rendimento no cálculo. Continua no extrato do banco '
      + '(OFX anexado), como crédito da conta remunerada.',
    )
  }

  // A contabilidade pede o número da NF em TODA linha de recebimento. Quem manda
  // é a marcação do documento no lançamento (emitente: agência) — sem ela a
  // planilha sai com a coluna vazia e o escritório devolve o fechamento.
  if (semNF.length) {
    const mostra = semNF.slice(0, 4).join('; ')
    const resto = semNF.length > 4 ? ` e mais ${semNF.length - 4}` : ''
    avisos.push(
      `${semNF.length} recebimento(s) vão SEM o número da NF: ${mostra}${resto}. `
      + 'Marque a NF no lançamento com emitente "Agência" antes de enviar.',
    )
  }

  // A aba Extrato sai de `extrato_importado`, que é a base da Conta Azul — fonte
  // que parou de crescer. Mês sem nenhum movimento realizado ali não é
  // necessariamente mês sem movimento: é a planilha que ficou cega, e só os OFX
  // sustentam o extrato. Melhor dizer isso antes de o pacote sair.
  if (totalMovimentos === 0) {
    avisos.push(
      'A aba Extrato saiu VAZIA — nenhum movimento realizado no período veio da base importada. '
      + 'O extrato do mês vai só pelos arquivos OFX anexados.',
    )
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
      semNF: semNF.length,
      transferenciasFora: Math.round(transferenciasFora * 100) / 100,
      rendimentosFora: Math.round(rendimentosFora * 100) / 100,
    },
    avisos,
  }
}
