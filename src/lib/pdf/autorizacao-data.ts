// Carga do Relatório de Autorização — a lista do mês que o financeiro do
// cliente usa para conferir o que pode pagar. O que não está aqui, ele
// questiona antes de pagar.
//
// No SiGA eram dois relatórios (mídia e produção) por limitação da ferramenta.
// Aqui é um documento só, com duas seções e um total geral — cada seção com as
// colunas que fazem sentido nela (o relatório antigo levava colunas de
// veiculação vazias nas linhas de produção).
//
// Duas regras de competência, e elas são diferentes de propósito:
//  · MÍDIA pelo INÍCIO da veiculação: a bi-semana de 27/07 a 09/08 é de julho,
//    e só de julho. A régua era intersecção até 05/08, quando o Rafael corrigiu
//    ("bi-semana 28 começa em junho, conta a data de início dela"): o relatório
//    autoriza PAGAMENTO, e o mesmo documento saindo em dois meses faz o
//    financeiro do cliente ler duas cobranças onde existe uma. Em agosto do É o
//    Amor isso era a diferença entre R$ 20.100 e R$ 9.900.
//  · PRODUÇÃO por EMISSÃO: entra no mês em que o documento foi emitido.
//
// Só entra o que está FATURADO (decisão do Rafael, 04/08): o relatório é o que
// o cliente vai pagar, não o que foi autorizado. Por isso a tela avisa quantos
// documentos da competência ficaram de fora por ainda não estarem faturados —
// sem esse aviso, um documento não faturado a tempo sumiria em silêncio e
// nunca mais apareceria, já que a competência dele não volta.

import { loadOrgDocs, type AgencyInfo } from '@/lib/agency'
import { labelOf, MIDIA_PRAZO_OPTIONS } from '@/lib/midia'

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export function limitesDoMes(competencia: string): { ini: string; fim: string } {
  const [y, m] = competencia.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { ini: `${competencia}-01`, fim: `${competencia}-${String(ultimo).padStart(2, '0')}` }
}
export function competenciaLabel(competencia: string): string {
  const [y, m] = competencia.split('-').map(Number)
  return `${MESES[m - 1]} de ${y}`
}

export interface AutorizacaoLinha {
  id: string
  doc: string                     // "MX 1626"
  titulo: string
  parceiro: string                // veículo (mídia) ou fornecedor (produção)
  prazo: string
  valor: number
  primeira: string | null         // só mídia
  ultima: string | null           // só mídia
  emissao: string | null          // só produção
}

export interface AutorizacaoData {
  agencia: AgencyInfo
  logoUrl: string | null
  cliente: string
  competencia: string
  competenciaLabel: string
  midias: AutorizacaoLinha[]
  producoes: AutorizacaoLinha[]
  totalMidia: number
  totalProducao: number
  total: number
  /** Da mesma competência, porém ainda não faturados — ficaram de fora. */
  pendentes: { doc: string; titulo: string; valor: number; situacao: string }[]
  nomeArquivo: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadAutorizacao(
  supabase: any, orgId: string, workspaceId: string, competencia: string,
): Promise<AutorizacaoData | null> {
  if (!/^\d{4}-\d{2}$/.test(competencia)) return null
  const { ini, fim } = limitesDoMes(competencia)

  const [wsRes, orgDocs, cfgRes] = await Promise.all([
    supabase.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    loadOrgDocs(supabase, orgId),
    supabase.from('org_settings').select('logo_url').eq('org_id', orgId).maybeSingle(),
  ])
  if (!wsRes?.data) return null

  const [midiaRes, prodRes] = await Promise.all([
    supabase.from('midias')
      .select('id, serie, numero, titulo, prazo, valor, situacao, primeira_veiculacao, ultima_veiculacao, veiculo_id')
      .eq('org_id', orgId).eq('workspace_id', workspaceId)
      .eq('archived', false)
      .gte('primeira_veiculacao', ini).lte('primeira_veiculacao', fim)
      .order('numero'),
    // Só o Pedido de Produção (PP). Orçamento e proposta não são cobrança, e o
    // Fee é honorário da agência — nenhum dos três estava no relatório antigo.
    supabase.from('producao')
      .select('id, serie, numero, titulo, emissao, valor, situacao, detalhe')
      .eq('org_id', orgId).eq('workspace_id', workspaceId)
      .eq('tipo', 'pedido').eq('archived', false)
      .gte('emissao', ini).lte('emissao', fim)
      .order('numero'),
  ])

  const midiasRaw = (midiaRes?.data ?? []) as any[]
  const prodRaw   = (prodRes?.data ?? []) as any[]

  // Veículo e fornecedor resolvidos em lote — o do fornecedor mora no jsonb
  // `detalhe`, como no PDF do pedido (producao-data).
  const veicIds = [...new Set(midiasRaw.map(m => m.veiculo_id as string | null).filter(Boolean))] as string[]
  const fornIds = [...new Set(prodRaw
    .map(p => p.detalhe?.fornecedor_id as string | undefined)
    .filter((v): v is string => !!v))]

  const [veicRes, fornRes] = await Promise.all([
    veicIds.length ? supabase.from('veiculos').select('id, name').in('id', veicIds) : Promise.resolve({ data: [] }),
    fornIds.length ? supabase.from('fornecedores').select('id, name').in('id', fornIds) : Promise.resolve({ data: [] }),
  ])
  const nomeVeic = new Map<string, string>()
  for (const v of ((veicRes?.data ?? []) as any[])) nomeVeic.set(v.id, v.name)
  const nomeForn = new Map<string, string>()
  for (const f of ((fornRes?.data ?? []) as any[])) nomeForn.set(f.id, f.name)

  const docDe = (serie: string | null, numero: number | null) =>
    [serie, numero].filter(v => v !== null && v !== '').join(' ') || '—'

  const faturado = (r: any) => r.situacao === 'faturado'

  const midias: AutorizacaoLinha[] = midiasRaw.filter(faturado).map(m => ({
    id: m.id,
    doc: docDe(m.serie, m.numero),
    titulo: m.titulo ?? '—',
    parceiro: nomeVeic.get(m.veiculo_id) ?? '—',
    prazo: labelOf(MIDIA_PRAZO_OPTIONS, m.prazo),
    valor: Number(m.valor ?? 0),
    primeira: m.primeira_veiculacao ?? null,
    ultima: m.ultima_veiculacao ?? null,
    emissao: null,
  }))

  const producoes: AutorizacaoLinha[] = prodRaw.filter(faturado).map(p => ({
    id: p.id,
    doc: docDe(p.serie, p.numero),
    titulo: p.titulo ?? '—',
    parceiro: nomeForn.get(p.detalhe?.fornecedor_id) ?? '—',
    prazo: labelOf(MIDIA_PRAZO_OPTIONS, p.detalhe?.prazo),
    valor: Number(p.valor ?? 0),
    primeira: null, ultima: null,
    emissao: p.emissao ?? null,
  }))

  const pendentes = [...midiasRaw, ...prodRaw]
    .filter(r => !faturado(r) && r.situacao !== 'cancelado')
    .map(r => ({
      doc: docDe(r.serie, r.numero),
      titulo: r.titulo ?? '—',
      valor: Number(r.valor ?? 0),
      situacao: r.situacao ?? '—',
    }))

  const totalMidia    = midias.reduce((s, l) => s + l.valor, 0)
  const totalProducao = producoes.reduce((s, l) => s + l.valor, 0)
  const cliente = wsRes.data.name as string

  return {
    agencia: orgDocs.agency,
    logoUrl: (cfgRes?.data?.logo_url as string | null) ?? null,
    cliente,
    competencia,
    competenciaLabel: competenciaLabel(competencia),
    midias, producoes,
    totalMidia, totalProducao, total: totalMidia + totalProducao,
    pendentes,
    nomeArquivo: `${cliente} - Relatorio de Autorizacao - ${competenciaLabel(competencia)}`,
  }
}
